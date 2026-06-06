import Link from "next/link";
import { AccountMenu } from "@/components/account/AccountMenu";
import { ReactionBar } from "@/components/reactions/ReactionBar";
import { getTournaments, type Tournament } from "@/lib/armaRecordings";
import {
  getCurrentProfileId,
  getRatingTotals,
  getUserReactions,
  ZERO_TOTALS,
} from "@/lib/reactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SortMode = "recent" | "rating";

type TournamentsProps = {
  searchParams: Promise<{ sort?: string; fav?: string }>;
};

export default async function TournamentsPage({ searchParams }: TournamentsProps) {
  const { sort: rawSort, fav: rawFav } = await searchParams;
  const sort: SortMode = rawSort === "rating" ? "rating" : "recent";
  const favOnly = rawFav === "1";

  let tournaments: Tournament[] = [];
  let failed = false;

  try {
    tournaments = await getTournaments();
  } catch {
    failed = true;
  }

  const profileId = await getCurrentProfileId();
  const signedIn = Boolean(profileId);
  const slugs = tournaments.map((t) => t.slug);
  const totals = await getRatingTotals("tournament", slugs);
  const mine = profileId ? await getUserReactions(profileId, "tournament", slugs) : new Map();

  if (favOnly) {
    tournaments = tournaments.filter((t) => mine.get(t.slug)?.favorite);
  }
  if (sort === "rating") {
    tournaments = [...tournaments].sort(
      (a, b) => (totals.get(b.slug)?.score ?? 0) - (totals.get(a.slug)?.score ?? 0),
    );
  }

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
        <Link className="tab" href="/me" prefetch={false}>
          My matches
          <em>history</em>
        </Link>
      </nav>

      <div className="list-controls">
        <div className="seg" role="group" aria-label="Sort">
          <Link className={`seg-btn${sort === "recent" ? " active" : ""}`} href={tHref({ sort: "recent", fav: favOnly })} prefetch={false}>
            Recent
          </Link>
          <Link className={`seg-btn${sort === "rating" ? " active" : ""}`} href={tHref({ sort: "rating", fav: favOnly })} prefetch={false}>
            Top rated
          </Link>
        </div>
        <Link className={`seg-btn fav-toggle${favOnly ? " active" : ""}`} href={tHref({ sort, fav: !favOnly })} prefetch={false}>
          ★ Favourites
        </Link>
      </div>

      {failed ? (
        <div className="selector-empty">
          <strong>Couldn&apos;t reach the recordings server.</strong>
          <span>The armarecordings archive didn&apos;t respond — try again in a moment.</span>
        </div>
      ) : favOnly && tournaments.length === 0 ? (
        <div className="selector-empty">
          {signedIn ? (
            <>
              <strong>No favourite tournaments yet.</strong>
              <span>Star a tournament to collect it here.</span>
            </>
          ) : (
            <>
              <strong>Sign in to use favourites.</strong>
              <span>Your starred tournaments will show up here.</span>
            </>
          )}
          <Link className="text-link" href={tHref({ sort, fav: false })} prefetch={false}>
            Show all tournaments
          </Link>
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
                <div className="match-card-foot">
                  <span className="match-go">Browse recordings ▸</span>
                  <ReactionBar
                    kind="tournament"
                    id={tournament.slug}
                    signedIn={signedIn}
                    initialTotals={totals.get(tournament.slug) ?? ZERO_TOTALS}
                    initialMine={mine.get(tournament.slug) ?? { favorite: false, vote: 0 }}
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

function tHref(opts: { sort: SortMode; fav: boolean }): string {
  const params = new URLSearchParams();
  if (opts.sort === "rating") params.set("sort", "rating");
  if (opts.fav) params.set("fav", "1");
  const query = params.toString();
  return query ? `/tournaments?${query}` : "/tournaments";
}
