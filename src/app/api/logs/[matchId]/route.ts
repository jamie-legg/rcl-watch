import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getMatchLogCachePath, validateMatchId } from "@/lib/tronLogs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM = "http://tron.bwildprod.com:6578/api/TstData/GetLogsForMatch";

export async function GET(_request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  let safeMatchId: string;

  try {
    const { matchId } = await params;
    safeMatchId = validateMatchId(matchId);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid match id.", 400);
  }

  const cachePath = getMatchLogCachePath(safeMatchId);

  // Cache hit: stream straight off disk with a real Content-Length so the client can
  // show an exact percentage.
  try {
    const info = await stat(cachePath);
    const fileStream = Readable.toWeb(createReadStream(cachePath)) as unknown as ReadableStream<Uint8Array>;
    return new Response(fileStream, {
      headers: {
        "content-type": "application/json",
        "content-length": String(info.size),
        "x-watch-bytes": String(info.size),
        "x-watch-cache": "cache",
        "cache-control": "no-store",
      },
    });
  } catch {
    // ENOENT (or unreadable) -> fall through to upstream.
  }

  // Cold load: stream the upstream response to the client AND tee a copy to disk so the
  // browser sees live progress instead of waiting for the whole ~18MB to land first.
  let upstream: Response;
  try {
    const url = new URL(UPSTREAM);
    url.searchParams.set("matchId", safeMatchId);
    upstream = await fetch(url, { cache: "no-store" });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Upstream request failed.", 502);
  }

  if (!upstream.ok || !upstream.body) {
    return jsonError(`GetLogsForMatch failed with ${upstream.status} ${upstream.statusText}`, 502);
  }

  const [toClient, toDisk] = upstream.body.tee();
  void persist(toDisk, cachePath);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-watch-cache": "network",
    "cache-control": "no-store",
  };
  // Upstream is chunked (no length); forward one only if it ever appears.
  const upstreamLength = upstream.headers.get("content-length");
  if (upstreamLength) {
    headers["content-length"] = upstreamLength;
    headers["x-watch-bytes"] = upstreamLength;
  }

  return new Response(toClient, { headers });
}

/** Best-effort write of the streamed body to the on-disk cache (atomic via temp+rename). */
async function persist(stream: ReadableStream<Uint8Array>, cachePath: string): Promise<void> {
  const tempPath = `${cachePath}.${process.pid}.tmp`;

  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await pipeline(Readable.fromWeb(stream as never), createWriteStream(tempPath));
    await rename(tempPath, cachePath);
  } catch {
    await unlink(tempPath).catch(() => {});
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}
