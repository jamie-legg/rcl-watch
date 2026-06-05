import "server-only";
import { createClient } from "@/lib/supabase/server";
import { hasDatabase, query } from "@/lib/db";

export type HistoryMatch = {
  matchId: string;
  gameMode: string | null;
  startedAt: string;
  serverName: string | null;
  leagueSlug: string | null;
  matchedPlayerName: string | null;
};

export type MatchHistory = {
  signedIn: boolean;
  profileReady: boolean;
  username: string | null;
  identities: string[];
  matches: HistoryMatch[];
};

const EMPTY: MatchHistory = {
  signedIn: false,
  profileReady: false,
  username: null,
  identities: [],
  matches: [],
};

type MatchRow = {
  external_match_id: string;
  game_mode: string | null;
  started_at: string;
  server_name: string | null;
  league_slug: string | null;
  matched_player_name: string | null;
};

/**
 * Authoritative per-user match history from the canonical rcl_db, resolved the
 * same way as the dashboard's /api/profile/stats: by Supabase profile id plus
 * known in-game names (ingame_email, username, linked logins). Only rows with a
 * tst_api external_match_id are returned, so each is playable in Watch.
 */
export async function getMatchHistory(limit = 50): Promise<MatchHistory> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return EMPTY;
  if (!hasDatabase()) {
    return { ...EMPTY, signedIn: true };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, ingame_email")
    .eq("id", user.id)
    .single();

  const username: string | null = profile?.username ?? null;

  // Legacy / linked in-game logins live in rcl_db.
  let linked: { login_id: string; display_name: string }[] = [];
  try {
    linked = await query<{ login_id: string; display_name: string }>(
      `SELECT login_id, display_name FROM linked_logins WHERE profile_id = $1`,
      [user.id],
    );
  } catch {
    linked = [];
  }

  const identities = Array.from(
    new Set(
      [
        profile?.ingame_email,
        profile?.username,
        ...linked.map((l) => l.login_id),
        ...linked.map((l) => l.display_name),
      ].filter((v): v is string => typeof v === "string" && v.trim().length > 0),
    ),
  );

  let rows: MatchRow[] = [];
  try {
    rows = await query<MatchRow>(
      `SELECT DISTINCT ON (m.id)
         m.external_match_id,
         m.game_mode,
         m.started_at,
         m.server_name,
         m.league_slug,
         p.name AS matched_player_name
       FROM matches m
       JOIN teams t ON t.match_id = m.id
       JOIN team_players tp ON tp.team_id = t.id
       JOIN players p ON p.id = tp.player_id
       WHERE m.record_source = 'tst_api'
         AND m.external_match_id IS NOT NULL
         AND (p.profile_id = $1 OR p.name = ANY($2::text[]))
       ORDER BY m.id, COALESCE(m.ended_at, m.started_at) DESC, p.name ASC`,
      [user.id, identities],
    );
  } catch {
    rows = [];
  }

  const matches: HistoryMatch[] = rows
    .map((r) => ({
      matchId: r.external_match_id,
      gameMode: r.game_mode,
      startedAt: r.started_at,
      serverName: r.server_name,
      leagueSlug: r.league_slug,
      matchedPlayerName: r.matched_player_name,
    }))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, limit);

  return {
    signedIn: true,
    profileReady: Boolean(profile?.username && profile?.ingame_email),
    username,
    identities,
    matches,
  };
}
