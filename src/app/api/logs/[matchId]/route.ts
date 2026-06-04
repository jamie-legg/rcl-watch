import { getMatchLogs } from "@/lib/tronLogs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  try {
    const { matchId } = await params;
    const { logs, source } = await getMatchLogs(matchId);

    return Response.json(logs, {
      headers: {
        "cache-control": "no-store",
        "x-watch-cache": source,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load match logs." },
      { status: 500 },
    );
  }
}
