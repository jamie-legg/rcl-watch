import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { isMatchSummary, type MatchSummary } from "@/types/tstMatch";

const API_BASE = "http://tron.bwildprod.com:6578/api/MatchHistory";
const CACHE_DIR = path.join(process.cwd(), ".cache", "match-lists");
// New matches land periodically, so the list isn't immutable like per-match logs.
// Serve from disk for this long before re-hitting upstream; stale cache is used as a
// fallback when the upstream call fails.
const CACHE_TTL_MS = 60_000;

export type MatchMode = "tst" | "fort";
export type MatchListSource = "cache" | "network" | "stale";

export type MatchListResult = {
  matches: MatchSummary[];
  source: MatchListSource;
};

const ENDPOINT: Record<MatchMode, string> = {
  tst: "GetTstMatches",
  fort: "GetFortMatches",
};

type CacheEnvelope = {
  fetchedAt: number;
  matches: MatchSummary[];
};

/**
 * Fetch a page of matches for a mode. Wrapped in `React.cache` so it runs at most once
 * per request render (no duplicate upstream calls when read in multiple places), and
 * backed by an on-disk TTL cache so repeat navigations reuse the response.
 */
export const getMatches = cache(async (mode: MatchMode, page = 1): Promise<MatchListResult> => {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const cachePath = path.join(CACHE_DIR, `${mode}-p${safePage}.json`);

  const cached = await readEnvelope(cachePath);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { matches: cached.matches, source: "cache" };
  }

  try {
    const matches = await fetchMatches(mode, safePage);
    await writeEnvelope(cachePath, { fetchedAt: Date.now(), matches });
    return { matches, source: "network" };
  } catch (error) {
    if (cached) {
      return { matches: cached.matches, source: "stale" };
    }

    throw error;
  }
});

async function fetchMatches(mode: MatchMode, page: number): Promise<MatchSummary[]> {
  const url = new URL(`${API_BASE}/${ENDPOINT[mode]}`);
  url.searchParams.set("page", String(page));

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`${ENDPOINT[mode]} failed with ${response.status} ${response.statusText}`);
  }

  const parsed: unknown = JSON.parse(await response.text());

  if (!Array.isArray(parsed)) {
    throw new Error(`${ENDPOINT[mode]} did not return an array.`);
  }

  return parsed.filter(isMatchSummary);
}

async function readEnvelope(cachePath: string): Promise<CacheEnvelope | null> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as CacheEnvelope).fetchedAt === "number" &&
      Array.isArray((parsed as CacheEnvelope).matches)
    ) {
      return parsed as CacheEnvelope;
    }

    return null;
  } catch {
    return null;
  }
}

async function writeEnvelope(cachePath: string, envelope: CacheEnvelope): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(envelope), "utf8");
  await rename(tempPath, cachePath);
}
