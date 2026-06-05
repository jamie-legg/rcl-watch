/**
 * Net-object schemas (in proto declaration order, with `legacy_*_end` markers)
 * and a stateful decoder that turns a stream of messages into cycle position
 * samples plus player/team identities.
 *
 * Descriptors:
 *   320 = gCycle        (CycleSync,        gCycle.proto)
 *   340 = gZone         (ZoneV1Sync,       gZone.proto) — win/fortress zones
 *   201 = ePlayerNetID  (PlayerNetIDSync,  ePlayer.proto)
 *   220 = eTeam         (TeamSync,         eTeam.proto)
 *     8 = sn_consoleOut (ConsoleMessage,   nNetwork.proto) — the server's text
 *         console (kills, conquests, holds, suicides, chat, round markers).
 *    24 = generic net-object sync envelope (nNetObject.cpp `net_sync`):
 *         [object_id word] + SECTION_Second of the object's class.
 *
 * Creation messages arrive on the class descriptor (320/201/220) as SECTION_All
 * and carry the object id + owner/player id; subsequent updates come as
 * descriptor-24 syncs.
 */

import type { StreamMessage } from "./packets";
import {
  asNumber,
  asObject,
  decodeStream,
  SECTION_ALL,
  SECTION_SECOND,
  type StreamField,
  type StreamObject,
} from "./stream";

export const DESCRIPTOR = {
  CYCLE: 320,
  ZONE: 340,
  PLAYER: 201,
  TEAM: 220,
  CONSOLE: 8,
  NET_SYNC: 24,
} as const;

const END: StreamField = { type: "endmarker" };

const NET_OBJECT_SYNC: StreamField[] = [
  { key: "object_id", type: "uint32" },
  { key: "owner_id", type: "uint32" },
  END,
  END,
];

const COORD: StreamField[] = [
  { key: "x", type: "float" },
  { key: "y", type: "float" },
  END,
];

const SHORT_COLOR: StreamField[] = [
  { key: "r", type: "uint32" },
  { key: "g", type: "uint32" },
  { key: "b", type: "uint32" },
  END,
];

const COLOR: StreamField[] = [
  { key: "r", type: "float" },
  { key: "g", type: "float" },
  { key: "b", type: "float" },
  END,
  { key: "a", type: "float" },
];

const NET_GAME_OBJECT_SYNC: StreamField[] = [
  { key: "base", type: "message", sub: NET_OBJECT_SYNC },
  { key: "player_id", type: "uint32" },
  { key: "autodelete", type: "bool" },
  END,
  { key: "last_time", type: "float" },
  { key: "direction", type: "message", sub: COORD },
  { key: "position", type: "message", sub: COORD },
  END,
];

const CYCLE_MOVEMENT_SYNC: StreamField[] = [
  { key: "base", type: "message", sub: NET_GAME_OBJECT_SYNC },
  END,
  END,
];

const CYCLE_SYNC: StreamField[] = [
  { key: "base", type: "message", sub: CYCLE_MOVEMENT_SYNC },
  { key: "color", type: "message", sub: COLOR },
  END,
  { key: "speed", type: "float" },
  { key: "alive", type: "bool" },
  { key: "distance", type: "float" },
  { key: "wall_id", type: "uint32" },
  { key: "turns", type: "uint32" },
  { key: "braking", type: "bool" },
  { key: "last_turn_position", type: "message", sub: COORD },
  { key: "rubber_compressed", type: "uint32" },
  { key: "rubber_effectiveness_compressed", type: "uint32" },
  { key: "last_message_id", type: "uint32" },
  { key: "brake_compressed", type: "uint32" },
  END,
];

// Tools.Function (tFunction.proto): a linear value offset + t*slope. Stream
// order is the proto declaration order: id, offset, slope, end.
const FUNCTION: StreamField[] = [
  { key: "id", type: "uint32" },
  { key: "offset", type: "float" },
  { key: "slope", type: "float" },
  END,
];

// gZone ZoneV1Sync (gZone.proto): creation section = base + create_time; sync
// section = color + reference_time + pos_x/pos_y/radius/rotation functions.
// base (eNetGameObject) also carries the zone centre as its position, which
// agrees with the pos_x/pos_y offsets.
const ZONE_SYNC: StreamField[] = [
  { key: "base", type: "message", sub: NET_GAME_OBJECT_SYNC },
  { key: "create_time", type: "float" },
  END,
  { key: "color", type: "message", sub: COLOR },
  { key: "reference_time", type: "float" },
  { key: "pos_x", type: "message", sub: FUNCTION },
  { key: "pos_y", type: "message", sub: FUNCTION },
  { key: "radius", type: "message", sub: FUNCTION },
  { key: "rotation_speed", type: "message", sub: FUNCTION },
  END,
];

const PLAYER_SYNC: StreamField[] = [
  { key: "base", type: "message", sub: NET_OBJECT_SYNC },
  END,
  { key: "color", type: "message", sub: SHORT_COLOR },
  { key: "ping_charity", type: "uint32" },
  { key: "player_name", type: "string" },
  { key: "ping", type: "float" },
  { key: "flags", type: "uint32" },
  { key: "score", type: "int32" },
  { key: "disconnected", type: "bool" },
  { key: "next_team_id", type: "uint32" },
  { key: "current_team_id", type: "uint32" },
  { key: "favorite", type: "int32" },
  { key: "name_team_after_me", type: "bool" },
  { key: "team_name", type: "string" },
  END,
];

const TEAM_SYNC: StreamField[] = [
  { key: "base", type: "message", sub: NET_OBJECT_SYNC },
  END,
  { key: "color", type: "message", sub: SHORT_COLOR },
  { key: "name", type: "string" },
  { key: "max_players", type: "int32" },
  { key: "max_imbalance", type: "int32" },
  { key: "score", type: "int32" },
  END,
];

// ConsoleMessage (nNetwork.proto): a single printed string. Not a net object,
// so it's decoded directly from word 0 (no object id).
const CONSOLE_MESSAGE: StreamField[] = [{ key: "message", type: "string" }, END];

const SCHEMAS: Record<number, StreamField[]> = {
  [DESCRIPTOR.CYCLE]: CYCLE_SYNC,
  [DESCRIPTOR.ZONE]: ZONE_SYNC,
  [DESCRIPTOR.PLAYER]: PLAYER_SYNC,
  [DESCRIPTOR.TEAM]: TEAM_SYNC,
};

export type CycleSyncSample = {
  /** Stream order index, shared across cycle + zone samples for round binding. */
  seq: number;
  objectId: number;
  playerId: number;
  time: number;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  distance: number;
  alive: boolean;
};

export type ZoneSample = {
  seq: number;
  objectId: number;
  time: number;
  x: number;
  y: number;
  /** radius(t) = radiusOffset + radiusSlope * (t - referenceTime). */
  radiusOffset: number;
  radiusSlope: number;
  referenceTime: number;
  rotationSpeed: number;
  /** 0..1 colour; (0,0,0) when the creation message hasn't been team-coloured yet. */
  r: number;
  g: number;
  b: number;
};

export type PlayerInfo = {
  name: string;
  teamId: number;
  teamName: string;
};

export type TeamInfo = {
  name: string;
  /** Short colour, 0..15 per channel. */
  r: number;
  g: number;
  b: number;
};

/** A raw console line printed by the server, in stream order. */
export type ConsoleSample = {
  seq: number;
  text: string;
};

const DEFAULT_TEAM_NAMES = new Set(["", "Empty team"]);

/** Name a team by its colour, the way AA does. Channel scale is irrelevant
 *  (normalised internally), so it works for 0..15 syncs and 0..1 zone colours. */
export function teamColorName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  if (max <= 0) return "";
  const R = r / max;
  const G = g / max;
  const B = b / max;
  if (B > 0.7 && R < 0.6 && G < 0.85) return "Team blue";
  if (R > 0.7 && G > 0.7 && B < 0.5) return "Team gold";
  if (R > 0.7 && G < 0.5 && B < 0.5) return "Team red";
  if (G > 0.7 && R < 0.6 && B < 0.6) return "Team green";
  if (R > 0.7 && B > 0.7 && G < 0.6) return "Team purple";
  if (G > 0.7 && B > 0.7 && R < 0.6) return "Team cyan";
  if (R > 0.7 && G > 0.4 && B < 0.5) return "Team orange";
  return "";
}

/** Nested lookup: get(obj, "base", "base", "position"). */
function get(obj: StreamObject | undefined, ...keys: string[]): StreamObject | undefined {
  let cur = obj;
  for (const k of keys) {
    cur = asObject(cur?.[k]);
    if (!cur) return undefined;
  }
  return cur;
}

export class AarecState {
  /** object id -> class descriptor (320/340/201/220). */
  private objClass = new Map<number, number>();
  /** cycle object id -> owning player object id. */
  private cycleOwner = new Map<number, number>();
  /** Monotonic stream-order counter shared by cycle/zone/console samples. */
  private seq = 0;

  readonly samples: CycleSyncSample[] = [];
  readonly zoneSamples: ZoneSample[] = [];
  readonly consoleSamples: ConsoleSample[] = [];
  readonly players = new Map<number, PlayerInfo>();
  readonly teams = new Map<number, TeamInfo>();

  feed(msg: StreamMessage): void {
    if (msg.descriptor === DESCRIPTOR.CONSOLE) {
      this.handleConsole(msg);
    } else if (msg.descriptor === DESCRIPTOR.NET_SYNC) {
      this.handleSync(msg);
    } else if (SCHEMAS[msg.descriptor]) {
      this.handleCreate(msg);
    }
  }

  private handleConsole(msg: StreamMessage): void {
    if (msg.words.length === 0) return;
    let decoded: StreamObject;
    try {
      decoded = decodeStream(msg.words, 0, CONSOLE_MESSAGE, SECTION_ALL);
    } catch {
      return;
    }
    if (typeof decoded.message === "string" && decoded.message) {
      this.consoleSamples.push({ seq: this.seq, text: decoded.message });
    }
  }

  private handleCreate(msg: StreamMessage): void {
    const schema = SCHEMAS[msg.descriptor];
    if (msg.words.length === 0) return;
    const objId = msg.words[0];
    this.objClass.set(objId, msg.descriptor);

    let decoded: StreamObject;
    try {
      decoded = decodeStream(msg.words, 0, schema, SECTION_ALL);
    } catch {
      return;
    }
    this.apply(msg.descriptor, objId, decoded);
  }

  private handleSync(msg: StreamMessage): void {
    if (msg.words.length === 0) return;
    const objId = msg.words[0];
    const cls = this.objClass.get(objId);
    if (!cls) return;
    const schema = SCHEMAS[cls];
    if (!schema) return;

    let decoded: StreamObject;
    try {
      decoded = decodeStream(msg.words, 1, schema, SECTION_SECOND);
    } catch {
      return;
    }
    this.apply(cls, objId, decoded);
  }

  private apply(cls: number, objId: number, decoded: StreamObject): void {
    switch (cls) {
      case DESCRIPTOR.CYCLE:
        this.applyCycle(objId, decoded);
        break;
      case DESCRIPTOR.ZONE:
        this.applyZone(objId, decoded);
        break;
      case DESCRIPTOR.PLAYER:
        this.applyPlayer(objId, decoded);
        break;
      case DESCRIPTOR.TEAM:
        this.applyTeam(objId, decoded);
        break;
    }
  }

  private applyCycle(objId: number, decoded: StreamObject): void {
    const ngo = get(decoded, "base", "base"); // NetGameObjectSync
    const playerId = asNumber(ngo?.player_id);
    if (playerId) this.cycleOwner.set(objId, playerId);

    const pos = get(ngo, "position");
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
    const dir = get(ngo, "direction");
    const owner = this.cycleOwner.get(objId) ?? 0;
    const time = asNumber(ngo?.last_time);
    const alive = decoded.alive !== false;

    this.samples.push({
      seq: this.seq++,
      objectId: objId,
      playerId: owner,
      time,
      x: pos.x,
      y: pos.y,
      dirX: asNumber(dir?.x),
      dirY: asNumber(dir?.y),
      speed: asNumber(decoded.speed),
      distance: asNumber(decoded.distance),
      alive,
    });
  }

  private applyZone(objId: number, decoded: StreamObject): void {
    const ngo = get(decoded, "base", "base"); // NetGameObjectSync
    const pos = get(ngo, "position");
    const posX = get(decoded, "pos_x");
    const posY = get(decoded, "pos_y");
    // Prefer the function offset (always present); fall back to base position.
    const x = posX ? asNumber(posX.offset) : asNumber(pos?.x);
    const y = posY ? asNumber(posY.offset) : asNumber(pos?.y);
    const radius = get(decoded, "radius");
    if (!radius && !pos) return;

    const color = get(decoded, "color");
    const rotation = get(decoded, "rotation_speed");
    this.zoneSamples.push({
      seq: this.seq++,
      objectId: objId,
      time: asNumber(ngo?.last_time),
      x,
      y,
      radiusOffset: asNumber(radius?.offset),
      radiusSlope: asNumber(radius?.slope),
      referenceTime: asNumber(decoded.reference_time),
      rotationSpeed: rotation ? asNumber(rotation.offset) : 0,
      r: asNumber(color?.r),
      g: asNumber(color?.g),
      b: asNumber(color?.b),
    });
  }

  private applyPlayer(objId: number, decoded: StreamObject): void {
    const prev = this.players.get(objId);
    const name = typeof decoded.player_name === "string" && decoded.player_name ? decoded.player_name : prev?.name ?? "";
    const teamName = typeof decoded.team_name === "string" && decoded.team_name ? decoded.team_name : prev?.teamName ?? "";
    this.players.set(objId, {
      name,
      teamId: asNumber(decoded.current_team_id, prev?.teamId ?? 0),
      teamName,
    });
  }

  private applyTeam(objId: number, decoded: StreamObject): void {
    const prev = this.teams.get(objId);
    const color = get(decoded, "color");
    const name = typeof decoded.name === "string" && decoded.name ? decoded.name : prev?.name ?? "";
    this.teams.set(objId, {
      name,
      r: color ? asNumber(color.r, prev?.r ?? 0) : prev?.r ?? 0,
      g: color ? asNumber(color.g, prev?.g ?? 0) : prev?.g ?? 0,
      b: color ? asNumber(color.b, prev?.b ?? 0) : prev?.b ?? 0,
    });
  }

  /**
   * Resolve a player's display team name. Teams whose synced name is the default
   * "Empty team" (or blank) are named by their colour, the way AA labels teams.
   */
  teamFor(playerId: number): string {
    const player = this.players.get(playerId);
    if (!player) return "";
    const team = this.teams.get(player.teamId);
    if (team) {
      if (!DEFAULT_TEAM_NAMES.has(team.name)) return team.name;
      const byColor = teamColorName(team.r, team.g, team.b);
      if (byColor) return byColor;
      if (team.name) return team.name;
    }
    return player.teamName || "";
  }

  nameFor(playerId: number): string {
    return this.players.get(playerId)?.name ?? "";
  }

  /** Resolve a (colour-code-stripped) player name to a team, for console kills. */
  teamForName(cleanedName: string): string {
    for (const [objId, player] of this.players) {
      if (player.name.replace(/0x[0-9a-fA-F]{6}/g, "").trim() === cleanedName) {
        const t = this.teamFor(objId);
        if (t) return t;
      }
    }
    return "";
  }
}
