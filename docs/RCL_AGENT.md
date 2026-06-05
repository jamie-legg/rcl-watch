# Talking to the RCL dashboard agent

Watch is one of several RCL apps. The **dashboard** repo (`/data/rcl/rcl-dashboard`
on `syn-uk`) is the source of truth for auth, the canonical `rcl_db` schema, the
shared Supabase project, and most cross-app APIs. It has its own Cursor agent
that knows that context.

## Reusable workflow

Query it non-interactively over SSH:

```bash
ssh uk 'cd /data/rcl/rcl-dashboard && agent -p "<question>"'
```

`agent` is the Cursor CLI (`-p/--print` = non-interactive, has shell + edit
tools). Use it to:

- Ask about wider RCL plans / architecture before building cross-app features.
- Confirm schema, table ownership, or API shapes (e.g. `profiles`, `linked_logins`,
  the canonical `matches`/`teams`/`players` tables, `/api/v1/players/...`).
- Apply Supabase (cloud) DDL that Watch can't run itself (Watch only has the anon key).

Keep prompts tight and bounded, and ask it to **report back** what it found/changed.
For read-only context, prefer `--mode plan` (`agent -p --mode plan "..."`).

## Things already learned (so you don't re-ask)

- **Two databases**: Supabase cloud (`auth.users`, `profiles`, RLS — Watch's anon
  key + shared session point here) and a local `rcl_db` Postgres (`DATABASE_URL`,
  `localhost:5432`) holding the canonical `matches`/`teams`/`players`, `linked_logins`,
  queue, sumobar, and now Watch's `watch_match_*` tables. `rcl_db` is server-only.
- **Per-user match history**: the dashboard exposes
  `GET https://retrocyclesleague.com/api/v1/players/{username}/matches` (CORS `*`,
  normalized tronstats rows keyed by `matchId`). The richer canonical version is
  `GET /api/profile/stats` (Supabase-session-gated, no CORS) which resolves identity
  via `profiles.ingame_email` + `linked_logins`.
- **The "hub"** (`hub.retrocyclesleague.com`) is a separate site with leaderboard /
  match history UI.
- **rcl_db migrations** are applied with `sudo -u postgres psql -d rcl_db -f scripts/NNN.sql`.
