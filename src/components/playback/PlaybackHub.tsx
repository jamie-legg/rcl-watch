"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CinematicScene, type PlaybackCameraMode } from "@/components/playback/CinematicScene";
import { useMatchAudio } from "@/components/playback/useMatchAudio";
import {
  DEFAULT_PHYSICS,
  DEFAULT_ZONE,
  formatTime,
  normalizeMatchLogs,
  type PhysicsSettings,
  type ZoneSettings,
} from "@/lib/playback";
import { isTstGridposLog, type TstGridposLog } from "@/types/tstLog";

type PlaybackHubProps = {
  matchId: string;
};

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 4];
const AUTO_PLAYER = "__auto";
const IDLE_HIDE_MS = 2800;

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

export function PlaybackHub({ matchId }: PlaybackHubProps) {
  const [logs, setLogs] = useState<TstGridposLog[] | null>(null);
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
  const [autoNext, setAutoNext] = useState(false);

  const [collapsed, setCollapsed] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showPhysics, setShowPhysics] = useState(false);
  const [physics, setPhysics] = useState<PhysicsSettings>(DEFAULT_PHYSICS);
  const [zone, setZone] = useState<ZoneSettings>(DEFAULT_ZONE);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  const theaterRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const round = timeline?.rounds[roundIndex];
  const roundDuration = round?.duration ?? 0;

  const seek = useCallback(
    (nextTime: number) => {
      setTime(Math.min(roundDuration, Math.max(0, nextTime)));
    },
    [roundDuration],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadLogs() {
      try {
        const response = await fetch(`/api/logs/${matchId}`, {
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

        const data: unknown = JSON.parse(text);

        if (!Array.isArray(data)) {
          throw new Error("The log API returned an unexpected response.");
        }

        const valid = data.filter(isTstGridposLog);

        if (valid.length === 0) {
          throw new Error("No usable logs were returned for this match.");
        }

        setLoadProgress(1);
        setLogs(valid);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : "Unable to load match logs.");
        }
      }
    }

    void loadLogs();

    return () => controller.abort();
  }, [matchId]);

  useEffect(() => {
    if (!playing || !round) {
      return;
    }

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = (now - last) / 1000;
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
          setPlaying((value) => !value);
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
        default:
          break;
      }

      revealControls();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [time, seek, toggleFullscreen, revealControls]);

  useMatchAudio({ round, time, playing, speed, enabled: soundOn, zoneEnabled: zone.enabled });

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
          First load streams the full log set from tronstats (often 15–20&nbsp;MB over a slow connection) and caches it
          locally. Once cached, this match opens instantly.
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
          physics={physics}
          zone={zone}
        />
      </div>

      <div className={`theater-topbar${barHidden ? " is-hidden" : ""}`}>
        <div className="topbar-meta">
          <p className="eyebrow">Retrocycles League · Watch</p>
          <strong>{currentRoundLabel}</strong>
        </div>
        <div className="topbar-stats">
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
            {round.players.map((player) => (
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
                <em>{player.team}</em>
              </button>
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
          <div className="control-group">
            <button type="button" className="icon-button" aria-label="Back 15 seconds" onClick={() => seek(time - 15)}>
              «15
            </button>
            <button
              type="button"
              className="icon-button play"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? "❚❚" : "►"}
            </button>
            <button type="button" className="icon-button" aria-label="Forward 15 seconds" onClick={() => seek(time + 15)}>
              15»
            </button>
          </div>

          <div className="control-group control-selects">
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
                { value: "follow", label: "Follow" },
                { value: "pov", label: "POV" },
                { value: "noclip", label: "Noclip (free fly)" },
              ]}
              onChange={(value) => setCameraMode(value as PlaybackCameraMode)}
            />

            <label className="control-slider">
              <span>FOV · {fov}°</span>
              <input
                type="range"
                min={30}
                max={110}
                step={1}
                value={fov}
                onChange={(event) => setFov(Number(event.target.value))}
              />
            </label>

            <label className="control-check">
              <input type="checkbox" checked={autoNext} onChange={(event) => setAutoNext(event.target.checked)} />
              <span>Auto next round</span>
            </label>
          </div>

          <div className="control-group control-actions">
            <button
              type="button"
              className={showRoster ? "icon-button active" : "icon-button"}
              aria-label="Toggle players"
              onClick={() => setShowRoster((value) => !value)}
            >
              Players
            </button>
            <button
              type="button"
              className={showPhysics ? "icon-button active" : "icon-button"}
              aria-label="Toggle physics"
              onClick={() => setShowPhysics((value) => !value)}
            >
              Physics
            </button>
            <button
              type="button"
              className={soundOn ? "icon-button active" : "icon-button"}
              aria-label={soundOn ? "Mute" : "Unmute"}
              onClick={() => setSoundOn((value) => !value)}
            >
              {soundOn ? "🔊" : "🔇"}
            </button>
            <button type="button" className="icon-button" aria-label="Fullscreen" onClick={toggleFullscreen}>
              {isFullscreen ? "⤢" : "⛶"}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Minimise controls"
              onClick={() => {
                setCollapsed(true);
                setControlsHidden(true);
              }}
            >
              ▾
            </button>
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
          ▴ Controls
        </button>
      )}
    </main>
  );
}
