import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getAarecCachePath, getAarecRecording } from "@/lib/aarecLogs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Converts a tournament `.aarec` recording into the viewer's gridpos-log JSON.
 * Route: `/api/aarec/<tournament>/<file>` (e.g. `/api/aarec/tst33/round1_synny.zip`).
 *
 * Cache hits stream straight off disk with a real `Content-Length` so the
 * client shows an exact percentage; cold loads download + unzip + decode, cache
 * the JSON, then return it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;

  if (!segments || segments.length < 2) {
    return jsonError("Expected /api/aarec/<tournament>/<file>.", 400);
  }
  const tournament = segments[0];
  const file = segments.slice(1).join("/");

  let cachePath: string;
  try {
    cachePath = getAarecCachePath(tournament, file);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid recording path.", 400);
  }

  // Cache hit: stream off disk with a precise Content-Length.
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
    // fall through to conversion
  }

  // Cold load: download + decode (CPU-bound, no streaming progress).
  let body: string;
  try {
    const recording = await getAarecRecording(tournament, file);
    body = JSON.stringify(recording);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Recording conversion failed.", 502);
  }

  const bytes = Buffer.byteLength(body);
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "content-length": String(bytes),
      "x-watch-bytes": String(bytes),
      "x-watch-cache": "network",
      "cache-control": "no-store",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}
