import Link from "next/link";
import { AuthBar } from "@/components/auth/AuthBar";
import { ReactionBar } from "@/components/reactions/ReactionBar";
import { getMatches, type MatchMode } from "@/lib/tronMatches";
import {
  getCurrentProfileId,
  getRatingTotals,
  getUserReactions,
  ZERO_TOTALS,
} from "@/lib/reactions";
import type { MatchSummary, MatchTeam } from "@/types/tstMatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES: { id: MatchMode; label: string; tag: string }[] = [
  { id: "tst", label: "TST", tag: "Team Sumo" },
  { id: "fort", label: "Fortress", tag: "Fort" },
];

// Approximate team -> hue mapping for the roster dots.
const TEAM_COLORS: Record<string, string> = {
  purple: "#b06bff",
  orange: "#ff8a3d",
  ugly: "#3fe7ff",
  gold: "#f8c84a",
  blue: "#4aa3ff",
  green: "#7ed957",
  red: "#ff5470",
};

type SortMode = "recent" | "rating";

type HomeProps = {
  searchParams: Promise<{ mode?: string; page?: string; sort?: string; fav?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const { mode: rawMode, page: rawPage, sort: rawSort, fav: rawFav } = await searchParams;
  const mode: MatchMode = rawMode === "fort" ? "fort" : "tst";
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const sort: SortMode = rawSort === "rating" ? "rating" : "recent";
  const favOnly = rawFav === "1";

  let matches: MatchSummary[] = [];
  let failed = false;

  try {
    const result = await getMatches(mode, page);
    matches = result.matches;
  } catch {
    failed = true;
  }

  // Reactions: public totals for everyone, the viewer's own state when signed in.
  const profileId = await getCurrentProfileId();
  const signedIn = Boolean(profileId);
  const ids = matches.map((m) => m.id);
  const totals = await getRatingTotals(mode, ids);
  const mine = profileId ? await getUserReactions(profileId, mode, ids) : new Map();

  if (favOnly) {
    matches = matches.filter((m) => mine.get(m.id)?.favorite);
  }
  if (sort === "rating") {
    matches = [...matches].sort(
      (a, b) => (totals.get(b.id)?.score ?? 0) - (totals.get(a.id)?.score ?? 0),
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
          <AuthBar />
        </div>
      </header>

      <p className="eyebrow">Cinematic match playback</p>
      <h1 className="selector-title">Pick a match</h1>

      <nav className="selector-tabs" aria-label="Match type">
        {MODES.map((item) => (
          <Link
            key={item.id}
            className={`tab${item.id === mode ? " active" : ""}`}
            href={item.id === "tst" ? "/" : `/?mode=${item.id}`}
            prefetch={false}
          >
            {item.label}
            <em>{item.tag}</em>
          </Link>
        ))}
        <Link className="tab" href="/tournaments" prefetch={false}>
          View Tournament
          <em>.aarec replays</em>
        </Link>
      </nav>

      <div className="list-controls">
        <div className="seg" role="group" aria-label="Sort">
          <Link className={`seg-btn${sort === "recent" ? " active" : ""}`} href={listHref(mode, { sort: "recent", fav: favOnly })} prefetch={false}>
            Recent
          </Link>
          <Link className={`seg-btn${sort === "rating" ? " active" : ""}`} href={listHref(mode, { sort: "rating", fav: favOnly })} prefetch={false}>
            Top rated
          </Link>
        </div>
        <Link
          className={`seg-btn fav-toggle${favOnly ? " active" : ""}`}
          href={listHref(mode, { sort, fav: !favOnly })}
          prefetch={false}
        >
          ★ Favourites
        </Link>
      </div>

      {failed ? (
        <div className="selector-empty">
          <strong>Couldn&apos;t reach the match server.</strong>
          <span>Try again in a moment — the upstream history API didn&apos;t respond.</span>
        </div>
      ) : favOnly && matches.length === 0 ? (
        <div className="selector-empty">
          {signedIn ? (
            <>
              <strong>No favourites on this page.</strong>
              <span>Star matches to collect them here.</span>
            </>
          ) : (
            <>
              <strong>Sign in to use favourites.</strong>
              <span>Your starred matches will show up here.</span>
            </>
          )}
          <Link className="text-link" href={listHref(mode, { sort, fav: false })} prefetch={false}>
            Show all matches
          </Link>
        </div>
      ) : matches.length === 0 ? (
        <div className="selector-empty">
          <strong>No matches on this page.</strong>
          {page > 1 ? (
            <Link className="text-link" href={pageHref(mode, page - 1, { sort, fav: favOnly })} prefetch={false}>
              ◂ Back a page
            </Link>
          ) : (
            <span>Nothing here yet for {modeLabel(mode)}.</span>
          )}
        </div>
      ) : (
        <>
          <ul className="match-grid">
            {matches.map((match) => (
              <li key={match.id}>
                <Link className="match-card" href={mode === "fort" ? `/watch/${match.id}?mode=fort` : `/watch/${match.id}`} prefetch={false}>
                  <div className="match-card-top">
                    <span className="match-date">{formatDate(match.date)}</span>
                    <span className="match-tags">
                      <span className="match-tag">{match.roundCount} rounds</span>
                      <span className="match-tag">{formatDuration(match.totalTime)}</span>
                    </span>
                  </div>

                  <ul className="team-list">
                    {[...match.teams]
                      .sort((a, b) => b.score - a.score)
                      .map((team) => (
                        <li key={team.teamName} className={`team-row${team.isWinner ? " winner" : ""}`}>
                          <span className="team-dot" style={{ color: teamColor(team.teamName) }} />
                          <span className="team-name">{team.teamName}</span>
                          <span className="team-players">{playerNames(team)}</span>
                          <span className="team-score">{team.score}</span>
                        </li>
                      ))}
                  </ul>

                  <div className="match-card-foot">
                    <span className="match-go">Watch replay ▸</span>
                    <ReactionBar
                      kind={mode}
                      id={match.id}
                      signedIn={signedIn}
                      initialTotals={totals.get(match.id) ?? ZERO_TOTALS}
                      initialMine={mine.get(match.id) ?? { favorite: false, vote: 0 }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <nav className="pager" aria-label="Pagination">
            {page > 1 ? (
              <Link className="pager-link" href={pageHref(mode, page - 1, { sort, fav: favOnly })} prefetch={false}>
                ◂ Newer
              </Link>
            ) : (
              <span className="pager-link disabled">◂ Newer</span>
            )}
            <span className="pager-page">Page {page}</span>
            <Link className="pager-link" href={pageHref(mode, page + 1, { sort, fav: favOnly })} prefetch={false}>
              Older ▸
            </Link>
          </nav>
        </>
      )}
    </main>
  );
}

function listHref(mode: MatchMode, opts: { sort: SortMode; fav: boolean }): string {
  const params = new URLSearchParams();
  if (mode !== "tst") params.set("mode", mode);
  if (opts.sort === "rating") params.set("sort", "rating");
  if (opts.fav) params.set("fav", "1");
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function pageHref(mode: MatchMode, page: number, opts?: { sort?: SortMode; fav?: boolean }): string {
  const params = new URLSearchParams();
  if (mode !== "tst") {
    params.set("mode", mode);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  if (opts?.sort === "rating") params.set("sort", "rating");
  if (opts?.fav) params.set("fav", "1");
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function modeLabel(mode: MatchMode): string {
  return MODES.find((item) => item.id === mode)?.label ?? mode;
}

function teamColor(teamName: string): string {
  return TEAM_COLORS[teamName.toLowerCase()] ?? "#c6f534";
}

function playerNames(team: MatchTeam): string {
  return team.players.map((player) => player.nickname ?? player.username.split("@")[0]).join(", ");
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE_FORMAT.format(date);
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
