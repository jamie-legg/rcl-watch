"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MUSIC_TRACKS } from "@/components/playback/musicTracks";

type RepeatMode = "off" | "all" | "one";

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Eq({ active }: { active: boolean }) {
  return (
    <span className={`music-eq${active ? " on" : ""}`} aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function MusicPlayer({
  open,
  onToggle,
  hidden = false,
  playheadPlaying = false,
}: {
  open: boolean;
  onToggle: () => void;
  hidden?: boolean;
  /** The match playhead is playing — used to kick the soundtrack off at GO. */
  playheadPlaying?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Random starting track so every viewing opens on a different crys cut.
  const [index, setIndex] = useState(() => Math.floor(Math.random() * MUSIC_TRACKS.length));
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.1);
  const [shuffle, setShuffle] = useState(true);
  const [repeat, setRepeat] = useState<RepeatMode>("all");
  const autoStartedRef = useRef(false);

  const track = MUSIC_TRACKS[index];

  const pickNext = useCallback(
    (dir: 1 | -1) => {
      setIndex((cur) => {
        if (shuffle && MUSIC_TRACKS.length > 1) {
          let n = cur;
          while (n === cur) n = Math.floor(Math.random() * MUSIC_TRACKS.length);
          return n;
        }
        return (cur + dir + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
      });
    },
    [shuffle],
  );

  const play = useCallback(() => {
    void audioRef.current?.play().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const selectTrack = useCallback((i: number) => {
    setIndex(i);
    // playback resumes via the autoplay-on-load effect below
    requestAnimationFrame(() => void audioRef.current?.play().catch(() => undefined));
  }, []);

  // Keep volume in sync.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Soundtrack kicks off (once) the moment the match playhead starts — i.e. as the
  // 3·2·1 countdown lands on GO. The play click that armed the countdown counts as
  // the user gesture, so the browser lets the audio start here.
  useEffect(() => {
    if (!playheadPlaying || autoStartedRef.current) return;
    const el = audioRef.current;
    if (!el) return;
    autoStartedRef.current = true;
    el.volume = volume;
    void el.play().catch(() => {
      autoStartedRef.current = false;
    });
  }, [playheadPlaying, volume]);

  // Wire audio element events (external subscription → setState in callbacks).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => setDuration(el.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (repeat === "one") {
        el.currentTime = 0;
        void el.play().catch(() => undefined);
        return;
      }
      if (!shuffle && repeat === "off" && index === MUSIC_TRACKS.length - 1) {
        setPlaying(false);
        return;
      }
      pickNext(1);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [repeat, shuffle, index, pickNext]);

  const hasTrack = Boolean(track);

  return (
    <>
      <audio ref={audioRef} src={track?.src} preload="metadata" />

      {open && (
        <aside className={`theater-physics theater-music${hidden ? " is-hidden" : ""}`}>
          <header>
            <strong>
              Soundtrack <span className="music-by">· crys</span>
            </strong>
            <button type="button" className="icon-button" aria-label="Close music" onClick={onToggle}>
              ✕
            </button>
          </header>

          <div className="music-now">
            <Eq active={playing} />
            <div className="music-now-text">
              <strong>{track?.title ?? "—"}</strong>
              <span>{track?.artist ?? "crys"}</span>
            </div>
          </div>

          <div className="music-scrub">
            <span>{formatClock(current)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={0.1}
              value={current}
              aria-label="Track position"
              onChange={(e) => {
                const t = Number(e.target.value);
                if (audioRef.current) audioRef.current.currentTime = t;
                setCurrent(t);
              }}
            />
            <span className="muted">{formatClock(duration)}</span>
          </div>

          <div className="music-transport">
            <button
              type="button"
              className={`music-btn${shuffle ? " active" : ""}`}
              aria-label="Shuffle"
              onClick={() => setShuffle((v) => !v)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3h5v5" />
                <path d="M4 20 21 3" />
                <path d="M21 16v5h-5" />
                <path d="m15 15 6 6" />
                <path d="M4 4l5 5" />
              </svg>
            </button>
            <button type="button" className="music-btn" aria-label="Previous track" onClick={() => pickNext(-1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 5h2v14H6zM20 5 9 12l11 7z" />
              </svg>
            </button>
            <button type="button" className="music-btn music-btn--play" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
              {playing ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 4v16l13-8z" />
                </svg>
              )}
            </button>
            <button type="button" className="music-btn" aria-label="Next track" onClick={() => pickNext(1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 5h2v14h-2zM4 5l11 7L4 19z" />
              </svg>
            </button>
            <button
              type="button"
              className={`music-btn${repeat !== "off" ? " active" : ""}`}
              aria-label={`Repeat: ${repeat}`}
              onClick={() => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m17 2 4 4-4 4" />
                <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                <path d="m7 22-4-4 4-4" />
                <path d="M21 13v1a4 4 0 0 1-4 4H3" />
              </svg>
              {repeat === "one" && <span className="music-repeat-one">1</span>}
            </button>
          </div>

          <div className="music-volume">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M11 5 6 9H2v6h4l5 4z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              aria-label="Music volume"
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>

          <ul className="music-list">
            {MUSIC_TRACKS.map((t, i) => (
              <li key={t.src}>
                <button
                  type="button"
                  className={`music-track${i === index ? " current" : ""}`}
                  onClick={() => selectTrack(i)}
                >
                  <span className="music-track-i">{i === index && playing ? <Eq active /> : i + 1}</span>
                  <span className="music-track-title">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {hasTrack && !open && (
        <button
          type="button"
          className={`music-chip${hidden ? " is-hidden" : ""}`}
          onClick={onToggle}
          aria-label="Open music player"
        >
          <span
            className="music-chip-play"
            role="button"
            tabIndex={0}
            aria-label={playing ? "Pause music" : "Play music"}
            onClick={(e) => {
              e.stopPropagation();
              if (playing) toggle();
              else play();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                toggle();
              }
            }}
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 4v16l13-8z" />
              </svg>
            )}
          </span>
          <Eq active={playing} />
          <span className="music-chip-text">
            <em>crys</em>
            {track?.title}
          </span>
        </button>
      )}
    </>
  );
}
