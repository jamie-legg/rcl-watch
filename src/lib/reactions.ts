import "server-only";
import { createClient } from "@/lib/supabase/server";
import { hasDatabase, query } from "@/lib/db";

export type MatchKind = "tst" | "fort" | "tournament" | "recording";

export const MATCH_KINDS: MatchKind[] = ["tst", "fort", "tournament", "recording"];

export function isMatchKind(value: unknown): value is MatchKind {
  return typeof value === "string" && (MATCH_KINDS as string[]).includes(value);
}

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

export const ZERO_TOTALS: RatingTotals = { up: 0, down: 0, favorites: 0, score: 0 };

/** The Supabase auth UUID for the current request, or null if signed out. */
export async function getCurrentProfileId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

type TotalsRow = {
  match_id: string;
  up: number | string;
  down: number | string;
  favorites: number | string;
  score: number | string;
};

function toInt(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Public aggregate totals for a set of match ids of one kind. */
export async function getRatingTotals(
  kind: MatchKind,
  ids: string[],
): Promise<Map<string, RatingTotals>> {
  const out = new Map<string, RatingTotals>();
  if (!hasDatabase() || ids.length === 0) return out;
  const unique = Array.from(new Set(ids));
  try {
    const rows = await query<TotalsRow>(
      `SELECT match_id, up, down, favorites, score
         FROM watch_match_rating_totals
        WHERE match_kind = $1 AND match_id = ANY($2::text[])`,
      [kind, unique],
    );
    for (const r of rows) {
      out.set(r.match_id, {
        up: toInt(r.up),
        down: toInt(r.down),
        favorites: toInt(r.favorites),
        score: toInt(r.score),
      });
    }
  } catch {
    // table missing / db down — treat as no ratings
  }
  return out;
}

type ReactionRow = {
  match_id: string;
  favorite: boolean;
  vote: number | string;
};

function normalizeVote(value: number | string | null | undefined): -1 | 0 | 1 {
  const n = Number(value);
  if (n === 1) return 1;
  if (n === -1) return -1;
  return 0;
}

/** The current user's reactions for a set of match ids of one kind. */
export async function getUserReactions(
  profileId: string,
  kind: MatchKind,
  ids: string[],
): Promise<Map<string, UserReaction>> {
  const out = new Map<string, UserReaction>();
  if (!hasDatabase() || ids.length === 0) return out;
  const unique = Array.from(new Set(ids));
  try {
    const rows = await query<ReactionRow>(
      `SELECT match_id, favorite, vote
         FROM watch_match_reactions
        WHERE profile_id = $1 AND match_kind = $2 AND match_id = ANY($3::text[])`,
      [profileId, kind, unique],
    );
    for (const r of rows) {
      out.set(r.match_id, { favorite: r.favorite, vote: normalizeVote(r.vote) });
    }
  } catch {
    // ignore
  }
  return out;
}

/** Every match the user has favourited (for the Favourites filter). */
export async function listUserFavorites(
  profileId: string,
  kind?: MatchKind,
): Promise<{ kind: MatchKind; id: string }[]> {
  if (!hasDatabase()) return [];
  try {
    const rows = kind
      ? await query<{ match_kind: MatchKind; match_id: string }>(
          `SELECT match_kind, match_id FROM watch_match_reactions
            WHERE profile_id = $1 AND favorite = TRUE AND match_kind = $2
            ORDER BY updated_at DESC`,
          [profileId, kind],
        )
      : await query<{ match_kind: MatchKind; match_id: string }>(
          `SELECT match_kind, match_id FROM watch_match_reactions
            WHERE profile_id = $1 AND favorite = TRUE
            ORDER BY updated_at DESC`,
          [profileId],
        );
    return rows.map((r) => ({ kind: r.match_kind, id: r.match_id }));
  } catch {
    return [];
  }
}

/**
 * Upsert the current user's reaction for one match. Pass only the fields to
 * change. Returns the updated reaction + fresh totals.
 */
export async function setReaction(
  profileId: string,
  kind: MatchKind,
  id: string,
  patch: { favorite?: boolean; vote?: -1 | 0 | 1 },
): Promise<{ reaction: UserReaction; totals: RatingTotals }> {
  const favorite = patch.favorite;
  const vote = patch.vote;

  await query(
    `INSERT INTO watch_match_reactions (profile_id, match_kind, match_id, favorite, vote, updated_at)
     VALUES ($1, $2, $3, COALESCE($4, FALSE), COALESCE($5, 0), NOW())
     ON CONFLICT (profile_id, match_kind, match_id) DO UPDATE
       SET favorite = COALESCE($4, watch_match_reactions.favorite),
           vote     = COALESCE($5, watch_match_reactions.vote),
           updated_at = NOW()`,
    [profileId, kind, id, favorite ?? null, vote ?? null],
  );

  const [reactions, totals] = await Promise.all([
    getUserReactions(profileId, kind, [id]),
    getRatingTotals(kind, [id]),
  ]);

  return {
    reaction: reactions.get(id) ?? { favorite: false, vote: 0 },
    totals: totals.get(id) ?? ZERO_TOTALS,
  };
}
