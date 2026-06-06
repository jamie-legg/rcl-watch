import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountMenu } from "@/components/account/AccountMenu";
import { ReactionBar } from "@/components/reactions/ReactionBar";
import { getTournamentEntries, validateSegment, type RecordingEntry } from "@/lib/armaRecordings";
import {
  getCurrentProfileId,
  getRatingTotals,
  getUserReactions,
  ZERO_TOTALS,
} from "@/lib/reactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TournamentPageProps = {
  params: Promise<{ tournament: string }>;
};

export default async function TournamentPage({ params }: TournamentPageProps) {
  const { tournament } = await params;

  let slug: string;
  try {
    slug = validateSegment(tournament);
  } catch {
    notFound();
  }

  let entries: RecordingEntry[] = [];
  let failed = false;
  try {
    entries = await getTournamentEntries(slug);
  } catch {
    failed = true;
  }

  const profileId = await getCurrentProfileId();
  const signedIn = Boolean(profileId);
  const recIds = entries.map((e) => `${slug}/${e.file}`);
  const totals = await getRatingTotals("recording", recIds);
  const mine = profileId ? await getUserReactions(profileId, "recording", recIds) : new Map();

  return (
    <main className="selector-shell">
      <header className="selector-head">
        <div className="brand-mark">
          Retrocycles <em>League</em>
        </div>
        <div className="selector-head-actions">
          <span className="brand-tag">RCL · WATCH</span>
          <AccountMenu />
        </div>
      </header>

      <p className="eyebrow">
        <Link className="text-link" href="/tournaments" prefetch={false}>
          ◂ All tournaments
        </Link>
      </p>
      <h1 className="selector-title">{slug.replace(/_/g, " ")}</h1>

      {failed ? (
        <div className="selector-empty">
          <strong>Couldn&apos;t load this tournament.</strong>
          <span>The recordings server didn&apos;t respond — try again in a moment.</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="selector-empty">
          <strong>No recordings here.</strong>
          <span>This folder has no .zip / .aarec files.</span>
        </div>
      ) : (
        <ul className="match-grid">
          {entries.map((entry) => (
            <li key={entry.file}>
              <Link
                className="match-card"
                href={`/tournaments/${encodeURIComponent(slug)}/${encodeURIComponent(entry.file)}`}
                prefetch={false}
              >
                <div className="match-card-top">
                  <span className="match-date">{entry.name}</span>
                  <span className="match-tags">
                    {entry.size ? <span className="match-tag">{entry.size}</span> : null}
                    {entry.modified ? <span className="match-tag">{entry.modified}</span> : null}
                  </span>
                </div>
                <div className="match-card-foot">
                  <span className="match-go">Watch replay ▸</span>
                  <ReactionBar
                    kind="recording"
                    id={`${slug}/${entry.file}`}
                    signedIn={signedIn}
                    initialTotals={totals.get(`${slug}/${entry.file}`) ?? ZERO_TOTALS}
                    initialMine={mine.get(`${slug}/${entry.file}`) ?? { favorite: false, vote: 0 }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
