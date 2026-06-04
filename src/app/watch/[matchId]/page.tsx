import { PlaybackHub } from "@/components/playback/PlaybackHub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WatchPageProps = {
  params: Promise<{ matchId: string }>;
};

export default async function WatchPage({ params }: WatchPageProps) {
  const { matchId } = await params;

  return <PlaybackHub matchId={matchId} />;
}
