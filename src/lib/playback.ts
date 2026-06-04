import type { TstGridposLog } from "@/types/tstLog";

export type PlaybackSample = {
  id: string;
  username: string;
  team: string;
  time: number;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  rubber: number;
  braking: boolean;
  brakeReservoir: number;
};

export type PlayerTrack = {
  username: string;
  team: string;
  color: string;
  samples: PlaybackSample[];
  trails: TrailSegment[];
  /** Elapsed time of the player's final log: in Armagetron terms, when this cycle died. */
  deathTime: number;
  /** Cumulative path distance travelled by the time of death (head distance at death). */
  deathDistance: number;
};

export type ArenaBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

export type RoundTimeline = {
  id: string;
  index: number;
  duration: number;
  bounds: ArenaBounds;
  players: PlayerTrack[];
};

export type MatchTimeline = {
  rounds: RoundTimeline[];
  players: Array<{ username: string; team: string; color: string }>;
  bounds: ArenaBounds;
  totalLogs: number;
};

export type PlayerState = PlaybackSample & {
  color: string;
  active: boolean;
  heading: number;
};

export type TrailSegment = {
  username: string;
  team: string;
  color: string;
  from: [number, number];
  to: [number, number];
  fromTime: number;
  toTime: number;
  age: number;
  /** Cumulative path distance (m) of the player at the start of this segment. */
  fromDist: number;
  /** Cumulative path distance (m) of the player at the end of this segment. */
  toDist: number;
  /** 0..1 render strength used to fade a wall out as it expires after death. */
  intensity: number;
};

export type ExplosionState = {
  username: string;
  color: string;
  x: number;
  y: number;
  /** 0..1 progress through the explosion animation. */
  progress: number;
};

export type RoundSnapshot = {
  players: PlayerState[];
  trails: TrailSegment[];
  explosions: ExplosionState[];
};

/** Armagetron cycle physics that govern how walls live and die. */
export type PhysicsSettings = {
  /** CYCLE_WALL_LENGTH: max wall length behind a cycle, measured along its odometer (<= 0 = infinite). */
  wallsLength: number;
  /** CYCLE_WALLS_STAY_UP_DELAY: seconds a dead cycle's walls remain before vanishing (< 0 = forever). */
  wallsStayUpDelay: number;
};

export const DEFAULT_PHYSICS: PhysicsSettings = {
  // RCL server config: 400m finite walls, 8s stay-up after death.
  wallsLength: 400,
  wallsStayUpDelay: 8,
};

/** Seconds an explosion animation plays for after a cycle dies (gExplosion fades by ~2s). */
export const EXPLOSION_DURATION = 2;

// Sumo/fortress win-zone from the map's <ShapeCircle radius growth><Point x y/>:
// radius is linear in time and the centre is a fixed map coordinate (NOT the arena centre).
// Defaults match the TST map (Titanoboa public-1.aamap.xml):
//   <ShapeCircle radius="50" growth="-0.5"><Point x="60" y="60"/></ShapeCircle>
export type ZoneSettings = {
  enabled: boolean;
  /** ShapeCircle radius: starting radius in game units. */
  initialRadius: number;
  /** -growth: how fast the radius shrinks per second (positive number). */
  shrinkPerSecond: number;
  /** Point x/y: zone centre in map/log coordinates. */
  centerX: number;
  centerY: number;
};

export const DEFAULT_ZONE: ZoneSettings = {
  enabled: true,
  initialRadius: 50,
  shrinkPerSecond: 0.5,
  centerX: 60,
  centerY: 60,
};

/** Effective zone radius at a given time, or null when disabled. radius(t) = initial + growth*t. */
export function zoneRadiusAt(time: number, zone: ZoneSettings): number | null {
  if (!zone.enabled) {
    return null;
  }

  return Math.max(0, zone.initialRadius - zone.shrinkPerSecond * Math.max(0, time));
}

const FALLBACK_BOUNDS: ArenaBounds = {
  minX: -60,
  maxX: 60,
  minY: -60,
  maxY: 60,
  centerX: 0,
  centerY: 0,
  width: 120,
  height: 120,
};

const TEAM_COLORS = new Map<string, string>([
  ["team_gold", "#f8c84a"],
  ["team_ugly", "#2ce8ff"],
  ["team_orange", "#ff9533"],
  ["team_purple", "#a25bff"],
  ["team_blue", "#46a7ff"],
  ["team_red", "#ff4a57"],
  ["team_green", "#44f59b"],
]);

export function normalizeMatchLogs(logs: TstGridposLog[]): MatchTimeline {
  const roundsById = new Map<string, TstGridposLog[]>();
  const playersByName = new Map<string, { username: string; team: string; color: string }>();

  for (const log of logs) {
    if (!Number.isFinite(log.ElapsedTime) || !Number.isFinite(log.PosX) || !Number.isFinite(log.PosY)) {
      continue;
    }

    const roundLogs = roundsById.get(log.RoundId) ?? [];
    roundLogs.push(log);
    roundsById.set(log.RoundId, roundLogs);

    if (!playersByName.has(log.Username)) {
      playersByName.set(log.Username, {
        username: log.Username,
        team: log.Team,
        color: colorForTeam(log.Team, playersByName.size),
      });
    }
  }

  const rounds = Array.from(roundsById.entries()).map(([id, roundLogs], index) => {
    roundLogs.sort((a, b) => a.ElapsedTime - b.ElapsedTime || a.Username.localeCompare(b.Username));
    const tracksByUser = new Map<string, PlaybackSample[]>();

    for (const log of roundLogs) {
      const samples = tracksByUser.get(log.Username) ?? [];
      samples.push(toSample(log));
      tracksByUser.set(log.Username, samples);
    }

    const players = buildRoundTracks(tracksByUser, playersByName, index);

    return {
      id,
      index,
      duration: roundLogs.at(-1)?.ElapsedTime ?? 0,
      bounds: boundsForSamples(players.flatMap((player) => player.samples)),
      players,
    };
  });

  rounds.sort((a, b) => a.index - b.index);

  return {
    rounds,
    players: Array.from(playersByName.values()).sort((a, b) => a.username.localeCompare(b.username)),
    bounds: boundsForSamples(rounds.flatMap((round) => round.players.flatMap((player) => player.samples))),
    totalLogs: logs.length,
  };
}

export function getRoundSnapshot(
  round: RoundTimeline,
  time: number,
  physics: PhysicsSettings = DEFAULT_PHYSICS,
): RoundSnapshot {
  const clampedTime = clamp(time, 0, round.duration);
  const players: PlayerState[] = [];
  const trails: TrailSegment[] = [];
  const explosions: ExplosionState[] = [];

  for (const track of round.players) {
    const alive = clampedTime <= track.deathTime + 0.0001;

    // Only living cycles get a marker; a dead cycle is replaced by its explosion.
    if (alive) {
      const state = interpolateTrack(track, clampedTime);
      if (state) {
        players.push(state);
      }
    } else {
      const sinceDeath = clampedTime - track.deathTime;
      if (sinceDeath >= 0 && sinceDeath <= EXPLOSION_DURATION) {
        const last = track.samples.at(-1);
        if (last) {
          explosions.push({
            username: track.username,
            color: track.color,
            x: last.x,
            y: last.y,
            progress: clamp(sinceDeath / EXPLOSION_DURATION, 0, 1),
          });
        }
      }
    }

    trails.push(...trailForTrack(track, clampedTime, physics));
  }

  return { players, trails, explosions };
}

export function interpolateTrack(track: PlayerTrack, time: number): PlayerState | null {
  const samples = track.samples;

  if (samples.length === 0) {
    return null;
  }

  if (time <= samples[0].time) {
    return withVisualState(samples[0], track, true);
  }

  const last = samples[samples.length - 1];
  if (time >= last.time) {
    return withVisualState(last, track, time - last.time < 0.8);
  }

  let low = 0;
  let high = samples.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].time < time) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const next = samples[low];
  const previous = samples[Math.max(0, low - 1)];
  const span = Math.max(0.001, next.time - previous.time);
  const t = clamp((time - previous.time) / span, 0, 1);

  return withVisualState(
    {
      ...next,
      time,
      ...interpolateOrthogonalPosition(previous, next, t),
      speed: lerp(previous.speed, next.speed, t),
      rubber: lerp(previous.rubber, next.rubber, t),
      brakeReservoir: lerp(previous.brakeReservoir, next.brakeReservoir, t),
      dirX: Math.abs(next.dirX) + Math.abs(next.dirY) > 0 ? next.dirX : previous.dirX,
      dirY: Math.abs(next.dirX) + Math.abs(next.dirY) > 0 ? next.dirY : previous.dirY,
      braking: previous.braking || next.braking,
    },
    track,
    true,
  );
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${minutes}:${wholeSeconds.toString().padStart(2, "0")}.${tenths}`;
}

function toSample(log: TstGridposLog): PlaybackSample {
  return {
    id: log.Id ?? `${log.Username}@${log.RoundId}:${log.ElapsedTime}`,
    username: log.Username,
    team: log.Team,
    time: log.ElapsedTime,
    x: log.PosX,
    y: log.PosY,
    dirX: log.DirX,
    dirY: log.DirY,
    speed: log.Speed,
    rubber: log.Rubber,
    braking: log.Braking !== 0,
    brakeReservoir: log.BrakeReservoir,
  };
}

function withVisualState(sample: PlaybackSample, track: PlayerTrack, active: boolean): PlayerState {
  return {
    ...sample,
    color: track.color,
    active,
    heading: Math.atan2(-sample.dirY, sample.dirX),
  };
}

function buildRoundTracks(
  tracksByUser: Map<string, PlaybackSample[]>,
  playersByName: Map<string, { username: string; team: string; color: string }>,
  roundIndex: number,
): PlayerTrack[] {
  const tracks = Array.from(tracksByUser.entries())
    .map(([username, samples]) => {
      samples.sort((a, b) => a.time - b.time);
      const first = samples[0];
      const team = first?.team ?? "unknown";
      const color = playersByName.get(username)?.color ?? colorForTeam(team, roundIndex);
      return {
        username,
        team,
        color,
        samples: [...samples],
        trails: [] as TrailSegment[],
        deathTime: samples.at(-1)?.time ?? 0,
        deathDistance: 0,
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));

  // Each bike's logged samples already encode its full lifetime: the final sample
  // is where it actually died. We reconstruct the orthogonal (90-degree) path the
  // game would have taken between sparse logs for trails, but we never infer death
  // from geometric intersections — doing so produced false positives that froze
  // every bike a few seconds in.
  //
  // Wall length (CYCLE_WALL_LENGTH) is measured along the cycle's ODOMETER — the
  // game's gCycle::GetDistance() integrates speed over time (distance += speed*dt).
  // That odometer runs ~40% longer than the geometry of the sparse logged positions
  // (lost to under-sampled turns), so measuring wall recession geometrically made it
  // drift out of sync. We therefore parameterise each segment by integrated speed and
  // distribute a move's odometer span across its reconstructed legs by geometry.
  for (const track of tracks) {
    const samples = track.samples;
    const odometer = new Array<number>(samples.length);
    odometer[0] = 0;
    for (let index = 1; index < samples.length; index += 1) {
      const dt = Math.max(0, samples[index].time - samples[index - 1].time);
      odometer[index] = odometer[index - 1] + 0.5 * (samples[index - 1].speed + samples[index].speed) * dt;
    }

    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];
      const distance = Math.hypot(current.x - previous.x, current.y - previous.y);

      if (distance < 0.04 || distance > 8) {
        continue;
      }

      const odoStart = odometer[index - 1];
      const odoEnd = odometer[index];
      const segments = buildMoveSegments(track, previous, current);
      const geomTotal = segments.reduce((sum, segment) => sum + distanceBetween(segment.from, segment.to), 0);
      let geomAccumulated = 0;

      for (const segment of segments) {
        const segLength = distanceBetween(segment.from, segment.to);
        segment.fromDist = lerp(odoStart, odoEnd, geomTotal > 0 ? geomAccumulated / geomTotal : 0);
        geomAccumulated += segLength;
        segment.toDist = lerp(odoStart, odoEnd, geomTotal > 0 ? geomAccumulated / geomTotal : 1);
        track.trails.push(segment);
      }
    }

    track.deathDistance = odometer[samples.length - 1] ?? 0;
  }

  return tracks;
}

function trailForTrack(track: PlayerTrack, time: number, physics: PhysicsSettings): TrailSegment[] {
  const alive = time <= track.deathTime + 0.0001;

  // Walls disappear `wallsStayUpDelay` seconds after death (CYCLE_WALLS_STAY_UP_DELAY).
  // We fade them over the last 0.4s so they don't pop out.
  let intensity = 1;
  if (!alive && physics.wallsStayUpDelay >= 0) {
    const remaining = track.deathTime + physics.wallsStayUpDelay - time;
    if (remaining <= 0) {
      return [];
    }
    if (remaining < 0.4) {
      intensity = remaining / 0.4;
    }
  }

  // Head distance along the path right now. While alive the tail recedes with the
  // cycle; after death the head (and therefore the whole wall) freezes.
  const headDist = alive ? headDistanceAtTime(track, time) : track.deathDistance;
  const tailDist = physics.wallsLength > 0 ? headDist - physics.wallsLength : Number.NEGATIVE_INFINITY;

  const out: TrailSegment[] = [];

  for (const segment of track.trails) {
    // Skip segments not laid down yet.
    if (segment.fromTime > time) {
      continue;
    }

    // The far end of the actively-drawn segment only reaches the cycle's head.
    const segTail = segment.fromDist;
    const segHead = Math.min(segment.toDist, headDist);

    if (segHead <= segTail) {
      continue;
    }

    // Clip to the receding wall window [tailDist, headDist].
    const visibleFrom = Math.max(segTail, tailDist);
    const visibleTo = segHead;

    if (visibleTo <= visibleFrom) {
      continue;
    }

    const span = segment.toDist - segment.fromDist;
    const fromFrac = span > 0 ? (visibleFrom - segment.fromDist) / span : 0;
    const toFrac = span > 0 ? (visibleTo - segment.fromDist) / span : 1;

    out.push({
      ...segment,
      from: pointAlong(segment.from, segment.to, fromFrac),
      to: pointAlong(segment.from, segment.to, toFrac),
      fromDist: visibleFrom,
      toDist: visibleTo,
      age: Math.max(0, time - segment.toTime),
      intensity,
    });
  }

  return out;
}

function headDistanceAtTime(track: PlayerTrack, time: number): number {
  const segments = track.trails;

  if (segments.length === 0) {
    return 0;
  }

  if (time <= segments[0].fromTime) {
    return segments[0].fromDist;
  }

  const last = segments[segments.length - 1];
  if (time >= last.toTime) {
    return last.toDist;
  }

  let low = 0;
  let high = segments.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (segments[mid].toTime < time) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const segment = segments[Math.min(low, segments.length - 1)];

  if (time <= segment.fromTime) {
    return segment.fromDist;
  }

  const timeSpan = Math.max(0.0001, segment.toTime - segment.fromTime);
  const t = clamp((time - segment.fromTime) / timeSpan, 0, 1);
  return lerp(segment.fromDist, segment.toDist, t);
}

function pointAlong(from: [number, number], to: [number, number], t: number): [number, number] {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t)];
}

function buildMoveSegments(
  track: Pick<PlayerTrack, "username" | "team" | "color">,
  previous: PlaybackSample,
  current: PlaybackSample,
): TrailSegment[] {
  const segments: TrailSegment[] = [];
  const points = orthogonalPathPoints(previous, current);
  const totalDistance = Math.max(
    0.001,
    points.slice(1).reduce((sum, point, index) => sum + distanceBetween(points[index], point), 0),
  );
  let elapsedDistance = 0;

  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const from = points[pointIndex - 1];
    const to = points[pointIndex];
    const legDistance = distanceBetween(from, to);
    const fromTime = lerp(previous.time, current.time, elapsedDistance / totalDistance);
    const toTime = lerp(previous.time, current.time, (elapsedDistance + legDistance) / totalDistance);
    elapsedDistance += legDistance;

    appendTrailSegment(segments, {
      username: track.username,
      team: track.team,
      color: track.color,
      from,
      to,
      fromTime,
      toTime,
      age: 0,
      fromDist: 0,
      toDist: 0,
      intensity: 1,
    });
  }

  return segments;
}

function appendTrailSegment(segments: TrailSegment[], segment: TrailSegment) {
  const [fromX, fromY] = segment.from;
  const [toX, toY] = segment.to;
  const length = Math.hypot(toX - fromX, toY - fromY);

  if (length < 0.04) {
    return;
  }

  segments.push(segment);
}

function interpolateOrthogonalPosition(
  previous: PlaybackSample,
  current: PlaybackSample,
  t: number,
): Pick<PlaybackSample, "x" | "y"> {
  const points = orthogonalPathPoints(previous, current);

  if (points.length === 2) {
    return {
      x: lerp(points[0][0], points[1][0], t),
      y: lerp(points[0][1], points[1][1], t),
    };
  }

  const firstLength = distanceBetween(points[0], points[1]);
  const secondLength = distanceBetween(points[1], points[2]);
  const total = Math.max(0.001, firstLength + secondLength);
  const target = t * total;

  if (target <= firstLength) {
    const legT = firstLength <= 0 ? 1 : target / firstLength;
    return {
      x: lerp(points[0][0], points[1][0], legT),
      y: lerp(points[0][1], points[1][1], legT),
    };
  }

  const legT = secondLength <= 0 ? 1 : (target - firstLength) / secondLength;
  return {
    x: lerp(points[1][0], points[2][0], legT),
    y: lerp(points[1][1], points[2][1], legT),
  };
}

function orthogonalPathPoints(previous: PlaybackSample, current: PlaybackSample): Array<[number, number]> {
  const from: [number, number] = [previous.x, previous.y];
  const to: [number, number] = [current.x, current.y];

  // The cycle drives straight along its current heading, then turns once to reach
  // the next log. Place the corner accordingly and ALWAYS finish on `current` so the
  // reconstructed wall ends exactly where the bike is (it must sit at its own tail).
  const firstAxis = movementAxis(previous, current);
  const corner: [number, number] =
    firstAxis === "x" ? [current.x, previous.y] : [previous.x, current.y];

  return [from, corner, to];
}

function movementAxis(previous: PlaybackSample, current: PlaybackSample): "x" | "y" {
  const direction = directionAxis(previous);

  if (direction) {
    return direction;
  }

  return Math.abs(current.x - previous.x) >= Math.abs(current.y - previous.y) ? "x" : "y";
}

function directionAxis(sample: Pick<PlaybackSample, "dirX" | "dirY">): "x" | "y" | null {
  if (Math.abs(sample.dirX) > Math.abs(sample.dirY)) {
    return "x";
  }

  if (Math.abs(sample.dirY) > 0) {
    return "y";
  }

  return null;
}

function distanceBetween(from: [number, number], to: [number, number]): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1]);
}

function boundsForSamples(samples: PlaybackSample[]): ArenaBounds {
  if (samples.length === 0) {
    return FALLBACK_BOUNDS;
  }

  const padding = 16;
  const minX = Math.min(...samples.map((sample) => sample.x)) - padding;
  const maxX = Math.max(...samples.map((sample) => sample.x)) + padding;
  const minY = Math.min(...samples.map((sample) => sample.y)) - padding;
  const maxY = Math.max(...samples.map((sample) => sample.y)) + padding;
  const width = Math.max(40, maxX - minX);
  const height = Math.max(40, maxY - minY);

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width,
    height,
  };
}

function colorForTeam(team: string, index: number): string {
  const normalized = team.toLowerCase();
  const known = TEAM_COLORS.get(normalized);

  if (known) {
    return known;
  }

  const hue = Math.abs(hashString(`${team}:${index}`)) % 360;
  return `hsl(${hue} 88% 62%)`;
}

function hashString(value: string): number {
  return value.split("").reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
