/**
 * Subtle Web Audio notification cues paired with the toast system.
 *
 * Lives separately from `src/lib/services/sound-feedback-service.ts` (the
 * full Sensory UI sound engine) because the toast cues are intentionally
 * minimal — a quick blip per toast type, no packs, no user-level controls.
 *
 * The `AudioContext` is created lazily on the first cue so the autoplay
 * policy ("user-gesture before audio") doesn't get tripped at module load.
 * Browsers require `ctx.resume()` after a user interaction; the first
 * toast that fires AFTER any click/keydown will work because the context
 * state is then `running`.
 *
 * Respects `prefers-reduced-motion: reduce` — the cross-cutting opt-out
 * many apps use for ALL non-essential audio cues. Callers that want the
 * per-toast `sound: false` flag should suppress before calling.
 */
import type { ToastType } from "$lib/stores/toast-store.svelte";

let _ctx: AudioContext | null = null;
let _ctxFailed = false;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (_ctxFailed) return null;
  if (_ctx) return _ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    _ctxFailed = true;
    return null;
  }
  try {
    _ctx = new Ctor();
  } catch {
    _ctxFailed = true;
    return null;
  }
  return _ctx;
}

interface OscDef {
  type: OscillatorType;
  freq: number;
  /** Total duration in seconds (attack + sustain + release). */
  dur: number;
  /** Peak gain (0..1) — combined with `CueSpec.master` it stays <= 0.08. */
  gain: number;
  /** Attack time in seconds (linear ramp from 0 to peak). */
  attack: number;
}

interface CueSpec {
  /** Sequential blips making up the cue. */
  blips: OscDef[];
  /** Extra master gain to apply to every blip (kept low so total peak stays <= 0.08). */
  master: number;
  /** When true, route through a low-pass filter to soften square harmonics (for error). */
  lowPass?: boolean;
}

const CUES: Record<ToastType, CueSpec> = {
  success: {
    master: 0.85,
    blips: [
      { type: "sine", freq: 523.25, dur: 0.08, gain: 0.07, attack: 0.005 }, // C5
      { type: "sine", freq: 659.25, dur: 0.08, gain: 0.07, attack: 0.005 }, // E5
    ],
  },
  error: {
    master: 0.75,
    lowPass: true,
    blips: [
      { type: "square", freq: 220.0, dur: 0.15, gain: 0.08, attack: 0.005 }, // A3
    ],
  },
  warning: {
    master: 0.8,
    blips: [
      { type: "triangle", freq: 440.0, dur: 0.1, gain: 0.07, attack: 0.005 }, // A4
    ],
  },
  info: {
    master: 0.7,
    blips: [
      { type: "sine", freq: 1318.51, dur: 0.06, gain: 0.05, attack: 0.005 }, // E6
    ],
  },
};

/**
 * Play a short, low-volume notification cue for the given toast type.
 * No-op outside the browser, when `prefers-reduced-motion: reduce` is set,
 * or if the AudioContext cannot be created (insecure context, no API).
 *
 * Safe to call without awaiting — failures are swallowed to keep the toast
 * flow non-blocking.
 */
export async function playNotificationCue(type: ToastType): Promise<void> {
  if (typeof window === "undefined") return;
  if (prefersReducedMotion()) return;
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }

  const spec = CUES[type];
  const start = ctx.currentTime + 0.005;
  let filter: BiquadFilterNode | null = null;
  if (spec.lowPass) {
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    filter.Q.value = 1;
    filter.connect(ctx.destination);
  }
  const masterGain = ctx.createGain();
  masterGain.gain.value = spec.master;
  if (filter) {
    masterGain.connect(filter);
  } else {
    masterGain.connect(ctx.destination);
  }

  let t = start;
  for (const blip of spec.blips) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = blip.type;
    osc.frequency.setValueAtTime(blip.freq, t);
    const peak = blip.gain;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + blip.attack);
    gain.gain.setValueAtTime(peak, t + blip.attack);
    gain.gain.linearRampToValueAtTime(0, t + blip.dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + blip.dur + 0.02);
    t += blip.dur * 0.85;
  }
}
