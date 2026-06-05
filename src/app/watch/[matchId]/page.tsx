import { PlaybackHub } from "@/components/playback/PlaybackHub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WatchPageProps = {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{ mode?: string }>;
};

export default async function WatchPage({ params, searchParams }: WatchPageProps) {
  const { matchId } = await params;
  const { mode } = await searchParams;
  const reactionKind = mode === "fort" ? "fort" : "tst";

  return <PlaybackHub matchId={matchId} reactionKind={reactionKind} reactionId={matchId} />;
}
