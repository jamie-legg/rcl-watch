"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RoundTimeline } from "@/lib/playback";

// Original Armagetron Advanced sounds, imported from the game's `sound/` dir.
const SND = {
  engine: "/aa/sound/cyclrun.ogg",
  explosion: "/aa/sound/expl.ogg",
  go: "/aa/sound/announcerGO.ogg",
  count1: "/aa/sound/1voicemale.ogg",
  count2: "/aa/sound/2voicemale.ogg",
  count3: "/aa/sound/3voicemale.ogg",
  zone: "/aa/sound/zone_spawn.ogg",
  turn: "/aa/sound/cycle_turn.ogg",
} as const;

type SoundKey = keyof typeof SND;

type AudioBank = {
  ctx: AudioContext;
  master: GainNode;
  engineGain: GainNode;
  engineSource: AudioBufferSourceNode | null;
  buffers: Partial<Record<SoundKey, AudioBuffer>>;
};

export type SoundChannels = {
  /** Cycle engine hum. */
  engine: boolean;
  /** Turn ticks. */
  turns: boolean;
  /** Death explosions. */
  explosions: boolean;
};

export const DEFAULT_SOUND_CHANNELS: SoundChannels = { engine: true, turns: true, explosions: true };

type MatchAudioParams = {
  round: RoundTimeline | undefined;
  time: number;
  playing: boolean;
  speed: number;
  enabled: boolean;
  /** Master volume, 0..1. */
  volume: number;
  channels: SoundChannels;
  zoneEnabled: boolean;
  /** Current round-start countdown value (3..1, 0 = GO), or null when not counting. */
  countdown: number | null;
};

/**
 * Drives playback audio in sync with the timeline. The engine hum loops gaplessly via the
 * Web Audio API (an HTML <audio loop> stutters on a short sample), and event sounds —
 * explosions on death, turns, the announcer "GO", and the zone sting — fire as the
 * playhead crosses them. Autoplay rules are satisfied because playback starts on a click.
 */
export function useMatchAudio({
  round,
  time,
  playing,
  speed,
  enabled,
  volume,
  channels,
  zoneEnabled,
  countdown,
}: MatchAudioParams) {
  const bankRef = useRef<AudioBank | null>(null);
  const [ready, setReady] = useState(false);
  const prevTime = useRef(time);
  const zonePlayed = useRef(false);
  const lastTurnAt = useRef(0);
  const lastCount = useRef<number | null>(null);

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
    const master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(master);

    const bank: AudioBank = { ctx, master, engineGain, engineSource: null, buffers: {} };
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
      bank.master.disconnect();
      void ctx.close();
      bankRef.current = null;
    };
  }, []);

  // Master volume.
  useEffect(() => {
    const bank = bankRef.current;
    if (!bank || !ready) {
      return;
    }
    bank.master.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), bank.ctx.currentTime, 0.05);
  }, [volume, ready]);

  // Reset the per-round one-shot guards when the round changes.
  useEffect(() => {
    zonePlayed.current = false;
  }, [round?.id]);

  // Round-start announcer: voice "3 / 2 / 1 / GO" driven by the countdown, exactly like the
  // game (gGame.cpp PushButton(ANNOUNCER_3..GO)). Fires once per distinct countdown value.
  useEffect(() => {
    const bank = bankRef.current;
    if (!bank || !ready || !enabled) {
      return;
    }
    if (countdown === null) {
      lastCount.current = null;
      return;
    }
    if (lastCount.current === countdown) {
      return;
    }
    lastCount.current = countdown;
    const key: SoundKey = countdown >= 3 ? "count3" : countdown === 2 ? "count2" : countdown === 1 ? "count1" : "go";
    playBuffer(bank, key, 0.75);
  }, [countdown, ready, enabled]);

  // Engine hum: gain on while playing + unmuted, pitched roughly with playback speed.
  useEffect(() => {
    const bank = bankRef.current;
    if (!bank || !ready) {
      return;
    }
    const on = playing && enabled && channels.engine;
    if (on && bank.ctx.state === "suspended") {
      void bank.ctx.resume();
    }
    bank.engineSource?.playbackRate.setTargetAtTime(
      Math.min(2, Math.max(0.5, speed)),
      bank.ctx.currentTime,
      0.05,
    );
    bank.engineGain.gain.setTargetAtTime(on ? 0.25 : 0, bank.ctx.currentTime, 0.08);
  }, [playing, enabled, channels.engine, speed, ready]);

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
      if (channels.explosions) {
        const deaths = countInRange(deathTimes, prev, time);
        for (let i = 0; i < deaths; i += 1) {
          playBuffer(bank, "explosion", 0.5);
        }
      }

      if (channels.turns) {
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
    }

    if (zoneEnabled && !zonePlayed.current && time > 0.2) {
      zonePlayed.current = true;
      playBuffer(bank, "zone", 0.45);
    }
  }, [time, playing, enabled, zoneEnabled, channels.explosions, channels.turns, deathTimes, turnTimes, ready]);
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
  source.connect(gain).connect(bank.master);
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
