/**
 * Top-level `.aarec` -> decoded recording (`TstGridposLog[]` + zones + events).
 *
 * Pipeline: text sections -> UDP datagrams -> stream messages -> cycle/zone
 * samples + player/team identities -> gridpos logs grouped into rounds, plus
 * recovered map zones (gZone, descriptor 340) and timeline events.
 *
 * Rounds are derived from game time: within a round each cycle's `last_time`
 * increases monotonically; at round start the cycles are recreated and time
 * resets to ~0, which we detect as a backwards jump.
 */

import type { DecodedZone, MatchEvent, TstGridposLog } from "@/types/tstLog";
import { AarecState, type ZoneSample } from "./cycleSync";
import { parseDatagram } from "./packets";
import { iterateAarec } from "./sections";

export type AarecDecodeResult = {
  logs: TstGridposLog[];
  zones: DecodedZone[];
  events: MatchEvent[];
  version: string;
  rounds: number;
  cycleSamples: number;
};

const COLOR_CODE = /0x[0-9a-fA-F]{6}/g;
const ROUND_RESET_GAP = 5; // seconds of backwards time that signals a new round
const ROUND_START_TIME = 2; // a round restart resets game time to ~0
const ROUND_PROGRESS = 5; // ignore resets until the round has run this long
// Sanity bound for decoded coordinates: real arenas are a few hundred units, so
// anything past this is a misframed/short message and gets dropped.
const MAX_COORD = 5000;

function cleanName(raw: string): string {
  return raw.replace(COLOR_CODE, "").trim();
}

/**
 * Collapse zone samples into a small set of distinct zones (one per centre).
 * Fortress maps repeat the same zones every round, so we key by rounded centre
 * and merge: take the radius function from a sample that has one, and the team
 * colour from the most recent non-black sync (creation messages start black and
 * get team-coloured by a later sync).
 */
function collapseZones(samples: ZoneSample[]): DecodedZone[] {
  const groups = new Map<string, DecodedZone & { _hasColor: boolean; _hasRadius: boolean }>();
  for (const s of samples) {
    if (Math.abs(s.x) > MAX_COORD || Math.abs(s.y) > MAX_COORD) continue;
    const key = `${Math.round(s.x)}|${Math.round(s.y)}`;
    const nonBlack = s.r > 0.01 || s.g > 0.01 || s.b > 0.01;
    const hasRadius = s.radiusOffset > 0.01;
    let zone = groups.get(key);
    if (!zone) {
      zone = {
        centerX: s.x,
        centerY: s.y,
        radiusOffset: s.radiusOffset,
        radiusSlope: s.radiusSlope,
        referenceTime: s.referenceTime,
        rotationSpeed: s.rotationSpeed,
        color: [s.r, s.g, s.b],
        _hasColor: nonBlack,
        _hasRadius: hasRadius,
      };
      groups.set(key, zone);
      continue;
    }
    if (hasRadius && (!zone._hasRadius || s.radiusOffset > zone.radiusOffset)) {
      zone.radiusOffset = s.radiusOffset;
      zone.radiusSlope = s.radiusSlope;
      zone.referenceTime = s.referenceTime;
      zone.rotationSpeed = s.rotationSpeed;
      zone._hasRadius = true;
    }
    if (nonBlack) {
      zone.color = [s.r, s.g, s.b];
      zone._hasColor = true;
    }
  }
  return [...groups.values()]
    .filter((z) => z._hasRadius || z.radiusOffset > 0.01)
    .map(({ _hasColor, _hasRadius, ...zone }) => {
      void _hasColor;
      void _hasRadius;
      return zone;
    });
}

export function decodeAarec(text: string): AarecDecodeResult {
  const state = new AarecState();
  let version = "";

  for (const record of iterateAarec(text)) {
    if (record.kind === "read") {
      const { messages } = parseDatagram(record.bytes);
      for (const msg of messages) {
        state.feed(msg);
      }
    } else if (record.kind === "version") {
      version = record.value;
    }
  }

  const logs: TstGridposLog[] = [];
  const events: MatchEvent[] = [];
  let roundIndex = 0;
  let maxTime = 0;
  let lastKey = "";
  const seenRounds = new Set<number>();
  // Eliminations are emitted from cycle samples, so their seq lines up with a
  // cycle sample; resolve each to the round active at that point.
  let elimIdx = 0;
  const elims = state.eliminations;

  const pushRound = (round: number) => {
    if (seenRounds.has(round)) return;
    seenRounds.add(round);
    events.push({ roundId: String(round + 1), time: 0, kind: "round", text: `Round ${round + 1}` });
  };

  for (const sample of state.samples) {
    // Drop misframed/short-message decodes that produced impossible coordinates.
    if (Math.abs(sample.x) > MAX_COORD || Math.abs(sample.y) > MAX_COORD) continue;

    // New round when game time resets to ~0 after the round has made progress.
    if (
      sample.time < maxTime - ROUND_RESET_GAP &&
      sample.time < ROUND_START_TIME &&
      maxTime > ROUND_PROGRESS
    ) {
      roundIndex += 1;
      maxTime = sample.time;
    } else if (sample.time > maxTime) {
      maxTime = sample.time;
    }

    pushRound(roundIndex);

    // Flush any eliminations at or before this sample's stream position.
    while (elimIdx < elims.length && elims[elimIdx].seq <= sample.seq) {
      const e = elims[elimIdx];
      const who = cleanName(state.nameFor(e.playerId));
      if (who && e.time > 0.5) {
        events.push({
          roundId: String(roundIndex + 1),
          time: e.time,
          kind: "elimination",
          text: `${who} eliminated`,
          team: cleanName(state.teamFor(e.playerId)) || undefined,
        });
      }
      elimIdx += 1;
    }

    const name = cleanName(state.players.get(sample.playerId)?.name ?? `cycle-${sample.objectId}`);
    if (!name) continue;

    // Drop exact consecutive duplicates (sync retransmissions).
    const key = `${roundIndex}|${sample.objectId}|${sample.time}|${sample.x}|${sample.y}`;
    if (key === lastKey) continue;
    lastKey = key;

    logs.push({
      Username: name,
      Team: cleanName(state.teamFor(sample.playerId)) || "spectator",
      PosX: sample.x,
      PosY: sample.y,
      DirX: sample.dirX,
      DirY: sample.dirY,
      Speed: sample.speed,
      Rubber: 0,
      Braking: 0,
      BrakeReservoir: 0,
      RoundId: String(roundIndex + 1),
      ElapsedTime: sample.time,
      Id: `${sample.objectId}:${sample.time}`,
    });
  }

  return {
    logs,
    zones: collapseZones(state.zoneSamples),
    events,
    version,
    rounds: logs.length ? roundIndex + 1 : 0,
    cycleSamples: state.samples.length,
  };
}
