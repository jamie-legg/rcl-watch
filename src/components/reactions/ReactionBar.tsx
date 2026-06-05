"use client";

import { useCallback, useEffect, useState } from "react";
import { getDashboardLoginUrl } from "@/lib/auth/client-auth-navigation";

export type MatchKind = "tst" | "fort" | "tournament" | "recording";

export type RatingTotals = {
  up: number;
  down: number;
  favorites: number;
  score: number;
};

export type UserReaction = {
  favorite: boolean;
  vote: -1 | 0 | 1;
};

type ReactionBarProps = {
  kind: MatchKind;
  id: string;
  /** Known from the server render. If omitted, the bar fetches its own state. */
  signedIn?: boolean;
  initialTotals?: RatingTotals;
  initialMine?: UserReaction;
  variant?: "card" | "theater";
  /** Stop click events bubbling to a parent link (match cards wrap in <Link>). */
  stopPropagation?: boolean;
};

const ZERO: RatingTotals = { up: 0, down: 0, favorites: 0, score: 0 };
const NONE: UserReaction = { favorite: false, vote: 0 };

export function ReactionBar({
  kind,
  id,
  signedIn,
  initialTotals,
  initialMine,
  variant = "card",
  stopPropagation = true,
}: ReactionBarProps) {
  const [totals, setTotals] = useState<RatingTotals>(initialTotals ?? ZERO);
  const [mine, setMine] = useState<UserReaction>(initialMine ?? NONE);
  const [auth, setAuth] = useState<boolean>(signedIn ?? false);
  const [busy, setBusy] = useState(false);

  // Self-fetch when the server didn't provide initial state (e.g. the theater).
  const selfFetch = initialTotals === undefined;
  useEffect(() => {
    if (!selfFetch) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/reactions?kind=${kind}&ids=${encodeURIComponent(id)}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          totals: Record<string, RatingTotals>;
          mine: Record<string, UserReaction>;
          signedIn: boolean;
        };
        if (cancelled) return;
        setTotals(data.totals[id] ?? ZERO);
        setMine(data.mine[id] ?? NONE);
        setAuth(data.signedIn);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selfFetch, kind, id]);

  const send = useCallback(
    async (patch: { favorite?: boolean; vote?: -1 | 0 | 1 }) => {
      if (!auth) {
        window.location.assign(getDashboardLoginUrl());
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, id, ...patch }),
        });
        if (res.status === 401) {
          window.location.assign(getDashboardLoginUrl());
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { reaction: UserReaction; totals: RatingTotals };
        setMine(data.reaction);
        setTotals(data.totals);
      } finally {
        setBusy(false);
      }
    },
    [kind, id, auth],
  );

  const guard = useCallback(
    (e: React.MouseEvent) => {
      if (stopPropagation) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [stopPropagation],
  );

  const toggleFavorite = (e: React.MouseEvent) => {
    guard(e);
    if (busy) return;
    void send({ favorite: !mine.favorite });
  };

  const setVote = (next: -1 | 1) => (e: React.MouseEvent) => {
    guard(e);
    if (busy) return;
    const value: -1 | 0 | 1 = mine.vote === next ? 0 : next;
    void send({ vote: value });
  };

  return (
    <div className={`reaction-bar reaction-bar--${variant}`}>
      <button
        type="button"
        className={`rxn-btn rxn-fav${mine.favorite ? " active" : ""}`}
        onClick={toggleFavorite}
        aria-pressed={mine.favorite}
        title={mine.favorite ? "Remove favourite" : "Favourite"}
      >
        <span className="rxn-glyph">{mine.favorite ? "★" : "☆"}</span>
        {totals.favorites > 0 && <span className="rxn-count">{totals.favorites}</span>}
      </button>

      <div className="rxn-vote">
        <button
          type="button"
          className={`rxn-btn rxn-up${mine.vote === 1 ? " active" : ""}`}
          onClick={setVote(1)}
          aria-pressed={mine.vote === 1}
          title="Thumbs up"
        >
          <span className="rxn-glyph">▲</span>
        </button>
        <span className={`rxn-score${totals.score > 0 ? " pos" : totals.score < 0 ? " neg" : ""}`}>
          {totals.score}
        </span>
        <button
          type="button"
          className={`rxn-btn rxn-down${mine.vote === -1 ? " active" : ""}`}
          onClick={setVote(-1)}
          aria-pressed={mine.vote === -1}
          title="Thumbs down"
        >
          <span className="rxn-glyph">▼</span>
        </button>
      </div>
    </div>
  );
}
