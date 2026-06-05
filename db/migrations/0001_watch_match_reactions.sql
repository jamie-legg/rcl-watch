-- Watch preferences: per-user match reactions (favourite + thumbs up/down)
-- plus an aggregate totals table for sorting by rating.
--
-- TARGET: the canonical rcl_db Postgres (DATABASE_URL / queue DB), same place
-- as linked_logins and the canonical matches schema. profile_id is the Supabase
-- auth UUID (no FK across DBs), matching the linked_logins convention.
--
-- Access is server-side only (Watch route handlers connect with rcl_app and
-- enforce profile_id == the authenticated Supabase user), so there is no RLS.
--
-- Apply with:  sudo -u postgres psql -d rcl_db -f 0001_watch_match_reactions.sql

-- ---------------------------------------------------------------------------
-- Per-user reactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_match_reactions (
    profile_id UUID NOT NULL,
    match_kind TEXT NOT NULL CHECK (match_kind IN ('tst', 'fort', 'tournament', 'recording')),
    match_id   TEXT NOT NULL,
    favorite   BOOLEAN NOT NULL DEFAULT FALSE,
    vote       SMALLINT NOT NULL DEFAULT 0 CHECK (vote IN (-1, 0, 1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (profile_id, match_kind, match_id)
);

CREATE INDEX IF NOT EXISTS idx_watch_reactions_profile
    ON watch_match_reactions (profile_id);

CREATE INDEX IF NOT EXISTS idx_watch_reactions_match
    ON watch_match_reactions (match_kind, match_id);

COMMENT ON TABLE watch_match_reactions IS 'RCL Watch per-user favourites + up/down votes, keyed by Watch match identifiers (tronstats matchId, tournament slug, or recording path)';
COMMENT ON COLUMN watch_match_reactions.profile_id IS 'Supabase auth UUID (no FK; cross-DB, same convention as linked_logins)';

-- ---------------------------------------------------------------------------
-- Aggregate totals (for sort-by-rating without scanning every reaction)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_match_rating_totals (
    match_kind TEXT NOT NULL,
    match_id   TEXT NOT NULL,
    up         INTEGER NOT NULL DEFAULT 0,
    down       INTEGER NOT NULL DEFAULT 0,
    favorites  INTEGER NOT NULL DEFAULT 0,
    score      INTEGER NOT NULL DEFAULT 0, -- up - down
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (match_kind, match_id)
);

COMMENT ON TABLE watch_match_rating_totals IS 'RCL Watch aggregate up/down/favourite counts per match, maintained by trigger on watch_match_reactions';

-- ---------------------------------------------------------------------------
-- Trigger keeps the aggregate in sync with individual reactions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION watch_recompute_rating_totals(p_kind TEXT, p_id TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO watch_match_rating_totals AS t
    (match_kind, match_id, up, down, favorites, score, updated_at)
  SELECT
    p_kind,
    p_id,
    COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN favorite THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(vote), 0),
    NOW()
  FROM watch_match_reactions
  WHERE match_kind = p_kind AND match_id = p_id
  ON CONFLICT (match_kind, match_id) DO UPDATE
    SET up = EXCLUDED.up,
        down = EXCLUDED.down,
        favorites = EXCLUDED.favorites,
        score = EXCLUDED.score,
        updated_at = EXCLUDED.updated_at;
$$;

CREATE OR REPLACE FUNCTION watch_reactions_after_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM watch_recompute_rating_totals(OLD.match_kind, OLD.match_id);
    RETURN OLD;
  END IF;

  PERFORM watch_recompute_rating_totals(NEW.match_kind, NEW.match_id);
  IF (TG_OP = 'UPDATE'
      AND (OLD.match_kind <> NEW.match_kind OR OLD.match_id <> NEW.match_id)) THEN
    PERFORM watch_recompute_rating_totals(OLD.match_kind, OLD.match_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS watch_reactions_totals ON watch_match_reactions;
CREATE TRIGGER watch_reactions_totals
  AFTER INSERT OR UPDATE OR DELETE ON watch_match_reactions
  FOR EACH ROW EXECUTE FUNCTION watch_reactions_after_change();

-- ---------------------------------------------------------------------------
-- Grants: the Watch app connects as rcl_app. The trigger runs as the invoker,
-- so rcl_app also needs write access to the totals table.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON watch_match_reactions TO rcl_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON watch_match_rating_totals TO rcl_app;
