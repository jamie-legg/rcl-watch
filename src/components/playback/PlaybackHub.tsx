"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CinematicScene, type PlaybackCameraMode } from "@/components/playback/CinematicScene";
import {
  DEFAULT_PHYSICS,
  DEFAULT_ZONE,
  formatTime,
  normalizeMatchLogs,
  type PhysicsSettings,
  type ZoneSettings,
} from "@/lib/playback";
import type { TstGridposLog } from "@/types/tstLog";

type PlaybackHubProps = {
  matchId: string;
};

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 4];
const AUTO_PLAYER = "__auto";
const IDLE_HIDE_MS = 2800;

export function PlaybackHub({ matchId }: PlaybackHubProps) {
  const [logs, setLogs] = useState<TstGridposLog[] | null>(null);
  const [cacheSource, setCacheSource] = useState("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const timeline = useMemo(() => (logs ? normalizeMatchLogs(logs) : null), [logs]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedPlayer, setSelectedPlayer] = useState(AUTO_PLAYER);
  const [cameraMode, setCameraMode] = useState<PlaybackCameraMode>("cinematic");

  const [collapsed, setCollapsed] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showPhysics, setShowPhysics] = useState(false);
  const [physics, setPhysics] = useState<PhysicsSettings>(DEFAULT_PHYSICS);
  const [zone, setZone] = useState<ZoneSettings>(DEFAULT_ZONE);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
        const data: unknown = await response.json();

        if (!response.ok) {
          const message =
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Unable to load match logs.";
          throw new Error(message);
        }

        if (!Array.isArray(data)) {
          throw new Error("The cached log API returned an unexpected response.");
        }

        setLogs(data as TstGridposLog[]);
        setCacheSource(response.headers.get("x-watch-cache") ?? "unknown");
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
        if (next >= round.duration) {
          setPlaying(false);
          return round.duration;
        }
        return next;
      });

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, round, speed]);

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
    return (
      <main className="shell empty-state">
        <p className="eyebrow">RCL Watch</p>
        <h1>Loading cached match logs.</h1>
        <p>The first request may fetch from tronstats and write the local file cache. Later requests should read from disk.</p>
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
            <label>
              <span>Round</span>
              <select
                value={roundIndex}
                onChange={(event) => {
                  setRoundIndex(Number(event.target.value));
                  setTime(0);
                  setPlaying(false);
                }}
              >
                {timeline.rounds.map((item) => (
                  <option key={item.id} value={item.index}>
                    {item.index + 1} ({formatTime(item.duration)})
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Speed</span>
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                {SPEED_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}x
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>POV</span>
              <select value={selectedPlayer} onChange={(event) => setSelectedPlayer(event.target.value)}>
                <option value={AUTO_PLAYER}>Auto director</option>
                {round.players.map((player) => (
                  <option key={player.username} value={player.username}>
                    {player.username}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Camera</span>
              <select value={cameraMode} onChange={(event) => setCameraMode(event.target.value as PlaybackCameraMode)}>
                <option value="cinematic">Cinematic</option>
                <option value="follow">Follow</option>
                <option value="pov">POV</option>
                <option value="noclip">Noclip (free fly)</option>
              </select>
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
