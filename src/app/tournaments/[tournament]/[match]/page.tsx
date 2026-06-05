import { notFound } from "next/navigation";
import { PlaybackHub } from "@/components/playback/PlaybackHub";
import { validateSegment } from "@/lib/armaRecordings";
import { validateRecordingFile } from "@/lib/aarecLogs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WatchPageProps = {
  params: Promise<{ tournament: string; match: string }>;
};

export default async function TournamentWatchPage({ params }: WatchPageProps) {
  const { tournament, match } = await params;

  let slug: string;
  let file: string;
  try {
    slug = validateSegment(tournament);
    file = validateRecordingFile(match);
  } catch {
    notFound();
  }

  const logsUrl = `/api/aarec/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`;
  return (
    <PlaybackHub
      matchId={`${slug}/${file}`}
      logsUrl={logsUrl}
      reactionKind="recording"
      reactionId={`${slug}/${file}`}
    />
  );
}
