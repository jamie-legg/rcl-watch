"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RoundTimeline } from "@/lib/playback";

// Original Armagetron Advanced sounds, imported from the game's `sound/` dir.
const SND = {
  engine: "/aa/sound/cyclrun.ogg",
  explosion: "/aa/sound/expl.ogg",
  go: "/aa/sound/announcerGO.ogg",
  zone: "/aa/sound/zone_spawn.ogg",
  turn: "/aa/sound/cycle_turn.ogg",
} as const;

type SoundKey = keyof typeof SND;

type AudioBank = {
  ctx: AudioContext;
  engineGain: GainNode;
  engineSource: AudioBufferSourceNode | null;
  buffers: Partial<Record<SoundKey, AudioBuffer>>;
};

type MatchAudioParams = {
  round: RoundTimeline | undefined;
  time: number;
  playing: boolean;
  speed: number;
  enabled: boolean;
  zoneEnabled: boolean;
};

/**
 * Drives playback audio in sync with the timeline. The engine hum loops gaplessly via the
 * Web Audio API (an HTML <audio loop> stutters on a short sample), and event sounds —
 * explosions on death, turns, the announcer "GO", and the zone sting — fire as the
 * playhead crosses them. Autoplay rules are satisfied because playback starts on a click.
 */
export function useMatchAudio({ round, time, playing, speed, enabled, zoneEnabled }: MatchAudioParams) {
  const bankRef = useRef<AudioBank | null>(null);
  const [ready, setReady] = useState(false);
  const prevTime = useRef(time);
  const goPlayed = useRef(false);
  const zonePlayed = useRef(false);
  const lastTurnAt = useRef(0);

  // Genuine deaths (before the round ends) trigger explosions; the last survivor just
  // reaches the round end.
  const deathTimes = useMemo(() => {
    if (!round) {
      return [] as number[];
    }
    const end = round.duration - 0.1;
    return round.players
      .map((player) => player.deathTime)
      .filter((value) => Number.isFinite(value) && value > 0 && value < end)
      .sort((a, b) => a - b);
  }, [round]);

  // Every direction change across all cycles, sorted — the turn-sound triggers.
  const turnTimes = useMemo(() => {
    if (!round) {
      return [] as number[];
    }
    const times: number[] = [];
    for (const player of round.players) {
      let prevX: number | null = null;
      let prevY: number | null = null;
      for (const sample of player.samples) {
        const dx = Math.sign(sample.dirX);
        const dy = Math.sign(sample.dirY);
        if (prevX !== null && (dx !== prevX || dy !== prevY)) {
          times.push(sample.time);
        }
        prevX = dx;
        prevY = dy;
      }
    }
    return times.sort((a, b) => a - b);
  }, [round]);

  useEffect(() => {
    const Ctx =
      typeof window !== "undefined"
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctx) {
      return;
    }

    let cancelled = false;
    const ctx = new Ctx();
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(ctx.destination);

    const bank: AudioBank = { ctx, engineGain, engineSource: null, buffers: {} };
    bankRef.current = bank;

    void (async () => {
      const entries = Object.entries(SND) as Array<[SoundKey, string]>;
      await Promise.all(
        entries.map(async ([key, url]) => {
          try {
            const response = await fetch(url);
            const data = await response.arrayBuffer();
            const buffer = await ctx.decodeAudioData(data);
            if (!cancelled) {
              bank.buffers[key] = buffer;
            }
          } catch {
            // a missing/undecodable sound just stays silent
          }
        }),
      );

      if (cancelled) {
        return;
      }

      // Start the engine loop once and leave it running; we modulate the gain to
      // play/pause so the loop never restarts (and never clicks or gaps).
      if (bank.buffers.engine) {
        const source = ctx.createBufferSource();
        source.buffer = bank.buffers.engine;
        source.loop = true;
        source.connect(engineGain);
        source.start();
        bank.engineSource = source;
      }

      setReady(true);
    })();

    return () => {
      cancelled = true;
      try {
        bank.engineSource?.stop();
      } catch {
        // already stopped
      }
      bank.engineGain.disconnect();
      void ctx.close();
      bankRef.current = null;
    };
  }, []);

  // Reset the per-round one-shot guards when the round changes.
  useEffect(() => {
    goPlayed.current = false;
    zonePlayed.current = false;
  }, [round?.id]);

  // Engine hum: gain on while playing + unmuted, pitched roughly with playback speed.
  useEffect(() => {
    const bank = bankRef.current;
    if (!bank || !ready) {
      return;
    }
    const on = playing && enabled;
    if (on && bank.ctx.state === "suspended") {
      void bank.ctx.resume();
    }
    bank.engineSource?.playbackRate.setTargetAtTime(
      Math.min(2, Math.max(0.5, speed)),
      bank.ctx.currentTime,
      0.05,
    );
    bank.engineGain.gain.setTargetAtTime(on ? 0.25 : 0, bank.ctx.currentTime, 0.08);
  }, [playing, enabled, speed, ready]);

  // Event sounds tied to the playhead.
  useEffect(() => {
    const prev = prevTime.current;
    prevTime.current = time;

    const bank = bankRef.current;
    if (!bank || !ready || !enabled || !playing) {
      return;
    }

    const delta = time - prev;
    // Only react to normal forward advances; ignore scrubbing, seeking and rewinds.
    if (delta > 0 && delta < 0.6) {
      const deaths = countInRange(deathTimes, prev, time);
      for (let i = 0; i < deaths; i += 1) {
        playBuffer(bank, "explosion", 0.5);
      }

      const turns = countInRange(turnTimes, prev, time);
      if (turns > 0) {
        const now = performance.now();
        // Throttle so a wave of simultaneous turns doesn't flood the mix.
        if (now - lastTurnAt.current > 45) {
          lastTurnAt.current = now;
          playBuffer(bank, "turn", Math.min(0.32, 0.14 + 0.05 * turns));
        }
      }
    }

    if (!goPlayed.current && time < 1.2) {
      goPlayed.current = true;
      playBuffer(bank, "go", 0.6);
    }

    if (zoneEnabled && !zonePlayed.current && time > 0.2) {
      zonePlayed.current = true;
      playBuffer(bank, "zone", 0.45);
    }
  }, [time, playing, enabled, zoneEnabled, deathTimes, turnTimes, ready]);
}

function playBuffer(bank: AudioBank, key: SoundKey, volume: number) {
  const buffer = bank.buffers[key];
  if (!buffer) {
    return;
  }
  if (bank.ctx.state === "suspended") {
    void bank.ctx.resume();
  }
  const source = bank.ctx.createBufferSource();
  source.buffer = buffer;
  const gain = bank.ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(bank.ctx.destination);
  source.start();
}

/** Count entries of a sorted array in the half-open interval (lo, hi]. */
function countInRange(sorted: number[], lo: number, hi: number): number {
  return upperBound(sorted, hi) - upperBound(sorted, lo);
}

/** First index whose value is strictly greater than `value`. */
function upperBound(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
