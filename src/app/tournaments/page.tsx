import Link from "next/link";
import { AuthBar } from "@/components/auth/AuthBar";
import { getTournaments, type Tournament } from "@/lib/armaRecordings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TournamentsPage() {
  let tournaments: Tournament[] = [];
  let failed = false;

  try {
    tournaments = await getTournaments();
  } catch {
    failed = true;
  }

  return (
    <main className="selector-shell">
      <header className="selector-head">
        <div className="brand-mark">
          Retrocycles <em>League</em>
        </div>
        <div className="selector-head-actions">
          <span className="brand-tag">RCL · WATCH</span>
          <AuthBar />
        </div>
      </header>

      <p className="eyebrow">Tournament archive · armarecordings</p>
      <h1 className="selector-title">Pick a tournament</h1>

      <nav className="selector-tabs" aria-label="Sections">
        <Link className="tab" href="/" prefetch={false}>
          Matches
          <em>TST · Fort</em>
        </Link>
        <Link className="tab active" href="/tournaments" prefetch={false}>
          View Tournament
          <em>.aarec replays</em>
        </Link>
      </nav>

      {failed ? (
        <div className="selector-empty">
          <strong>Couldn&apos;t reach the recordings server.</strong>
          <span>The armarecordings archive didn&apos;t respond — try again in a moment.</span>
        </div>
      ) : tournaments.length === 0 ? (
        <div className="selector-empty">
          <strong>No tournaments found.</strong>
        </div>
      ) : (
        <ul className="match-grid">
          {tournaments.map((tournament) => (
            <li key={tournament.slug}>
              <Link
                className="match-card"
                href={`/tournaments/${encodeURIComponent(tournament.slug)}`}
                prefetch={false}
              >
                <div className="match-card-top">
                  <span className="match-date">{tournament.name}</span>
                  <span className="match-tags">
                    <span className="match-tag">{tournament.modified || "archive"}</span>
                  </span>
                </div>
                <span className="match-go">Browse recordings ▸</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
