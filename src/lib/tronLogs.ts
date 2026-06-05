import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isTstGridposLog, type TstGridposLog } from "@/types/tstLog";

const API_BASE = "http://tron.bwildprod.com:6578/api/TstData/GetLogsForMatch";
const CACHE_DIR = path.join(process.cwd(), ".cache", "match-logs");
const MATCH_ID_PATTERN = /^[a-f0-9]{24}$/i;

export type MatchLogSource = "cache" | "network";

export type MatchLogResult = {
  logs: TstGridposLog[];
  source: MatchLogSource;
  cachePath: string;
};

export function validateMatchId(matchId: string): string {
  const trimmed = matchId.trim();

  if (!MATCH_ID_PATTERN.test(trimmed)) {
    throw new Error("Match id must be a 24-character hex string.");
  }

  return trimmed.toLowerCase();
}

export function getMatchLogCachePath(matchId: string): string {
  return path.join(CACHE_DIR, `${validateMatchId(matchId)}.json`);
}

export async function getMatchLogs(matchId: string): Promise<MatchLogResult> {
  const safeMatchId = validateMatchId(matchId);
  const cachePath = getMatchLogCachePath(safeMatchId);

  try {
    const cached = await readFile(cachePath, "utf8");
    return { logs: parseLogs(cached), source: "cache", cachePath };
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }

  const url = new URL(API_BASE);
  url.searchParams.set("matchId", safeMatchId);

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`GetLogsForMatch failed with ${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  const logs = parseLogs(body);

  await mkdir(CACHE_DIR, { recursive: true });
  // Unique per write so concurrent conversions don't collide on a shared pid.
  const tempPath = `${cachePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(logs), "utf8");
  await rename(tempPath, cachePath);

  return { logs, source: "network", cachePath };
}

function parseLogs(body: string): TstGridposLog[] {
  const parsed: unknown = JSON.parse(body);

  if (!Array.isArray(parsed)) {
    throw new Error("GetLogsForMatch did not return an array.");
  }

  const logs = parsed.filter(isTstGridposLog);

  if (logs.length === 0 && parsed.length > 0) {
    throw new Error("GetLogsForMatch returned logs in an unexpected shape.");
  }

  return logs;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
