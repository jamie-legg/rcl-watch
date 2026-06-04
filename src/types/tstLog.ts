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
