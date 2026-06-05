import Link from "next/link";
import { AuthBar } from "@/components/auth/AuthBar";
import { ReactionBar } from "@/components/reactions/ReactionBar";
import { getMatchHistory } from "@/lib/history";
import {
  getCurrentProfileId,
  getRatingTotals,
  getUserReactions,
  ZERO_TOTALS,
  type MatchKind,
  type RatingTotals,
  type UserReaction,
} from "@/lib/reactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MyMatchesPage() {
  const history = await getMatchHistory();
  const profileId = await getCurrentProfileId();

  const tstIds = history.matches.filter((m) => m.gameMode !== "fort").map((m) => m.matchId);
  const fortIds = history.matches.filter((m) => m.gameMode === "fort").map((m) => m.matchId);

  const [totalsTst, totalsFort] = await Promise.all([
    getRatingTotals("tst", tstIds),
    getRatingTotals("fort", fortIds),
  ]);
  const [mineTst, mineFort] = profileId
    ? await Promise.all([
        getUserReactions(profileId, "tst", tstIds),
        getUserReactions(profileId, "fort", fortIds),
      ])
    : [new Map<string, UserReaction>(), new Map<string, UserReaction>()];

  function reactionFor(matchId: string, mode: string | null): {
    kind: MatchKind;
    totals: RatingTotals;
    mine: UserReaction;
  } {
    const kind: MatchKind = mode === "fort" ? "fort" : "tst";
    const totals = (kind === "fort" ? totalsFort : totalsTst).get(matchId) ?? ZERO_TOTALS;
    const mine = (kind === "fort" ? mineFort : mineTst).get(matchId) ?? { favorite: false, vote: 0 };
    return { kind, totals, mine };
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

      <p className="eyebrow">Your match history</p>
      <h1 className="selector-title">My matches</h1>

      <nav className="selector-tabs" aria-label="Sections">
        <Link className="tab" href="/" prefetch={false}>
          Matches
          <em>TST · Fort</em>
        </Link>
        <Link className="tab" href="/tournaments" prefetch={false}>
          View Tournament
          <em>.aarec replays</em>
        </Link>
        <Link className="tab active" href="/me" prefetch={false}>
          My matches
          <em>history</em>
        </Link>
      </nav>

      {!history.signedIn ? (
        <div className="selector-empty">
          <strong>Sign in to see your matches.</strong>
          <span>Watch reads your RCL match history once you&apos;re logged in.</span>
        </div>
      ) : !history.profileReady ? (
        <div className="selector-empty">
          <strong>Finish setting up your RCL profile.</strong>
          <span>Set a username on the dashboard so we can match your in-game name.</span>
          <a className="text-link" href="https://retrocyclesleague.com/dashboard" target="_blank" rel="noreferrer">
            Open dashboard ▸
          </a>
        </div>
      ) : history.matches.length === 0 ? (
        <div className="selector-empty">
          <strong>No matches found yet.</strong>
          <span>
            We looked for {history.identities.slice(0, 4).join(", ") || "your in-game name"}. Link more
            logins on the dashboard if some are missing.
          </span>
        </div>
      ) : (
        <ul className="match-grid">
          {history.matches.map((match) => {
            const r = reactionFor(match.matchId, match.gameMode);
            const href =
              match.gameMode === "fort"
                ? `/watch/${match.matchId}?mode=fort`
                : `/watch/${match.matchId}`;
            return (
              <li key={match.matchId}>
                <Link className="match-card" href={href} prefetch={false}>
                  <div className="match-card-top">
                    <span className="match-date">{formatDate(match.startedAt)}</span>
                    <span className="match-tags">
                      <span className="match-tag">{(match.gameMode ?? "tst").toUpperCase()}</span>
                      {match.leagueSlug ? <span className="match-tag">{match.leagueSlug}</span> : null}
                    </span>
                  </div>

                  <div className="history-meta">
                    {match.serverName ? <span className="history-server">{match.serverName}</span> : null}
                    {match.matchedPlayerName ? (
                      <span className="history-as">as {match.matchedPlayerName}</span>
                    ) : null}
                  </div>

                  <div className="match-card-foot">
                    <span className="match-go">Watch replay ▸</span>
                    <ReactionBar
                      kind={r.kind}
                      id={match.matchId}
                      signedIn={history.signedIn}
                      initialTotals={r.totals}
                      initialMine={r.mine}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
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
