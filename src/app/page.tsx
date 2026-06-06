import Link from "next/link";
import { AccountMenu } from "@/components/account/AccountMenu";
import { ReactionBar } from "@/components/reactions/ReactionBar";
import { getMatches, type MatchMode } from "@/lib/tronMatches";
import {
  getCurrentProfileId,
  getRatingTotals,
  getUserReactions,
  listUserFavorites,
  ZERO_TOTALS,
  type MatchKind,
  type RatingTotals,
  type UserReaction,
} from "@/lib/reactions";
import { getMatchHistory } from "@/lib/history";
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

  const profileId = await getCurrentProfileId();
  const signedIn = Boolean(profileId);

  // Favourites is a GLOBAL view (across modes, pages, and kinds) rather than a
  // filter over the current page — so a match starred from history shows up here.
  const favCards = favOnly && profileId ? await buildFavCards(profileId) : null;

  let matches: MatchSummary[] = [];
  let failed = false;
  let totals = new Map<string, RatingTotals>();
  let mine = new Map<string, UserReaction>();

  if (!favOnly) {
    try {
      const result = await getMatches(mode, page);
      matches = result.matches;
    } catch {
      failed = true;
    }
    const ids = matches.map((m) => m.id);
    totals = await getRatingTotals(mode, ids);
    mine = profileId ? await getUserReactions(profileId, mode, ids) : new Map();
    if (sort === "rating") {
      matches = [...matches].sort(
        (a, b) => (totals.get(b.id)?.score ?? 0) - (totals.get(a.id)?.score ?? 0),
      );
    }
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

      <p className="eyebrow">{favOnly ? "Your collection" : "Cinematic match playback"}</p>
      <h1 className="selector-title">{favOnly ? "Favourites" : "Pick a match"}</h1>

      <nav className="selector-tabs" aria-label="Match type">
        {MODES.map((item) => (
          <Link
            key={item.id}
            className={`tab${!favOnly && item.id === mode ? " active" : ""}`}
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
        <Link className="tab" href="/me" prefetch={false}>
          My matches
          <em>history</em>
        </Link>
      </nav>

      <div className="list-controls">
        {!favOnly && (
          <div className="seg" role="group" aria-label="Sort">
            <Link className={`seg-btn${sort === "recent" ? " active" : ""}`} href={listHref(mode, { sort: "recent", fav: favOnly })} prefetch={false}>
              Recent
            </Link>
            <Link className={`seg-btn${sort === "rating" ? " active" : ""}`} href={listHref(mode, { sort: "rating", fav: favOnly })} prefetch={false}>
              Top rated
            </Link>
          </div>
        )}
        <Link
          className={`seg-btn fav-toggle${favOnly ? " active" : ""}`}
          href={listHref(mode, { sort, fav: !favOnly })}
          prefetch={false}
        >
          ★ {favOnly ? "Showing favourites · show all" : "Favourites"}
        </Link>
      </div>

      {favOnly ? (
        !signedIn ? (
          <div className="selector-empty">
            <strong>Sign in to use favourites.</strong>
            <span>Your starred matches show up here, from anywhere on Watch.</span>
            <Link className="text-link" href={listHref(mode, { sort, fav: false })} prefetch={false}>
              Show all matches
            </Link>
          </div>
        ) : favCards && favCards.length > 0 ? (
          <ul className="match-grid">
            {favCards.map((card) => (
              <li key={`${card.kind}:${card.id}`}>
                <Link className="match-card" href={card.href} prefetch={false}>
                  <div className="match-card-top">
                    <span className="match-date">{card.date ?? card.title}</span>
                    <span className="match-tags">
                      <span className="match-tag">{card.badge}</span>
                    </span>
                  </div>

                  {card.teams ? (
                    <ul className="team-list">
                      {card.teams.map((team) => (
                        <li key={team.teamName} className={`team-row${team.isWinner ? " winner" : ""}`}>
                          <span className="team-dot" style={{ color: teamColor(team.teamName) }} />
                          <span className="team-name">{team.teamName}</span>
                          <span className="team-players">{playerNames(team)}</span>
                          <span className="team-score">{team.score}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="history-meta">
                      {card.date && card.title ? <span className="history-server">{card.title}</span> : null}
                      {card.subtitle ? <span className="history-as">{card.subtitle}</span> : null}
                    </div>
                  )}

                  <div className="match-card-foot">
                    <span className="match-go">Open ▸</span>
                    <ReactionBar
                      kind={card.kind}
                      id={card.id}
                      signedIn
                      initialTotals={card.totals}
                      initialMine={card.mine}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="selector-empty">
            <strong>No favourites yet.</strong>
            <span>Star any match, tournament, or recording to collect it here.</span>
            <Link className="text-link" href={listHref(mode, { sort, fav: false })} prefetch={false}>
              Show all matches
            </Link>
          </div>
        )
      ) : failed ? (
        <div className="selector-empty">
          <strong>Couldn&apos;t reach the match server.</strong>
          <span>Try again in a moment — the upstream history API didn&apos;t respond.</span>
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

type FavCard = {
  kind: MatchKind;
  id: string;
  href: string;
  badge: string;
  date?: string;
  title: string;
  subtitle?: string;
  teams?: MatchTeam[];
  totals: RatingTotals;
  mine: UserReaction;
};

/**
 * Build the global Favourites grid: every match/tournament/recording the user has
 * starred, regardless of mode or pagination. Rich match cards are enriched (in
 * order of preference) from the recent list pages, then the user's own history;
 * anything we can't enrich still renders as a compact, openable card.
 */
async function buildFavCards(profileId: string): Promise<FavCard[]> {
  const favs = await listUserFavorites(profileId);
  if (favs.length === 0) return [];

  const [history, tstRecent, fortRecent] = await Promise.all([
    getMatchHistory().catch(() => null),
    getMatches("tst", 1).then((r) => r.matches).catch(() => [] as MatchSummary[]),
    getMatches("fort", 1).then((r) => r.matches).catch(() => [] as MatchSummary[]),
  ]);
  const histMap = new Map((history?.matches ?? []).map((m) => [m.matchId, m]));
  const tstMap = new Map(tstRecent.map((m) => [m.id, m]));
  const fortMap = new Map(fortRecent.map((m) => [m.id, m]));

  const byKind = new Map<MatchKind, string[]>();
  for (const f of favs) {
    byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f.id]);
  }
  const totalsByKind = new Map<MatchKind, Map<string, RatingTotals>>();
  const mineByKind = new Map<MatchKind, Map<string, UserReaction>>();
  await Promise.all(
    Array.from(byKind.entries()).map(async ([kind, kindIds]) => {
      const [t, m] = await Promise.all([
        getRatingTotals(kind, kindIds),
        getUserReactions(profileId, kind, kindIds),
      ]);
      totalsByKind.set(kind, t);
      mineByKind.set(kind, m);
    }),
  );

  return favs.map((f): FavCard => {
    const totals = totalsByKind.get(f.kind)?.get(f.id) ?? ZERO_TOTALS;
    const mine = mineByKind.get(f.kind)?.get(f.id) ?? { favorite: true, vote: 0 };

    if (f.kind === "tst" || f.kind === "fort") {
      const summary = (f.kind === "fort" ? fortMap : tstMap).get(f.id);
      const hist = histMap.get(f.id);
      const href = f.kind === "fort" ? `/watch/${f.id}?mode=fort` : `/watch/${f.id}`;
      if (summary) {
        return {
          kind: f.kind,
          id: f.id,
          href,
          badge: f.kind.toUpperCase(),
          date: formatDate(summary.date),
          title: "",
          teams: [...summary.teams].sort((a, b) => b.score - a.score),
          totals,
          mine,
        };
      }
      return {
        kind: f.kind,
        id: f.id,
        href,
        badge: f.kind.toUpperCase(),
        date: hist ? formatDate(hist.startedAt) : undefined,
        title: hist?.serverName ?? `Match ${f.id.slice(0, 10)}`,
        subtitle: hist?.matchedPlayerName ? `as ${hist.matchedPlayerName}` : "Watch replay",
        totals,
        mine,
      };
    }

    if (f.kind === "recording") {
      const slash = f.id.indexOf("/");
      const slug = slash >= 0 ? f.id.slice(0, slash) : f.id;
      const file = slash >= 0 ? f.id.slice(slash + 1) : "";
      return {
        kind: f.kind,
        id: f.id,
        href: `/tournaments/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`,
        badge: "RECORDING",
        title: decodeURIComponent(file || f.id),
        subtitle: slug,
        totals,
        mine,
      };
    }

    // tournament
    return {
      kind: f.kind,
      id: f.id,
      href: `/tournaments/${encodeURIComponent(f.id)}`,
      badge: "TOURNAMENT",
      title: f.id,
      subtitle: "Browse recordings",
      totals,
      mine,
    };
  });
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
