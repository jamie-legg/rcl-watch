/**
 * Top-level `.aarec` -> decoded recording (`TstGridposLog[]` + zones + events).
 *
 * Pipeline: text sections -> UDP datagrams -> stream messages -> cycle/zone/
 * console samples + player/team identities -> gridpos logs grouped into rounds,
 * plus recovered map zones (gZone, 340) and parsed console events (kills,
 * conquests, holds, suicides, chat, descriptor 8).
 *
 * Rounds are derived from game time: within a round each cycle's `last_time`
 * increases monotonically; at round start the cycles are recreated and time
 * resets to ~0, which we detect as a backwards jump. Pre-game/warm-up fragments
 * (no spawn captured, very few samples) are dropped and the rest renumbered.
 */

import type { DecodedZone, MatchEvent, TstGridposLog } from "@/types/tstLog";
import { AarecState, teamColorName, type ZoneSample } from "./cycleSync";
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

const COLOR_CODE = /0x(?:[0-9a-fA-F]{6}|RESETT)/gi;
const ROUND_RESET_GAP = 5; // seconds of backwards time that signals a new round
const ROUND_START_TIME = 2; // a round restart resets game time to ~0
const ROUND_PROGRESS = 5; // ignore resets until the round has run this long
// A valid round either captured its spawn (min time near 0) or has real volume;
// pre-game fragments have neither.
const ROUND_SPAWN_TIME = 3;
const ROUND_MIN_SAMPLES = 100;
// Sanity bound for decoded coordinates: real arenas are a few hundred units, so
// anything past this is a misframed/short message and gets dropped.
const MAX_COORD = 5000;

function cleanName(raw: string): string {
  return raw.replace(COLOR_CODE, "").trim();
}

/** Parse one server console line into a structured event (or null to drop noise). */
function parseConsole(raw: string, state: AarecState): Omit<MatchEvent, "roundId" | "time"> | null {
  const text = cleanName(raw).replace(/\s+/g, " ").trim();
  if (!text) return null;

  let m = /^(.+?) core dumped (.+?) for (-?\d+) points?\.?$/.exec(text);
  if (m) {
    const actor = m[1].trim();
    return { kind: "kill", text: `${actor} ⟶ ${m[2].trim()}`, actor, team: state.teamForName(actor) || undefined, points: Number(m[3]) };
  }
  m = /^(.+?) committed suicide\.?$/.exec(text);
  if (m) {
    const actor = m[1].trim();
    return { kind: "suicide", text: `${actor} committed suicide`, actor, team: state.teamForName(actor) || undefined };
  }
  m = /^(.+?) was awarded (-?\d+) points? for conquering (.+?)'s base\.?$/.exec(text);
  if (m) {
    return { kind: "conquest", text: `${m[1].trim()} conquered ${m[3].trim()}'s base`, team: m[1].trim(), points: Number(m[2]) };
  }
  m = /^(.+?) was awarded (-?\d+) points? for holding the base\.?$/.exec(text);
  if (m) {
    return { kind: "hold", text: `${m[1].trim()} held the base`, team: m[1].trim(), points: Number(m[2]) };
  }

  // Drop known server noise.
  if (/^(Welcome|Resetting|Go \(round|Waiting up to)/.test(text) || /STATS|server feedback|finish chatting/.test(text)) {
    return null;
  }

  // Chat looks like "name: message".
  m = /^(\S[^:]{0,31}): (.+)$/.exec(text);
  if (m) {
    return { kind: "chat", text, actor: m[1].trim() };
  }
  return null;
}

/**
 * Collapse zone samples into a small set of distinct zones (one per centre).
 * Fortress maps repeat the same zones every round, so we key by rounded centre
 * and merge: take the radius function from a sample that has one, and the team
 * colour from the most recent non-black sync (creation messages start black).
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

  // Single pass over cycles + console interleaved by stream order. Cycles drive
  // round detection; console events inherit the round + latest game time.
  type ProvLog = { round: number; log: TstGridposLog };
  type ProvEvent = { round: number } & MatchEvent;
  const provLogs: ProvLog[] = [];
  const provEvents: ProvEvent[] = [];
  const roundMin = new Map<number, number>();
  const roundCount = new Map<number, number>();

  let roundIndex = 0;
  let maxTime = 0;
  let curTime = 0;
  let lastKey = "";
  let ci = 0;
  let mi = 0;
  const samples = state.samples;
  const consoles = state.consoleSamples;

  while (ci < samples.length || mi < consoles.length) {
    const c = ci < samples.length ? samples[ci] : undefined;
    const m = mi < consoles.length ? consoles[mi] : undefined;
    const takeCycle = c !== undefined && (m === undefined || c.seq <= m.seq);

    if (takeCycle && c) {
      ci += 1;
      if (Math.abs(c.x) > MAX_COORD || Math.abs(c.y) > MAX_COORD) continue;

      if (c.time < maxTime - ROUND_RESET_GAP && c.time < ROUND_START_TIME && maxTime > ROUND_PROGRESS) {
        roundIndex += 1;
        maxTime = c.time;
      } else if (c.time > maxTime) {
        maxTime = c.time;
      }
      curTime = c.time;

      const name = cleanName(state.players.get(c.playerId)?.name ?? `cycle-${c.objectId}`);
      if (!name) continue;

      const key = `${roundIndex}|${c.objectId}|${c.time}|${c.x}|${c.y}`;
      if (key === lastKey) continue;
      lastKey = key;

      roundMin.set(roundIndex, Math.min(roundMin.get(roundIndex) ?? Infinity, c.time));
      roundCount.set(roundIndex, (roundCount.get(roundIndex) ?? 0) + 1);

      provLogs.push({
        round: roundIndex,
        log: {
          Username: name,
          Team: cleanName(state.teamFor(c.playerId)) || "spectator",
          PosX: c.x,
          PosY: c.y,
          DirX: c.dirX,
          DirY: c.dirY,
          Speed: c.speed,
          Rubber: 0,
          Braking: 0,
          BrakeReservoir: 0,
          RoundId: "0",
          ElapsedTime: c.time,
          Id: `${c.objectId}:${c.time}`,
        },
      });
    } else if (m) {
      mi += 1;
      const parsed = parseConsole(m.text, state);
      if (parsed) {
        provEvents.push({ round: roundIndex, roundId: "0", time: curTime, ...parsed });
      }
    }
  }

  // Keep rounds that captured a spawn (min time near 0) or have real volume;
  // drop pre-game fragments, then renumber 1..N.
  const finalOf = new Map<number, number>();
  let nextFinal = 0;
  const provRounds = [...roundCount.keys()].sort((a, b) => a - b);
  for (const r of provRounds) {
    const valid = (roundCount.get(r) ?? 0) >= ROUND_MIN_SAMPLES || (roundMin.get(r) ?? Infinity) <= ROUND_SPAWN_TIME;
    if (valid) finalOf.set(r, nextFinal++);
  }

  const logs: TstGridposLog[] = [];
  for (const { round, log } of provLogs) {
    const final = finalOf.get(round);
    if (final === undefined) continue;
    logs.push({ ...log, RoundId: String(final + 1) });
  }

  const zones = collapseZones(state.zoneSamples);
  const teamByRoundPlayer = assignTeamsBySpawn(logs, zones);

  const events: MatchEvent[] = [];
  for (let final = 0; final < nextFinal; final += 1) {
    events.push({ roundId: String(final + 1), time: 0, kind: "round", text: `Round ${final + 1}` });
  }
  for (const ev of provEvents) {
    const final = finalOf.get(ev.round);
    if (final === undefined) continue;
    const { round, ...rest } = ev;
    void round;
    const roundId = String(final + 1);
    // Kill/suicide events were team-tagged via the unreliable team objects;
    // prefer the authoritative spawn-based team for the actor.
    if (rest.actor && (rest.kind === "kill" || rest.kind === "suicide")) {
      const better = teamByRoundPlayer.get(`${roundId}|${rest.actor}`);
      if (better) rest.team = better;
    }
    events.push({ ...rest, roundId });
  }
  events.sort((a, b) => (a.roundId === b.roundId ? a.time - b.time : Number(a.roundId) - Number(b.roundId)));

  return {
    logs,
    zones,
    events,
    version,
    rounds: nextFinal,
    cycleSamples: state.samples.length,
  };
}

/**
 * Reassign each player's team from where they spawn. `current_team_id` in the
 * stream is unreliable (stale/duplicate "Empty team" objects, players left on
 * team 0), but fortress players always spawn next to the zone they defend, so
 * the nearest team-coloured zone to a player's first position in a round is an
 * authoritative team label. No-ops when no team-coloured zones were recovered.
 */
function assignTeamsBySpawn(logs: TstGridposLog[], zones: DecodedZone[]): Map<string, string> {
  const teamFor = new Map<string, string>();
  const teamZones = zones
    .map((z) => ({ x: z.centerX, y: z.centerY, name: teamColorName(z.color[0], z.color[1], z.color[2]) }))
    .filter((z) => z.name);
  if (teamZones.length === 0) return teamFor;

  // Earliest position per (round, player) = their spawn.
  const spawn = new Map<string, TstGridposLog>();
  for (const log of logs) {
    const key = `${log.RoundId}|${log.Username}`;
    const prev = spawn.get(key);
    if (!prev || log.ElapsedTime < prev.ElapsedTime) spawn.set(key, log);
  }

  for (const [key, log] of spawn) {
    let best = "";
    let bestDist = Infinity;
    for (const z of teamZones) {
      const d = (log.PosX - z.x) ** 2 + (log.PosY - z.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = z.name;
      }
    }
    if (best) teamFor.set(key, best);
  }

  for (const log of logs) {
    const team = teamFor.get(`${log.RoundId}|${log.Username}`);
    if (team) log.Team = team;
  }
  return teamFor;
}
