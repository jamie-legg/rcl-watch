import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

/**
 * Server-side index for the public Armagetron tournament recordings archive
 * (`http://vps-zman.armagetronad.org/~manuel/armarecordings/`). The server only
 * exposes an Apache autoindex, so we fetch + parse the HTML here (avoids
 * mixed-content/CORS in the browser) and cache it like `tronMatches.ts`.
 */

const BASE_URL = "http://vps-zman.armagetronad.org/~manuel/armarecordings/";
const CACHE_DIR = path.join(process.cwd(), ".cache", "arma-index");
const CACHE_TTL_MS = 5 * 60_000;

// Tournament folders are simple path segments; reject anything else to stop
// path traversal / SSRF into other hosts.
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

export type Tournament = {
  slug: string; // directory name (no trailing slash)
  name: string; // display name
  modified: string;
};

export type RecordingEntry = {
  file: string; // href within the tournament dir (e.g. "round1_synny.zip")
  name: string; // display name (extension stripped)
  modified: string;
  size: string;
};

export function validateSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!SEGMENT_PATTERN.test(trimmed)) {
    throw new Error("Invalid tournament name.");
  }
  return trimmed;
}

type IndexRow = { href: string; isDir: boolean; modified: string; size: string };

const ROW_PATTERN =
  /<a href="([^"]+)">[^<]*<\/a>\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;

function parseIndex(html: string): IndexRow[] {
  const rows: IndexRow[] = [];
  for (const match of html.matchAll(ROW_PATTERN)) {
    const href = match[1];
    // Skip sort links, the parent directory, and absolute links.
    if (href.startsWith("?") || href.startsWith("/") || href.startsWith("..")) continue;
    rows.push({
      href,
      isDir: href.endsWith("/"),
      modified: match[2].trim(),
      size: match[3].trim(),
    });
  }
  return rows;
}

async function fetchIndex(url: string): Promise<IndexRow[]> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Index fetch failed with ${response.status} ${response.statusText}`);
  }
  return parseIndex(await response.text());
}

type Envelope<T> = { fetchedAt: number; data: T };

async function readEnvelope<T>(cachePath: string): Promise<Envelope<T> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Envelope<T>).fetchedAt === "number" &&
      "data" in parsed
    ) {
      return parsed as Envelope<T>;
    }
  } catch {
    // fall through
  }
  return null;
}

async function writeEnvelope<T>(cachePath: string, envelope: Envelope<T>): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(envelope), "utf8");
  await rename(tempPath, cachePath);
}

async function cachedIndex<T>(cacheKey: string, url: string, transform: (rows: IndexRow[]) => T): Promise<T> {
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
  const cached = await readEnvelope<T>(cachePath);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const data = transform(await fetchIndex(url));
    await writeEnvelope(cachePath, { fetchedAt: Date.now(), data });
    return data;
  } catch (error) {
    if (cached) return cached.data; // stale-on-error
    throw error;
  }
}

export const getTournaments = cache(async (): Promise<Tournament[]> => {
  return cachedIndex("root", BASE_URL, (rows) =>
    rows
      .filter((row) => row.isDir)
      .map((row) => {
        const slug = decodeURIComponent(row.href.replace(/\/$/, ""));
        return { slug, name: slug.replace(/_/g, " "), modified: row.modified };
      })
      // newest tournaments first
      .sort((a, b) => b.modified.localeCompare(a.modified)),
  );
});

export const getTournamentEntries = cache(async (tournament: string): Promise<RecordingEntry[]> => {
  const slug = validateSegment(tournament);
  const url = `${BASE_URL}${encodeURIComponent(slug)}/`;
  return cachedIndex(`t-${slug}`, url, (rows) =>
    rows
      .filter((row) => !row.isDir && /\.(zip|aarec)$/i.test(row.href))
      .map((row) => {
        const file = row.href;
        const name = decodeURIComponent(file).replace(/\.(zip|aarec)$/i, "");
        return { file, name, modified: row.modified, size: row.size };
      }),
  );
});

export function recordingUrl(tournament: string, file: string): string {
  const slug = validateSegment(tournament);
  // `file` is an Apache href; keep it intact but block traversal.
  if (file.includes("/") || file.includes("..")) {
    throw new Error("Invalid recording file.");
  }
  return `${BASE_URL}${encodeURIComponent(slug)}/${file}`;
}
