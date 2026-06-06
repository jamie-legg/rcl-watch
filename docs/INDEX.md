# Watch Documentation Index

This project is a Next.js playback hub for cached Armagetron match logs.

## Core Docs

- `docs/DEVLOG.md` - pointed implementation notes and issues encountered while building the viewer.
- `docs/DEPLOYMENT_NGINX.md` - systemd + nginx production deploy for `watch.retrocyclesleague.com`.

## Auth (shared RCL Supabase session)

- `src/proxy.ts` - Next 16 proxy convention (replaces deprecated `middleware.ts`); refreshes the shared Supabase session cookies on every non-asset request via `updateSession`.
- `src/lib/supabase/client.ts` / `server.ts` / `middleware.ts` - Supabase SSR browser/server/proxy clients reading the shared `sb-*` cookies. `cookie-domain.ts` scopes auth cookies to `.retrocyclesleague.com` so login carries across RCL subdomains.
- `src/lib/auth/client-auth-navigation.ts` - builds the dashboard login URL (`retrocyclesleague.com/auth/login?returnTo=…`), sets the shared `rcl_post_auth_redirect` cookie, validates redirect targets to RCL hosts.
- `src/components/account/AccountMenu.tsx` - top-right icon that opens a portaled right-hand drawer: auth (login / profile / sign out), Watch links (Matches, Tournaments, My matches, Favourites), and external RCL links (Dashboard, Hub, Resource). Replaces the old inline AuthBar on every header + the theater topbar.
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public), optional `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN`. See `docs/DEPLOYMENT_NGINX.md` → Auth env.

## Preferences (favourites / votes / ratings, in rcl_db)

- `db/migrations/0001_watch_match_reactions.sql` - schema for the canonical `rcl_db` Postgres: `watch_match_reactions` (per-user, profile_id = Supabase UUID) + `watch_match_rating_totals` (trigger-maintained aggregate). Apply with `sudo -u postgres psql -d rcl_db -f ...`.
- `src/lib/db.ts` - pg pool on `DATABASE_URL` (server-only; same DB as the dashboard/queue).
- `src/lib/reactions.ts` - resolves the current Supabase user → profileId, reads totals/own-reactions, upserts. Server-only.
- `src/app/api/reactions/route.ts` - `GET` (public totals + the viewer's own state) / `POST` (set favourite or vote; 401 if signed out).
- `src/components/reactions/ReactionBar.tsx` - client favourite + up/down control; self-fetches when no initial state is passed (theater), else hydrates from server props (cards).
- Wired into: home match cards + sort/Favourites (`src/app/page.tsx`), tournament + recording cards (`src/app/tournaments/...`), and the theater topbar (`PlaybackHub`).
- Env: `DATABASE_URL` in `/etc/default/rcl-watch` (prod). Local dev: SSH tunnel `ssh -fNL 5433:localhost:5432 uk` + `DATABASE_URL=...@localhost:5433/rcl_db` in `.env.local`.

## Match history (My matches)

- `src/lib/history.ts` - resolves the signed-in user (Supabase profile + `linked_logins` in rcl_db) and queries the canonical `matches` joins. Returns rows keyed by `external_match_id` (tronstats matchId, `record_source='tst_api'`) so each links to `/watch/{id}`.
- `src/app/me/page.tsx` - the "My matches" page (signed-out / profile-incomplete / empty states), with playback links + reaction bars. Linked as a "My matches" tab on the selector and tournament navs.
- Note: the dashboard `GET /api/v1/players/{username}/matches` does NOT actually filter by player; history comes from rcl_db directly.

## RCL agent / wider context

- `docs/RCL_AGENT.md` - how to query the dashboard's Cursor agent for cross-repo RCL context (schema, APIs, plans).

## Code Map

- `Makefile` - local dev, smoke-test, cleanup, cache, and release-check utilities.
- `src/app/page.tsx` - match selector home: server-rendered, TST/Fort tabs (via `?mode=`), paginated match cards (via `?page=`) linking to the playback route. Does not fetch any per-match logs.
- `src/app/watch/[matchId]/page.tsx` - server-rendered match page that loads cached logs by match id.
- `src/app/api/logs/[matchId]/route.ts` - streaming log API: cache hits stream off disk with a real `Content-Length`/`x-watch-bytes`; cold loads tee the upstream stream to the client while caching a copy, so the client can render live download progress.
- `src/app/tournaments/page.tsx` - "View Tournament" landing: server-rendered list of tournaments from the armarecordings archive.
- `src/app/tournaments/[tournament]/page.tsx` - recordings within one tournament (`.zip`/`.aarec`), linking to the watch route.
- `src/app/tournaments/[tournament]/[match]/page.tsx` - renders `PlaybackHub` with `logsUrl` pointed at the aarec convert API (no tronstats match id).
- `src/app/api/aarec/[...path]/route.ts` - aarec convert API (`/api/aarec/<tournament>/<file>`): returns `{ logs, zones, events }`. Cache hits stream the decoded JSON off disk with a real `Content-Length`; cold loads download + unzip + decode then cache (`.cache/aarec/<...>.v3.json`). CPU-bound conversion, so no mid-decode progress.
- `src/lib/armaRecordings.ts` - server-side Apache directory-index parser for `http://vps-zman.armagetronad.org/~manuel/armarecordings/`: `getTournaments()`/`getTournamentEntries()` with `React.cache` + TTL disk cache (`.cache/arma-index/`) and `validateSegment` path-safety.
- `src/lib/aarecLogs.ts` - downloads a recording, unzips (`fflate`), runs the decoder over each `.aarec` (merging rounds across a multi-file zip), and caches the resulting `{ logs, zones, events }` JSON forever in `.cache/aarec/`.
- `src/lib/aarec/` - the `.aarec` → `{ logs, zones, events }` decoder. `sections.ts` tokenizes the plain-text recording (VERSION/CONFIG/T/READ); `packets.ts` reframes `READ` datagrams into legacy stream messages; `stream.ts` ports AA's 0.2.8 section-based binary serializer (custom float/int32/string + section masks); `cycleSync.ts` holds the net-object schemas (descriptor 24 sync, 320 gCycle, 340 gZone, 201 ePlayerNetID, 220 eTeam, **8 sn_consoleOut**), tracks object class/ownership, recovers zones (centre/radius-function/team-colour), names teams by colour, and captures the raw server console feed; `toGridpos.ts` assembles syncs into logs with derived `RoundId`/`ElapsedTime` (dropping pre-game fragments + renumbering), assigns fort teams by spawn-vs-zone, collapses zones to one per centre, and parses the console into typed `MatchEvent`s (kills/conquests/holds/suicides/chat + round markers, with team+points).
- `src/types/tstLog.ts` (additions) - `DecodedZone` (centre + `radius(t)=offset+slope·(t−ref)` covering fortress & sumo + team colour), `MatchEvent`/`MatchEventKind` (console feed: kill/suicide/conquest/hold/chat/round, with optional `team`/`points`/`actor`), `DecodedRecording` (`{ logs, zones, events }`).
- `src/lib/tronLogs.ts` - server-side fetch and file-cache helper for `GetLogsForMatch` (immutable logs cached forever).
- `src/lib/tronMatches.ts` - server-side match-list helper for `MatchHistory/Get{Tst,Fort}Matches`: `React.cache` dedupes per request, plus a 60s TTL file cache (`.cache/match-lists/{mode}-p{page}.json`) with stale-on-error fallback.
- `src/types/tstMatch.ts` - `MatchSummary`/`MatchTeam`/`MatchPlayer` shapes + validators for the match-history API.
- `src/lib/playback.ts` - log normalization, interpolation, trail derivation, playback types, and cycle physics: finite wall length recession measured along the odometer (∫speed·dt), post-death wall stay-up removal, explosion events, and the shrinking sumo zone. Exposes `PhysicsSettings`/`DEFAULT_PHYSICS`, `ZoneSettings`/`DEFAULT_ZONE`, `zoneRadiusAt`.
- `src/types/tstLog.ts` - raw tronstats log shapes + type guards: `TstGridposLog` (positions), `TstCycleDestroyLog` (kills, with `Predator`), and `TstConquerLog` (zone captures, with `Score`). The log stream is polymorphic (`$type`); position logs feed the timeline, kill/conquer logs feed the scoreboard.
- `src/app/globals.css` - RCL-branded global styles (lime/magenta palette, grid texture, theater + landing layout).
- `src/components/playback/PlaybackHub.tsx` - fullscreen "theater" client shell (accepts an optional `logsUrl` to override the default `/api/logs/<matchId>` source, used by tournament `.aarec` playback): playback state, auto-hiding media-player toolbar laid out as three icon-button clusters (transport / `RclSelect` selects / panel toggles, all via the `Icon`/`IconButton` SVG set), a `3→2→1→GO` round-start countdown overlay, auto-advance rounds (default on), a Camera settings panel (FOV + camera distance/height/turn-speed sliders + a "Show debug overlay" toggle that drives an in-Canvas `DebugStats` FPS/draw-call HUD), Tab-toggled scoreboard (live kill + zone-capture scoring from `CycleDestroyLog`/`ConquerLog`, score = kills×30 + zone points), shareable `?round=&t=` deep links, players panel, and tunable physics & zone panel. Caps the playback frame delta so jank can't fast-forward past the action.
- `src/components/playback/CinematicScene.tsx` - Three.js/R3F arena, cycles, billboarded name labels (drei `<Html>`), per-side-tinted receding/fading trails, shrinking sumo zone, explosion bursts, lighting, shadows, and cameras (with a settable `fov`). Skinned with the original Armagetron Advanced textures (floor/dir_wall/rim_wall/sky/cycle_body/cycle_wheel from `public/aa/textures`); cycle bodies use planar-projected UVs + player-colour-blended `CanvasTexture`s and bank into turns (`leanAt`/`trackTurns`, mirroring the game's `skew`).
- `src/components/playback/useMatchAudio.ts` - timeline-synced audio (engine loop, death explosions, turn ticks, zone spawn) plus the round-start voice announcer (`3/2/1voicemale.ogg` + `announcerGO.ogg`, driven by the `countdown` param) using the original AA sounds in `public/aa/sound`.
- `src/components/playback/MusicPlayer.tsx` + `musicTracks.ts` - the crys (Ellis) soundtrack layered over the game audio: own `<audio>`, independent volume, shuffle/repeat/seek, track list, animated equaliser, and a floating now-playing chip. Toggled by the `music` icon in the theater control bar. Tracks served from `public/music/` (gitignored; deployed via scp), manifest committed in `musicTracks.ts`.
- `public/aa/` - original Armagetron Advanced art, models (`cycle_body/front/rear.obj`), and sound assets imported from the game checkout.

## External References

- `/Users/jamie/j/rcl/armagetronad/src/tron/gCycleMovement.h` and `.cpp` - Armagetron cycle movement concepts.
- `/Users/jamie/j/rcl/armagetronad/src/tron/gCycle.cpp` - wall/trail and camera behavior reference.
- `/Users/jamie/j/rcl/armagetronad/src/tron/gWall.cpp` - player wall lifecycle and rendering reference.
