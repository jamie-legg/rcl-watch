import Link from "next/link";
import { AuthBar } from "@/components/auth/AuthBar";
import { getMatches, type MatchMode } from "@/lib/tronMatches";
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

type HomeProps = {
  searchParams: Promise<{ mode?: string; page?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const { mode: rawMode, page: rawPage } = await searchParams;
  const mode: MatchMode = rawMode === "fort" ? "fort" : "tst";
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);

  let matches: MatchSummary[] = [];
  let failed = false;

  try {
    const result = await getMatches(mode, page);
    matches = result.matches;
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

      {failed ? (
        <div className="selector-empty">
          <strong>Couldn&apos;t reach the match server.</strong>
          <span>Try again in a moment — the upstream history API didn&apos;t respond.</span>
        </div>
      ) : matches.length === 0 ? (
        <div className="selector-empty">
          <strong>No matches on this page.</strong>
          {page > 1 ? (
            <Link className="text-link" href={pageHref(mode, page - 1)} prefetch={false}>
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
                <Link className="match-card" href={`/watch/${match.id}`} prefetch={false}>
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

                  <span className="match-go">Watch replay ▸</span>
                </Link>
              </li>
            ))}
          </ul>

          <nav className="pager" aria-label="Pagination">
            {page > 1 ? (
              <Link className="pager-link" href={pageHref(mode, page - 1)} prefetch={false}>
                ◂ Newer
              </Link>
            ) : (
              <span className="pager-link disabled">◂ Newer</span>
            )}
            <span className="pager-page">Page {page}</span>
            <Link className="pager-link" href={pageHref(mode, page + 1)} prefetch={false}>
              Older ▸
            </Link>
          </nav>
        </>
      )}
    </main>
  );
}

function pageHref(mode: MatchMode, page: number): string {
  const params = new URLSearchParams();
  if (mode !== "tst") {
    params.set("mode", mode);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
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
