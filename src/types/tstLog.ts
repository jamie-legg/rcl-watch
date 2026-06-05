export type TstGridposLog = {
  $type?: string;
  Username: string;
  DirX: number;
  DirY: number;
  Speed: number;
  Rubber: number;
  Braking: number;
  BrakeReservoir: number;
  Team: string;
  PosX: number;
  PosY: number;
  RoundId: string;
  ElapsedTime: number;
  Id: string | null;
};

/** A kill: `Predator` fragged `Username` (the victim). Predator may be empty for suicides. */
export type TstCycleDestroyLog = {
  $type?: string;
  Username: string;
  Predator: string | null;
  Team: string;
  PosX: number;
  PosY: number;
  RoundId: string;
  ElapsedTime: number;
  Id: string | null;
};

/** A zone capture worth `Score` points for `Team`. */
export type TstConquerLog = {
  $type?: string;
  Usernames: string[];
  Team: string;
  Score: number;
  RoundId: string;
  ElapsedTime: number;
  Id: string | null;
};

/**
 * A map zone recovered from a recording's network stream (gZone, descriptor 340).
 * One model covers both fortress zones (fixed: radiusSlope 0) and the sumo/win
 * zone (shrinking: radiusSlope < 0). Centre/radius are in log/map coordinates.
 * radius(t) = radiusOffset + radiusSlope * (t - referenceTime).
 */
export type DecodedZone = {
  centerX: number;
  centerY: number;
  radiusOffset: number;
  radiusSlope: number;
  referenceTime: number;
  rotationSpeed: number;
  /** Team colour, 0..1 RGB. */
  color: [number, number, number];
};

/** A timeline event for the in-viewer console, bound to a round + elapsed time. */
export type MatchEvent = {
  roundId: string;
  time: number;
  kind: "round" | "elimination";
  text: string;
  team?: string;
};

/** The aarec convert API payload: gridpos logs plus recovered zones + events. */
export type DecodedRecording = {
  logs: TstGridposLog[];
  zones: DecodedZone[];
  events: MatchEvent[];
};

function typeName(value: unknown): string {
  if (value && typeof value === "object" && typeof (value as { $type?: unknown }).$type === "string") {
    return (value as { $type: string }).$type;
  }
  return "";
}

export function isCycleDestroyLog(value: unknown): value is TstCycleDestroyLog {
  if (!typeName(value).includes("CycleDestroyLog")) {
    return false;
  }
  const log = value as Partial<TstCycleDestroyLog>;
  return typeof log.Username === "string" && typeof log.Team === "string" && typeof log.RoundId === "string";
}

export function isConquerLog(value: unknown): value is TstConquerLog {
  if (!typeName(value).includes("ConquerLog")) {
    return false;
  }
  const log = value as Partial<TstConquerLog>;
  return typeof log.Team === "string" && typeof log.Score === "number" && typeof log.RoundId === "string";
}

export function isTstGridposLog(value: unknown): value is TstGridposLog {
  if (!value || typeof value !== "object") {
    return false;
  }

  const log = value as Partial<TstGridposLog>;
  return (
    typeof log.Username === "string" &&
    typeof log.Team === "string" &&
    typeof log.RoundId === "string" &&
    typeof log.PosX === "number" &&
    typeof log.PosY === "number" &&
    typeof log.DirX === "number" &&
    typeof log.DirY === "number" &&
    typeof log.Speed === "number" &&
    typeof log.ElapsedTime === "number"
  );
}
