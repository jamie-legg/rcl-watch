# Watch Documentation Index

This project is a Next.js playback hub for cached Armagetron match logs.

## Core Docs

- `docs/DEVLOG.md` - pointed implementation notes and issues encountered while building the viewer.
- `docs/DEPLOYMENT_NGINX.md` - systemd + nginx production deploy for `watch.retrocyclesleague.com`.

## Code Map

- `Makefile` - local dev, smoke-test, cleanup, cache, and release-check utilities.
- `src/app/page.tsx` - match selector home: server-rendered, TST/Fort tabs (via `?mode=`), paginated match cards (via `?page=`) linking to the playback route. Does not fetch any per-match logs.
- `src/app/watch/[matchId]/page.tsx` - server-rendered match page that loads cached logs by match id.
- `src/app/api/logs/[matchId]/route.ts` - streaming log API: cache hits stream off disk with a real `Content-Length`/`x-watch-bytes`; cold loads tee the upstream stream to the client while caching a copy, so the client can render live download progress.
- `src/lib/tronLogs.ts` - server-side fetch and file-cache helper for `GetLogsForMatch` (immutable logs cached forever).
- `src/lib/tronMatches.ts` - server-side match-list helper for `MatchHistory/Get{Tst,Fort}Matches`: `React.cache` dedupes per request, plus a 60s TTL file cache (`.cache/match-lists/{mode}-p{page}.json`) with stale-on-error fallback.
- `src/types/tstMatch.ts` - `MatchSummary`/`MatchTeam`/`MatchPlayer` shapes + validators for the match-history API.
- `src/lib/playback.ts` - log normalization, interpolation, trail derivation, playback types, and cycle physics: finite wall length recession measured along the odometer (∫speed·dt), post-death wall stay-up removal, explosion events, and the shrinking sumo zone. Exposes `PhysicsSettings`/`DEFAULT_PHYSICS`, `ZoneSettings`/`DEFAULT_ZONE`, `zoneRadiusAt`.
- `src/types/tstLog.ts` - raw `TstGridposLog` shape from the tronstats API.
- `src/app/globals.css` - RCL-branded global styles (lime/magenta palette, grid texture, theater + landing layout).
- `src/components/playback/PlaybackHub.tsx` - fullscreen "theater" client shell: playback state, auto-hiding YouTube-style toolbar, players panel, and tunable physics & zone panel.
- `src/components/playback/CinematicScene.tsx` - Three.js/R3F arena, cycles, per-side-tinted receding/fading trails, shrinking sumo zone, explosion bursts, lighting, shadows, and cameras.

## External References

- `/Users/jamie/j/rcl/armagetronad/src/tron/gCycleMovement.h` and `.cpp` - Armagetron cycle movement concepts.
- `/Users/jamie/j/rcl/armagetronad/src/tron/gCycle.cpp` - wall/trail and camera behavior reference.
- `/Users/jamie/j/rcl/armagetronad/src/tron/gWall.cpp` - player wall lifecycle and rendering reference.
