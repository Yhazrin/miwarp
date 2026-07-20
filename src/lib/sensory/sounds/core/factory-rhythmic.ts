/**
 * Rhythmic and textured sound factories — noise textures, repeating patterns, and modulation.
 *
 * burst  — noise texture (also handles whoosh with sineEnvelope)
 * pulse  — repeating pattern
 * wobble — LFO-modulated tone
 */

import type { SoundSynthesizer, PlaySoundOptions, SoundPlayback } from "../../config/engine";
import type { BaseTune } from "./tunes";
import type { InstrumentConfig } from "./instruments";
import { applyDecayToBuffer } from "./instruments";

/**
 * Create a burst sound (noise texture).
 * Also handles whoosh-style sounds when meta.sineEnvelope is true
 * (used by navigation.tab).
 * Reference: playConcept("whoosh") — sine-envelope noise, bandpass sweep.
 */
export function createBurstSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const duration = tune.duration * instrument.decayMult;
    const meta = tune.meta as { endFilterFreq?: number; sineEnvelope?: boolean } | undefined;

    // Generate noise buffer
    const bufLen = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    if (meta?.sineEnvelope) {
      // Whoosh: sine-envelope noise (reference pattern)
      for (let i = 0; i < bufLen; i++) {
        const env = Math.sin((i / bufLen) * Math.PI);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    } else {
      // Standard burst: noise with decay
      for (let i = 0; i < bufLen; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      applyDecayToBuffer(buffer, 0.4);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    const startFilterFreq = (tune.filterFreq ?? instrument.filterFreq) * instrument.pitchMult;
    filter.frequency.setValueAtTime(startFilterFreq, t);
    // Sweep filter frequency for whoosh effect
    if (meta?.endFilterFreq) {
      filter.frequency.exponentialRampToValueAtTime(
        meta.endFilterFreq * instrument.pitchMult,
        t + duration,
      );
    }
    filter.Q.value = tune.filterQ ?? instrument.q;

    const gain = ctx.createGain();
    gain.gain.value = vol;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
      opts.onEnd?.();
    };

    src.start(t);

    return {
      stop: () => {
        try {
          src.stop();
        } catch {
          /* ok */
        }
      },
    };
  };
}

/**
 * Create a pulse sound (repeating pattern)
 */
export function createPulseSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const freq = (tune.frequency ?? 440) * instrument.pitchMult;
    const pulseCount = tune.pulseCount ?? 2;
    const pulseDur = (tune.noteDuration ?? 0.1) * instrument.decayMult;
    const gap = tune.noteGap ?? 0.08;

    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [];

    for (let i = 0; i < pulseCount; i++) {
      const pulseStart = t + i * (pulseDur + gap);
      const osc = ctx.createOscillator();
      osc.type = instrument.oscType;
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, pulseStart);
      gain.gain.linearRampToValueAtTime(vol, pulseStart + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, pulseStart + pulseDur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      oscillators.push(osc);
      gains.push(gain);

      osc.start(pulseStart);
      osc.stop(pulseStart + pulseDur + 0.01);
    }

    const cleanup = () => {
      oscillators.forEach((o) => {
        try {
          o.disconnect();
        } catch {
          /* ok */
        }
      });
      gains.forEach((g) => {
        try {
          g.disconnect();
        } catch {
          /* ok */
        }
      });
      opts.onEnd?.();
    };

    oscillators[oscillators.length - 1].onended = cleanup;

    return {
      stop: () => {
        oscillators.forEach((o) => {
          try {
            o.stop();
          } catch {
            /* ok */
          }
        });
      },
    };
  };
}

/**
 * Create a wobble sound (LFO modulated)
 */
export function createWobbleSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const duration = tune.duration * instrument.decayMult;
    const freq = (tune.frequency ?? 500) * instrument.pitchMult;
    const modFreq = tune.modFreq ?? 6;
    const modDepth = tune.modDepth ?? 30;

    const osc = ctx.createOscillator();
    osc.type = instrument.oscType;
    osc.frequency.value = freq;

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = modFreq;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = modDepth;

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = () => {
      osc.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      gain.disconnect();
      opts.onEnd?.();
    };

    osc.start(t);
    lfo.start(t);
    osc.stop(t + duration + 0.01);
    lfo.stop(t + duration + 0.01);

    return {
      stop: () => {
        try {
          osc.stop();
          lfo.stop();
        } catch {
          /* ok */
        }
      },
    };
  };
}
