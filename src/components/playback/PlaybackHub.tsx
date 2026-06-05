"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthBar } from "@/components/auth/AuthBar";
import {
  CinematicScene,
  DEFAULT_CAMERA,
  type CameraConfig,
  type PlaybackCameraMode,
} from "@/components/playback/CinematicScene";
import { useMatchAudio, DEFAULT_SOUND_CHANNELS, type SoundChannels } from "@/components/playback/useMatchAudio";
import {
  DEFAULT_PHYSICS,
  DEFAULT_ZONE,
  formatTime,
  normalizeMatchLogs,
  type PhysicsSettings,
  type ZoneSettings,
} from "@/lib/playback";
import {
  isConquerLog,
  isCycleDestroyLog,
  isTstGridposLog,
  type DecodedZone,
  type MatchEvent,
  type TstGridposLog,
} from "@/types/tstLog";

type PlaybackHubProps = {
  matchId: string;
  /** Override the log source. Defaults to the tronstats logs API for `matchId`. */
  logsUrl?: string;
};

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 4];
const AUTO_PLAYER = "__auto";
const IDLE_HIDE_MS = 2800;
// Points per frag. Calibrated against the official match summary: team score equals
// kills × 30 + zone-capture points (matches the upstream scoreboard).
const KILL_POINTS = 30;

type KillEvent = { roundId: string; time: number; team: string };
type ConquerEvent = KillEvent & { score: number };
type ScoreEvents = { kills: KillEvent[]; conquers: ConquerEvent[] };
type TeamScore = { score: number; kills: number; zone: number };

async function readStreamWithProgress(
  body: ReadableStream<Uint8Array>,
  total: number,
  onProgress: (received: number) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    parts.push(decoder.decode(value, { stream: true }));
    onProgress(received);
  }

  parts.push(decoder.decode());
  void total;
  return parts.join("");
}

type SelectOption = { value: string; label: string };

// RCL-branded replacement for the native <select>: a trigger button + a popover list that
// opens upward (the control bar lives at the bottom of the theater). Closes on outside click
// or Escape.
function RclSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`rcl-select${open ? " is-open" : ""}`} ref={ref}>
      <span className="rcl-select__label">{label}</span>
      <button
        type="button"
        className="rcl-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="rcl-select__value">{current?.label ?? "—"}</span>
        <span className="rcl-select__chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="rcl-select__menu" role="listbox">
          {options.map((option) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`rcl-select__option${option.value === value ? " is-selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type IconName =
  | "play"
  | "pause"
  | "back15"
  | "forward15"
  | "scores"
  | "players"
  | "camera"
  | "sound"
  | "mute"
  | "physics"
  | "share"
  | "fullscreen"
  | "fullscreenExit"
  | "chevronDown"
  | "chevronUp"
  | "console"
  | "next";

// Crisp single-weight line icons (Lucide-derived) so the control bar reads like a modern
// media player instead of a row of emoji/text buttons.
function Icon({ name }: { name: IconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "play":
      return (
        <svg {...common}>
          <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common}>
          <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
          <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "back15":
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <text x="12" y="15" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">
            15
          </text>
        </svg>
      );
    case "forward15":
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <text x="12" y="15" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">
            15
          </text>
        </svg>
      );
    case "scores":
      return (
        <svg {...common}>
          <line x1="6" x2="6" y1="20" y2="14" />
          <line x1="12" x2="12" y1="20" y2="4" />
          <line x1="18" x2="18" y1="20" y2="10" />
        </svg>
      );
    case "players":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "camera":
      return (
        <svg {...common}>
          <path d="m22 8-6 4 6 4V8Z" />
          <rect x="2" y="6" width="14" height="12" rx="2" />
        </svg>
      );
    case "sound":
      return (
        <svg {...common}>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      );
    case "mute":
      return (
        <svg {...common}>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
          <line x1="22" x2="16" y1="9" y2="15" />
          <line x1="16" x2="22" y1="9" y2="15" />
        </svg>
      );
    case "physics":
      return (
        <svg {...common}>
          <line x1="4" x2="4" y1="21" y2="14" />
          <line x1="4" x2="4" y1="10" y2="3" />
          <line x1="12" x2="12" y1="21" y2="12" />
          <line x1="12" x2="12" y1="8" y2="3" />
          <line x1="20" x2="20" y1="21" y2="16" />
          <line x1="20" x2="20" y1="12" y2="3" />
          <line x1="2" x2="6" y1="14" y2="14" />
          <line x1="10" x2="14" y1="8" y2="8" />
          <line x1="18" x2="22" y1="16" y2="16" />
        </svg>
      );
    case "share":
      return (
        <svg {...common}>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
          <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
        </svg>
      );
    case "fullscreen":
      return (
        <svg {...common}>
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      );
    case "fullscreenExit":
      return (
        <svg {...common}>
          <path d="M8 3v3a2 2 0 0 1-2 2H3" />
          <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
          <path d="M3 16h3a2 2 0 0 1 2 2v3" />
          <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
        </svg>
      );
    case "chevronDown":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "chevronUp":
      return (
        <svg {...common}>
          <path d="m18 15-6-6-6 6" />
        </svg>
      );
    case "next":
      return (
        <svg {...common}>
          <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" />
          <line x1="19" x2="19" y1="5" y2="19" />
        </svg>
      );
    case "console":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3" />
          <line x1="13" x2="17" y1="15" y2="15" />
        </svg>
      );
    default:
      return null;
  }
}

function IconButton({
  icon,
  label,
  onClick,
  active = false,
  variant = "ghost",
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  variant?: "ghost" | "primary";
}) {
  return (
    <button
      type="button"
      className={`ctl-btn ctl-btn--${variant}${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}

export function PlaybackHub({ matchId, logsUrl }: PlaybackHubProps) {
  // Tournament recordings load from the aarec convert API; tronstats matches
  // from the logs API. Used to tailor copy and zone defaults.
  const isRecording = Boolean(logsUrl && logsUrl.includes("/api/aarec/"));
  const [logs, setLogs] = useState<TstGridposLog[] | null>(null);
  const [scoreEvents, setScoreEvents] = useState<ScoreEvents | null>(null);
  const [cacheSource, setCacheSource] = useState("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [loadedBytes, setLoadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const timeline = useMemo(() => (logs ? normalizeMatchLogs(logs) : null), [logs]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedPlayer, setSelectedPlayer] = useState(AUTO_PLAYER);
  const [cameraMode, setCameraMode] = useState<PlaybackCameraMode>("cinematic");
  const [fov, setFov] = useState(52);
  const [cameraConfig, setCameraConfig] = useState<CameraConfig>(DEFAULT_CAMERA);
  const [autoNext, setAutoNext] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [collapsed, setCollapsed] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showPhysics, setShowPhysics] = useState(false);
  const [physics, setPhysics] = useState<PhysicsSettings>(DEFAULT_PHYSICS);
  // Recordings carry their own decoded zones, so the heuristic TST sumo zone is
  // off by default for them (it would otherwise double-draw / mislead on fort).
  const [zone, setZone] = useState<ZoneSettings>(isRecording ? { ...DEFAULT_ZONE, enabled: false } : DEFAULT_ZONE);
  // Zones + events recovered from a recording's network stream (aarec only).
  const [decodedZones, setDecodedZones] = useState<DecodedZone[]>([]);
  const [matchEvents, setMatchEvents] = useState<MatchEvent[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [volume, setVolume] = useState(0.7);
  const [soundChannels, setSoundChannels] = useState<SoundChannels>(DEFAULT_SOUND_CHANNELS);
  const [showSound, setShowSound] = useState(false);

  const theaterRef = useRef<HTMLDivElement>(null);
  const debugRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const round = timeline?.rounds[roundIndex];
  const roundDuration = round?.duration ?? 0;

  const roundIdToIndex = useMemo(() => {
    const map = new Map<string, number>();
    timeline?.rounds.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [timeline]);

  // Console feed: events in the current round revealed up to the playhead.
  const currentRoundId = round?.id;
  const consoleEntries = useMemo(() => {
    if (!currentRoundId) return [] as MatchEvent[];
    return matchEvents
      .filter((event) => event.roundId === currentRoundId && event.time <= time + 0.001)
      .sort((a, b) => a.time - b.time);
  }, [matchEvents, currentRoundId, time]);

  useEffect(() => {
    if (showConsole && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleEntries, showConsole]);

  // Live match score from real kill (CycleDestroyLog) and zone-capture (ConquerLog) events.
  // Accumulates everything in already-finished rounds plus events in the current round up to
  // the playhead, so the board ticks up exactly as the action happens. score = kills*30 + zone.
  // Tournament (.aarec) recordings carry the server's own point awards in their
  // console events; prefer those for an exact, faithful ladle score.
  const eventScoring = useMemo(() => matchEvents.some((e) => typeof e.points === "number"), [matchEvents]);

  const teamScores = useMemo(() => {
    const scores = new Map<string, TeamScore>();
    const counted = (roundId: string, eventTime: number) => {
      const idx = roundIdToIndex.get(roundId);
      if (idx === undefined) {
        return false;
      }
      return idx < roundIndex || (idx === roundIndex && eventTime <= time);
    };
    const bump = (team: string, addScore: number, addKills: number, addZone: number) => {
      const current = scores.get(team) ?? { score: 0, kills: 0, zone: 0 };
      scores.set(team, {
        score: current.score + addScore,
        kills: current.kills + addKills,
        zone: current.zone + addZone,
      });
    };

    if (eventScoring) {
      for (const event of matchEvents) {
        if (!event.team || typeof event.points !== "number" || !counted(event.roundId, event.time)) {
          continue;
        }
        const isKill = event.kind === "kill";
        bump(event.team, event.points, isKill ? 1 : 0, isKill ? 0 : event.points);
      }
      return scores;
    }

    if (!scoreEvents) {
      return scores;
    }
    for (const kill of scoreEvents.kills) {
      if (counted(kill.roundId, kill.time)) {
        bump(kill.team, KILL_POINTS, 1, 0);
      }
    }
    for (const conquer of scoreEvents.conquers) {
      if (counted(conquer.roundId, conquer.time)) {
        bump(conquer.team, conquer.score, 0, conquer.score);
      }
    }
    return scores;
  }, [eventScoring, matchEvents, scoreEvents, roundIdToIndex, roundIndex, time]);

  const seek = useCallback(
    (nextTime: number) => {
      setTime(Math.min(roundDuration, Math.max(0, nextTime)));
    },
    [roundDuration],
  );

  // Deep-link: seed round + time from ?round=&t= once the timeline is ready.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || !timeline) {
      return;
    }
    deepLinkApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const roundParam = Number(params.get("round"));
    const timeParam = Number(params.get("t"));
    if (Number.isFinite(roundParam) && roundParam >= 1 && roundParam <= timeline.rounds.length) {
      setRoundIndex(roundParam - 1);
    }
    if (Number.isFinite(timeParam) && timeParam > 0) {
      setTime(timeParam);
    }
  }, [timeline]);

  // 3-2-1 countdown before a round rolls (like the in-game round start). Kicks off whenever
  // playback begins from the top of a round; the timer in the effect below resumes play at 0.
  const beginCountdown = useCallback(() => {
    setPlaying(false);
    setCountdown(3);
  }, []);

  const togglePlay = useCallback(() => {
    if (countdown !== null) {
      setCountdown(null);
      return;
    }
    if (playing) {
      setPlaying(false);
      return;
    }
    if (time <= 0.1) {
      beginCountdown();
    } else {
      setPlaying(true);
    }
  }, [countdown, playing, time, beginCountdown]);

  // Faithful to the game (gGame.cpp, PREPARE_TIME=4): one second per count, and "GO" lands
  // exactly as the round starts playing, not after a held pause.
  useEffect(() => {
    if (countdown === null) {
      return;
    }
    if (countdown <= 0) {
      const id = setTimeout(() => setCountdown(null), 800);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      const next = countdown - 1;
      setCountdown(next);
      if (next <= 0) {
        setPlaying(true);
      }
    }, 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const copyShareLink = useCallback(() => {
    const params = new URLSearchParams();
    params.set("round", String(roundIndex + 1));
    params.set("t", time.toFixed(1));
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    void navigator.clipboard?.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1600);
    });
  }, [roundIndex, time]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadLogs() {
      try {
        const response = await fetch(logsUrl ?? `/api/logs/${matchId}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = "Unable to load match logs.";
          try {
            const errorBody: unknown = await response.json();
            if (
              errorBody &&
              typeof errorBody === "object" &&
              "error" in errorBody &&
              typeof errorBody.error === "string"
            ) {
              message = errorBody.error;
            }
          } catch {
            // non-JSON error body; keep the default message
          }
          throw new Error(message);
        }

        setCacheSource(response.headers.get("x-watch-cache") ?? "unknown");
        const total = Number(response.headers.get("x-watch-bytes") ?? response.headers.get("content-length")) || 0;
        setTotalBytes(total);

        const text = response.body
          ? await readStreamWithProgress(response.body, total, (received) => {
              setLoadedBytes(received);
              setLoadProgress(total > 0 ? Math.min(1, received / total) : null);
            })
          : await response.text();

        const parsed: unknown = JSON.parse(text);

        // tronstats returns a bare log array; the aarec convert API returns
        // { logs, zones, events } with stream-recovered map zones + console events.
        let data: unknown[];
        if (Array.isArray(parsed)) {
          data = parsed;
          setDecodedZones([]);
          setMatchEvents([]);
        } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { logs?: unknown }).logs)) {
          const recording = parsed as { logs: unknown[]; zones?: DecodedZone[]; events?: MatchEvent[] };
          data = recording.logs;
          setDecodedZones(Array.isArray(recording.zones) ? recording.zones : []);
          setMatchEvents(Array.isArray(recording.events) ? recording.events : []);
        } else {
          throw new Error("The log API returned an unexpected response.");
        }

        const valid = data.filter(isTstGridposLog);

        if (valid.length === 0) {
          throw new Error("No usable logs were returned for this match.");
        }

        // Kill credit goes to the predator's team, so resolve usernames → team from positions.
        const teamByUser = new Map<string, string>();
        for (const log of valid) {
          if (!teamByUser.has(log.Username)) {
            teamByUser.set(log.Username, log.Team);
          }
        }

        const kills: KillEvent[] = [];
        const conquers: ConquerEvent[] = [];
        for (const entry of data) {
          if (isCycleDestroyLog(entry)) {
            const predatorTeam = entry.Predator ? teamByUser.get(entry.Predator) : undefined;
            // Only count genuine frags — drop suicides / same-team kills.
            if (predatorTeam && predatorTeam !== entry.Team) {
              kills.push({ roundId: entry.RoundId, time: entry.ElapsedTime, team: predatorTeam });
            }
          } else if (isConquerLog(entry)) {
            conquers.push({
              roundId: entry.RoundId,
              time: entry.ElapsedTime,
              team: entry.Team,
              score: entry.Score,
            });
          }
        }

        setLoadProgress(1);
        setScoreEvents({ kills, conquers });
        setLogs(valid);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : "Unable to load match logs.");
        }
      }
    }

    void loadLogs();

    return () => controller.abort();
  }, [matchId, logsUrl]);

  useEffect(() => {
    if (!playing || !round) {
      return;
    }

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      // Cap delta so a slow/janky frame can't fast-forward the clock and skip the action —
      // playback eases through the hitch instead of jumping.
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;

      setTime((current) => {
        const next = current + delta * speed;
        return next >= round.duration ? round.duration : next;
      });

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, round, speed]);

  // End-of-round handling: auto-advance to the next round if enabled, otherwise stop.
  useEffect(() => {
    if (!playing || !round || !timeline) {
      return;
    }
    if (time < round.duration) {
      return;
    }
    if (autoNext && roundIndex < timeline.rounds.length - 1) {
      setRoundIndex(roundIndex + 1);
      setTime(0);
      setPlaying(false);
      setCountdown(3);
    } else {
      setPlaying(false);
    }
  }, [time, playing, round, timeline, autoNext, roundIndex]);

  const revealControls = useCallback(() => {
    setControlsHidden(false);

    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }

    if (playing && !collapsed) {
      idleTimer.current = setTimeout(() => setControlsHidden(true), IDLE_HIDE_MS);
    }
  }, [playing, collapsed]);

  useEffect(() => {
    if (!playing || collapsed) {
      return;
    }

    idleTimer.current = setTimeout(() => setControlsHidden(true), IDLE_HIDE_MS);
    return () => {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
      }
    };
  }, [playing, collapsed]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = theaterRef.current;
    if (!element) {
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void element.requestFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) {
        return;
      }

      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          seek(time - 5);
          break;
        case "ArrowRight":
          seek(time + 5);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "Tab":
          event.preventDefault();
          setShowScoreboard((value) => !value);
          break;
        default:
          break;
      }

      revealControls();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [time, seek, toggleFullscreen, revealControls, togglePlay]);

  useMatchAudio({
    round,
    time,
    playing,
    speed,
    enabled: soundOn,
    volume,
    channels: soundChannels,
    zoneEnabled: zone.enabled,
    countdown,
  });

  if (loadError) {
    return (
      <main className="shell empty-state">
        <p className="eyebrow">Playback unavailable</p>
        <h1>Could not load this match.</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  if (!timeline) {
    const pct = loadProgress != null ? Math.round(loadProgress * 100) : null;
    const determinate = pct != null;
    const sizeReadout =
      loadedBytes > 0
        ? totalBytes > 0
          ? `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`
          : `${formatBytes(loadedBytes)} downloaded`
        : null;

    return (
      <main className="shell empty-state loading-state">
        <p className="eyebrow">Retrocycles League · Watch</p>
        <h1>Loading match…</h1>
        <div className="load-bar" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
          <span className={determinate ? "load-fill" : "load-fill indeterminate"} style={determinate ? { width: `${pct}%` } : undefined} />
        </div>
        <p className="load-meta">
          {determinate ? `${pct}%` : "Streaming…"}
          {sizeReadout ? ` · ${sizeReadout}` : ""}
          {` · cache: ${cacheSource}`}
        </p>
        <p>
          {isRecording
            ? "First load downloads the tournament recording and decodes its network stream into a replay. Once cached, it opens instantly."
            : "First load streams the full log set from tronstats (often 15–20\u00a0MB over a slow connection) and caches it locally. Once cached, this match opens instantly."}
        </p>
      </main>
    );
  }

  if (!round) {
    return (
      <main className="shell empty-state">
        <p>No playable logs were returned for this match.</p>
      </main>
    );
  }

  const selectedPlayerName = selectedPlayer === AUTO_PLAYER ? undefined : selectedPlayer;
  const currentRoundLabel = `Round ${round.index + 1}`;
  const barHidden = collapsed || controlsHidden;
  const progress = roundDuration > 0 ? (time / roundDuration) * 100 : 0;

  return (
    <main
      ref={theaterRef}
      className={`theater${barHidden ? " theater--idle" : ""}`}
      onMouseMove={revealControls}
      onPointerDown={revealControls}
    >
      <div
        className={`theater-stage${cameraMode === "noclip" ? " is-noclip" : ""}`}
        onDoubleClick={toggleFullscreen}
      >
        <CinematicScene
          round={round}
          time={time}
          selectedPlayer={selectedPlayerName}
          cameraMode={cameraMode}
          fov={fov}
          camera={cameraConfig}
          physics={physics}
          zone={zone}
          decodedZones={decodedZones}
          debug={showDebug}
          debugRef={debugRef}
        />
      </div>

      {showDebug && (
        <div className="debug-hud" ref={debugRef} aria-hidden>
          <div className="debug-row">
            <span>FPS</span>
            <b>—</b>
          </div>
        </div>
      )}

      {countdown !== null && (
        <div
          className="countdown-overlay"
          onClick={() => {
            setCountdown(null);
            setPlaying(true);
          }}
        >
          <span key={countdown} className={`countdown-number${countdown <= 0 ? " is-go" : ""}`}>
            {countdown > 0 ? countdown : "GO"}
          </span>
        </div>
      )}

      <div className={`theater-topbar${barHidden ? " is-hidden" : ""}`}>
        <div className="topbar-meta">
          <p className="eyebrow">Retrocycles League · Watch</p>
          <strong>{currentRoundLabel}</strong>
        </div>
        <div className="topbar-stats">
          <AuthBar compact />
          {cameraMode === "noclip" && <span className="noclip-hint">WASD move · E/Q up·down · drag to look · shift = sprint</span>}
          <span>{matchId}</span>
          <span>cache: {cacheSource}</span>
          <span>{timeline.totalLogs.toLocaleString()} logs</span>
        </div>
      </div>

      {showRoster && (
        <aside className={`theater-roster${barHidden ? " is-hidden" : ""}`}>
          <header>
            <strong>{round.players.length} cycles</strong>
            <button type="button" className="icon-button" aria-label="Close roster" onClick={() => setShowRoster(false)}>
              ✕
            </button>
          </header>
          <div className="roster-list">
            {Array.from(
              round.players.reduce((teams, player) => {
                const list = teams.get(player.team) ?? [];
                list.push(player);
                teams.set(player.team, list);
                return teams;
              }, new Map<string, typeof round.players>()),
            )
              .sort((a, b) => (teamScores.get(b[0])?.score ?? 0) - (teamScores.get(a[0])?.score ?? 0) || a[0].localeCompare(b[0]))
              .map(([team, members]) => (
                <div key={team} className="roster-team">
                  <p className="roster-team-name" style={{ color: members[0]?.color }}>
                    {team}
                  </p>
                  {members.map((player) => (
                    <button
                      type="button"
                      key={player.username}
                      className={player.username === selectedPlayerName ? "player-pill selected" : "player-pill"}
                      onClick={() => {
                        setSelectedPlayer(player.username);
                        if (cameraMode === "cinematic") {
                          setCameraMode("follow");
                        }
                      }}
                    >
                      <span style={{ background: player.color, color: player.color }} />
                      <strong>{player.username}</strong>
                    </button>
                  ))}
                </div>
              ))}
          </div>
        </aside>
      )}

      {showPhysics && (
        <aside className={`theater-physics${barHidden ? " is-hidden" : ""}`}>
          <header>
            <strong>Physics &amp; Zone</strong>
            <button type="button" className="icon-button" aria-label="Close physics" onClick={() => setShowPhysics(false)}>
              ✕
            </button>
          </header>
          {decodedZones.length > 0 && (
            <p className="scoreboard-note">
              Zones are decoded from this recording ({decodedZones.length} on the map), so the sumo controls below are ignored.
            </p>
          )}
          <label className="physics-field">
            <span>Wall length (odometer, 0 = infinite)</span>
            <input
              type="number"
              min={0}
              step={25}
              value={physics.wallsLength}
              onChange={(event) =>
                setPhysics((current) => ({ ...current, wallsLength: Math.max(0, Number(event.target.value) || 0) }))
              }
            />
          </label>
          <label className="physics-field">
            <span>Walls stay up after death (s, -1 = forever)</span>
            <input
              type="number"
              min={-1}
              step={1}
              value={physics.wallsStayUpDelay}
              onChange={(event) =>
                setPhysics((current) => ({ ...current, wallsStayUpDelay: Number(event.target.value) }))
              }
            />
          </label>
          <label className="physics-toggle">
            <input
              type="checkbox"
              checked={zone.enabled}
              onChange={(event) => setZone((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span>Sumo zone</span>
          </label>
          <label className="physics-field">
            <span>Zone start radius</span>
            <input
              type="number"
              min={0}
              step={5}
              value={zone.initialRadius}
              onChange={(event) =>
                setZone((current) => ({ ...current, initialRadius: Math.max(0, Number(event.target.value) || 0) }))
              }
            />
          </label>
          <label className="physics-field">
            <span>Zone shrink / sec (-growth)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={zone.shrinkPerSecond}
              onChange={(event) =>
                setZone((current) => ({ ...current, shrinkPerSecond: Math.max(0, Number(event.target.value) || 0) }))
              }
            />
          </label>
          <div className="physics-pair">
            <label className="physics-field">
              <span>Centre X</span>
              <input
                type="number"
                step={1}
                value={zone.centerX}
                onChange={(event) => setZone((current) => ({ ...current, centerX: Number(event.target.value) || 0 }))}
              />
            </label>
            <label className="physics-field">
              <span>Centre Y</span>
              <input
                type="number"
                step={1}
                value={zone.centerY}
                onChange={(event) => setZone((current) => ({ ...current, centerY: Number(event.target.value) || 0 }))}
              />
            </label>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setPhysics(DEFAULT_PHYSICS);
              setZone(DEFAULT_ZONE);
            }}
          >
            Reset to game defaults
          </button>
        </aside>
      )}

      {showSettings && (
        <aside className={`theater-physics theater-settings${barHidden ? " is-hidden" : ""}`}>
          <header>
            <strong>Camera</strong>
            <button type="button" className="icon-button" aria-label="Close camera settings" onClick={() => setShowSettings(false)}>
              ✕
            </button>
          </header>
          <label className="physics-field">
            <span>Field of view · {fov}°</span>
            <input type="range" min={30} max={110} step={1} value={fov} onChange={(event) => setFov(Number(event.target.value))} />
          </label>
          <p className="settings-group-label">Custom camera only</p>
          <label className="physics-field">
            <span>Camera distance (BACK) · {cameraConfig.back}</span>
            <input
              type="range"
              min={5}
              max={60}
              step={1}
              value={cameraConfig.back}
              onChange={(event) => setCameraConfig((current) => ({ ...current, back: Number(event.target.value) }))}
            />
          </label>
          <label className="physics-field">
            <span>Camera height (RISE) · {cameraConfig.rise}</span>
            <input
              type="range"
              min={2}
              max={45}
              step={1}
              value={cameraConfig.rise}
              onChange={(event) => setCameraConfig((current) => ({ ...current, rise: Number(event.target.value) }))}
            />
          </label>
          <label className="physics-field">
            <span>Pitch · {cameraConfig.pitch.toFixed(2)}</span>
            <input
              type="range"
              min={-1.5}
              max={0.2}
              step={0.05}
              value={cameraConfig.pitch}
              onChange={(event) => setCameraConfig((current) => ({ ...current, pitch: Number(event.target.value) }))}
            />
          </label>
          <label className="physics-field">
            <span>Turn speed · {cameraConfig.turnSpeed}</span>
            <input
              type="range"
              min={5}
              max={120}
              step={1}
              value={cameraConfig.turnSpeed}
              onChange={(event) => setCameraConfig((current) => ({ ...current, turnSpeed: Number(event.target.value) }))}
            />
          </label>
          <label className="physics-toggle">
            <input type="checkbox" checked={showDebug} onChange={(event) => setShowDebug(event.target.checked)} />
            <span>Show debug overlay (FPS)</span>
          </label>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setCameraConfig(DEFAULT_CAMERA);
              setFov(52);
            }}
          >
            Reset camera
          </button>
        </aside>
      )}

      {showSound && (
        <aside className={`theater-physics theater-sound${barHidden ? " is-hidden" : ""}`}>
          <header>
            <strong>Sound</strong>
            <button type="button" className="icon-button" aria-label="Close sound settings" onClick={() => setShowSound(false)}>
              ✕
            </button>
          </header>
          <label className="physics-toggle">
            <input type="checkbox" checked={soundOn} onChange={(event) => setSoundOn(event.target.checked)} />
            <span>Sound enabled</span>
          </label>
          <label className="physics-field">
            <span>Volume · {Math.round(volume * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </label>
          <label className="physics-toggle">
            <input
              type="checkbox"
              checked={soundChannels.engine}
              onChange={(event) => setSoundChannels((current) => ({ ...current, engine: event.target.checked }))}
            />
            <span>Cycle engine</span>
          </label>
          <label className="physics-toggle">
            <input
              type="checkbox"
              checked={soundChannels.turns}
              onChange={(event) => setSoundChannels((current) => ({ ...current, turns: event.target.checked }))}
            />
            <span>Turn sounds</span>
          </label>
          <label className="physics-toggle">
            <input
              type="checkbox"
              checked={soundChannels.explosions}
              onChange={(event) => setSoundChannels((current) => ({ ...current, explosions: event.target.checked }))}
            />
            <span>Explosions</span>
          </label>
        </aside>
      )}

      {showScoreboard && (
        <aside className="theater-roster theater-scoreboard">
          <header>
            <strong>Scoreboard</strong>
            <button type="button" className="icon-button" aria-label="Close scoreboard" onClick={() => setShowScoreboard(false)}>
              ✕
            </button>
          </header>
          <p className="scoreboard-note">Live match score · kills &amp; zone · {currentRoundLabel}</p>
          <div className="scoreboard-teams">
            {Array.from(
              round.players.reduce((teams, player) => {
                const list = teams.get(player.team) ?? [];
                list.push(player);
                teams.set(player.team, list);
                return teams;
              }, new Map<string, (typeof round.players)>()),
            )
              .sort(
                (a, b) => (teamScores.get(b[0])?.score ?? 0) - (teamScores.get(a[0])?.score ?? 0),
              )
              .map(([team, members]) => {
                const aliveCount = members.filter(
                  (p) => !(p.deathTime <= time && p.deathTime < round.duration - 0.1),
                ).length;
                const stat = teamScores.get(team) ?? { score: 0, kills: 0, zone: 0 };
                return (
                  <div key={team} className="scoreboard-team">
                    <h4 style={{ color: members[0]?.color }}>
                      <span>{team}</span>
                      <span className="scoreboard-score">{stat.score}</span>
                    </h4>
                    <p className="scoreboard-alive">
                      {aliveCount}/{members.length} alive · {stat.kills} kills · {stat.zone} zone
                    </p>
                    <ul>
                      {members.map((member) => {
                        const dead = member.deathTime <= time && member.deathTime < round.duration - 0.1;
                        const classes = [
                          member.username === selectedPlayerName ? "is-selected" : "",
                          dead ? "is-dead" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <li key={member.username} className={classes || undefined}>
                            {member.username.split("@")[0]}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
          </div>
        </aside>
      )}

      {showConsole && matchEvents.length > 0 && (
        <aside className="theater-roster theater-console">
          <header>
            <strong>Console</strong>
            <button type="button" className="icon-button" aria-label="Close console" onClick={() => setShowConsole(false)}>
              ✕
            </button>
          </header>
          <p className="scoreboard-note">Round events · {currentRoundLabel}</p>
          <div className="console-feed" ref={consoleRef}>
            {consoleEntries.length === 0 ? (
              <p className="console-empty">No events yet this round.</p>
            ) : (
              consoleEntries.map((event, i) => (
                <div key={`${event.roundId}-${i}-${event.time}`} className={`console-line console-line--${event.kind}`}>
                  <span className="console-time">{formatTime(event.time)}</span>
                  <span className="console-text">{event.text}</span>
                  {event.team ? <span className="console-team">{event.team}</span> : null}
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      <div className={`theater-controls${barHidden ? " is-hidden" : ""}`} onMouseMove={revealControls}>
        <div className="control-scrubber">
          <span className="time-readout">{formatTime(time)}</span>
          <div className="scrubber-track" style={{ ["--progress" as string]: `${progress}%` }}>
            <input
              aria-label="Playback time"
              type="range"
              min={0}
              max={Math.max(0.1, roundDuration)}
              step={0.05}
              value={time}
              onChange={(event) => seek(Number(event.target.value))}
            />
          </div>
          <span className="time-readout muted">{formatTime(roundDuration)}</span>
        </div>

        <div className="control-bar">
          <div className="control-cluster control-cluster--transport">
            <IconButton icon="back15" label="Back 15 seconds" onClick={() => seek(time - 15)} />
            <IconButton
              icon={playing ? "pause" : "play"}
              label={playing ? "Pause" : "Play"}
              onClick={togglePlay}
              variant="primary"
            />
            <IconButton icon="forward15" label="Forward 15 seconds" onClick={() => seek(time + 15)} />
            <IconButton
              icon="next"
              label={autoNext ? "Auto-advance rounds: on" : "Auto-advance rounds: off"}
              onClick={() => setAutoNext((value) => !value)}
              active={autoNext}
            />
          </div>

          <div className="control-cluster control-cluster--selects">
            <RclSelect
              label="Round"
              value={String(roundIndex)}
              options={timeline.rounds.map((item) => ({
                value: String(item.index),
                label: `${item.index + 1} (${formatTime(item.duration)})`,
              }))}
              onChange={(value) => {
                setRoundIndex(Number(value));
                setTime(0);
                setPlaying(false);
                setCountdown(null);
              }}
            />

            <RclSelect
              label="Speed"
              value={String(speed)}
              options={SPEED_OPTIONS.map((option) => ({ value: String(option), label: `${option}x` }))}
              onChange={(value) => setSpeed(Number(value))}
            />

            <RclSelect
              label="POV"
              value={selectedPlayer}
              options={[
                { value: AUTO_PLAYER, label: "Auto director" },
                ...round.players.map((player) => ({ value: player.username, label: player.username })),
              ]}
              onChange={(value) => setSelectedPlayer(value)}
            />

            <RclSelect
              label="Camera"
              value={cameraMode}
              options={[
                { value: "cinematic", label: "Cinematic" },
                { value: "follow", label: "Custom" },
                { value: "pov", label: "POV" },
                { value: "noclip", label: "Noclip (free fly)" },
              ]}
              onChange={(value) => setCameraMode(value as PlaybackCameraMode)}
            />
          </div>

          <div className="control-cluster control-cluster--panels">
            <IconButton
              icon="scores"
              label="Scoreboard (Tab)"
              onClick={() => setShowScoreboard((value) => !value)}
              active={showScoreboard}
            />
            <IconButton
              icon="players"
              label="Players"
              onClick={() => setShowRoster((value) => !value)}
              active={showRoster}
            />
            <IconButton
              icon="camera"
              label="Camera settings"
              onClick={() => setShowSettings((value) => !value)}
              active={showSettings}
            />
            <IconButton
              icon={soundOn && volume > 0 ? "sound" : "mute"}
              label="Sound settings"
              onClick={() => setShowSound((value) => !value)}
              active={showSound}
            />
            <IconButton
              icon="physics"
              label="Physics & zone"
              onClick={() => setShowPhysics((value) => !value)}
              active={showPhysics}
            />
            {matchEvents.length > 0 && (
              <IconButton
                icon="console"
                label="Event console"
                onClick={() => setShowConsole((value) => !value)}
                active={showConsole}
              />
            )}
            <span className="control-divider" aria-hidden />
            <IconButton
              icon="share"
              label={shareCopied ? "Link copied" : "Copy shareable link"}
              onClick={copyShareLink}
              active={shareCopied}
            />
            <IconButton
              icon={isFullscreen ? "fullscreenExit" : "fullscreen"}
              label="Fullscreen"
              onClick={toggleFullscreen}
            />
            <IconButton
              icon="chevronDown"
              label="Minimise controls"
              onClick={() => {
                setCollapsed(true);
                setControlsHidden(true);
              }}
            />
          </div>
        </div>
      </div>

      {collapsed && (
        <button
          type="button"
          className="theater-restore"
          aria-label="Show controls"
          onClick={() => {
            setCollapsed(false);
            setControlsHidden(false);
          }}
        >
          <Icon name="chevronUp" />
          <span>Controls</span>
        </button>
      )}
    </main>
  );
}
