import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { decodeAarec } from "@/lib/aarec/toGridpos";
import { recordingUrl, validateSegment } from "@/lib/armaRecordings";
import type { DecodedRecording, MatchEvent, TstGridposLog } from "@/types/tstLog";

/**
 * Downloads a tournament recording (`.zip` of one or more `.aarec`, or a bare
 * `.aarec`), decodes it to the viewer's recording shape (gridpos logs + zones +
 * events), and caches the JSON on disk. Recordings are immutable, so the cache
 * never expires.
 */

const CACHE_DIR = path.join(process.cwd(), ".cache", "aarec");
const FILE_PATTERN = /^[A-Za-z0-9._-]+\.(zip|aarec)$/i;

export function validateRecordingFile(file: string): string {
  const trimmed = file.trim();
  if (!FILE_PATTERN.test(trimmed)) {
    throw new Error("Recording file must be a .zip or .aarec name.");
  }
  return trimmed;
}

// Bump when the decoded JSON shape changes so stale caches are ignored.
const CACHE_SCHEMA = "v3";

export function getAarecCachePath(tournament: string, file: string): string {
  const slug = validateSegment(tournament);
  const safeFile = validateRecordingFile(file);
  return path.join(CACHE_DIR, `${slug}__${safeFile}.${CACHE_SCHEMA}.json`);
}

function bytesToText(bytes: Uint8Array): string {
  // `.aarec` is ASCII text (binary packets are stored as decimal ints), but
  // config values may contain latin1 bytes, so decode as latin1.
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

function offsetLogs(items: TstGridposLog[], roundOffset: number): TstGridposLog[] {
  if (roundOffset === 0) return items;
  return items.map((item) => ({
    ...item,
    RoundId: String(Number.parseInt(item.RoundId, 10) + roundOffset),
  }));
}

function offsetEvents(items: MatchEvent[], roundOffset: number): MatchEvent[] {
  if (roundOffset === 0) return items;
  return items.map((item) => ({
    ...item,
    roundId: String(Number.parseInt(item.roundId, 10) + roundOffset),
  }));
}

export async function convertRecording(tournament: string, file: string): Promise<DecodedRecording> {
  const url = recordingUrl(tournament, validateRecordingFile(file));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Recording fetch failed with ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  const logs: TstGridposLog[] = [];
  const events: MatchEvent[] = [];
  const zoneByKey = new Map<string, DecodedRecording["zones"][number]>();
  let roundOffset = 0;

  const ingest = (text: string) => {
    const decoded = decodeAarec(text);
    logs.push(...offsetLogs(decoded.logs, roundOffset));
    events.push(...offsetEvents(decoded.events, roundOffset));
    // Zones repeat across rounds/files; keep one per centre.
    for (const zone of decoded.zones) {
      const key = `${Math.round(zone.centerX)}|${Math.round(zone.centerY)}`;
      if (!zoneByKey.has(key)) zoneByKey.set(key, zone);
    }
    roundOffset += decoded.rounds;
  };

  if (/\.aarec$/i.test(file)) {
    ingest(bytesToText(bytes));
  } else {
    const archive = unzipSync(bytes);
    const names = Object.keys(archive)
      .filter((name) => /\.aarec$/i.test(name))
      .sort();
    for (const name of names) {
      ingest(bytesToText(archive[name]));
    }
  }

  return { logs, zones: [...zoneByKey.values()], events };
}

export async function getAarecRecording(tournament: string, file: string): Promise<DecodedRecording> {
  const cachePath = getAarecCachePath(tournament, file);
  try {
    return JSON.parse(await readFile(cachePath, "utf8")) as DecodedRecording;
  } catch {
    // cache miss -> convert
  }

  const recording = await convertRecording(tournament, file);
  await mkdir(CACHE_DIR, { recursive: true });
  // Unique per write: concurrent conversions of the same recording (e.g. a
  // double-fired client fetch) share process.pid, so a pid-only temp name
  // collides and the loser's rename hits ENOENT. rename is atomic, so the
  // last writer to finish simply wins.
  const tempPath = `${cachePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(recording), "utf8");
  await rename(tempPath, cachePath);
  return recording;
}
