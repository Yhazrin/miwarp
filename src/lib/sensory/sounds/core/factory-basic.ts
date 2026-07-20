/**
 * Basic sound factories — short percussive and tonal transients.
 *
 * click  — noise with exponential decay, bandpass filter
 * pop    — brief tonal burst with pitch bend
 * toggle — state-change: noise click + tonal tail
 * tick   — subtle micro-interaction noise
 */

import type { SoundSynthesizer, PlaySoundOptions, SoundPlayback } from "../../config/engine";
import type { BaseTune } from "./tunes";
import type { InstrumentConfig } from "./instruments";

/**
 * Create a click sound (short percussive transient)
 * Reference: playConcept("click") — noise with exponential decay, bandpass filter.
 */
export function createClickSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const duration = Math.max(0.004, tune.duration) * instrument.decayMult;
    const meta = tune.meta as { decayConstant?: number } | undefined;
    const decayConstant = meta?.decayConstant ?? 50;

    // Generate noise buffer with time-normalised exponential decay.
    // Using (i / sampleRate) ensures the decay shape is independent of
    // the AudioContext's sample rate across devices.
    const bufLen = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const tauSeconds = (decayConstant / ctx.sampleRate) * instrument.decayMult;
    for (let i = 0; i < bufLen; i++) {
      const time = i / ctx.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-time / tauSeconds);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = (tune.filterFreq ?? 4000) * instrument.pitchMult;
    filter.Q.value = (tune.filterQ ?? 3) * instrument.q;

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
 * Create a pop sound (brief tonal burst with pitch bend)
 */
export function createPopSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const duration = tune.duration * instrument.decayMult;
    const freq = (tune.frequency ?? 800) * instrument.pitchMult;
    const endFreq = tune.endFrequency ?? freq * 1.2;

    const osc = ctx.createOscillator();
    osc.type = instrument.oscType;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration * 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      opts.onEnd?.();
    };

    osc.start(t);
    osc.stop(t + duration + 0.02);

    return {
      stop: () => {
        try {
          osc.stop();
        } catch {
          /* ok */
        }
      },
    };
  };
}

/**
 * Create a toggle sound (state change - noise click + tonal tail)
 * Reference: playConcept("toggle") — 12ms noise bandpass 2500Hz + sine 800→400Hz
 */
export function createToggleSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const duration = tune.duration * instrument.decayMult;
    const meta = tune.meta as
      | {
          noiseGain?: number;
          toneGain?: number;
          noiseDuration?: number;
          decayConstant?: number;
        }
      | undefined;

    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];

    // Noise click transient (reference: 12ms, exp decay -i/80)
    const noiseDur = (meta?.noiseDuration ?? 0.012) * instrument.decayMult;
    const decayConstant = meta?.decayConstant ?? 80;
    const bufLen = Math.floor(ctx.sampleRate * noiseDur);
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const tauSeconds = (decayConstant / ctx.sampleRate) * instrument.decayMult;
    for (let i = 0; i < bufLen; i++) {
      const time = i / ctx.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-time / tauSeconds);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = (tune.filterFreq ?? 2500) * instrument.pitchMult;
    filter.Q.value = (tune.filterQ ?? 3) * instrument.q;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = vol * (meta?.noiseGain ?? 0.4);

    src.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    nodes.push(filter, noiseGain);
    sources.push(src);
    src.start(t);

    // Tonal tail (reference: sine 800→400Hz, gain 0.15→0.001 over 40ms)
    if (tune.frequency) {
      const osc = ctx.createOscillator();
      osc.type = instrument.oscType;
      osc.frequency.setValueAtTime(tune.frequency * instrument.pitchMult, t);
      if (tune.endFrequency) {
        osc.frequency.exponentialRampToValueAtTime(
          tune.endFrequency * instrument.pitchMult,
          t + 0.03 * instrument.decayMult,
        );
      }

      const oscGain = ctx.createGain();
      const toneVol = vol * (meta?.toneGain ?? 0.15);
      oscGain.gain.setValueAtTime(toneVol, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc.connect(oscGain);
      oscGain.connect(ctx.destination);

      nodes.push(oscGain);
      sources.push(osc);

      osc.start(t);
      osc.stop(t + duration + 0.01);
    }

    const cleanup = () => {
      sources.forEach((s) => {
        try {
          s.disconnect();
        } catch {
          /* ok */
        }
      });
      nodes.forEach((n) => {
        try {
          n.disconnect();
        } catch {
          /* ok */
        }
      });
      opts.onEnd?.();
    };

    if (sources.length > 1) {
      (sources[1] as OscillatorNode).onended = cleanup;
    } else {
      src.onended = cleanup;
    }

    return {
      stop: () => {
        sources.forEach((s) => {
          try {
            s.stop();
          } catch {
            /* ok */
          }
        });
      },
    };
  };
}

/**
 * Create a tick sound (subtle micro-interaction).
 * Reference: playConcept("tick") — 4ms noise with exp decay (-i/20),
 * highpass 3000Hz, gain 0.3.
 */
export function createTickSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const duration = Math.max(0.004, tune.duration) * instrument.decayMult;
    const meta = tune.meta as { decayConstant?: number } | undefined;
    const decayConstant = meta?.decayConstant ?? 20;

    // Generate noise buffer with time-normalised exponential decay.
    const bufLen = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const tauSeconds = (decayConstant / ctx.sampleRate) * instrument.decayMult;
    for (let i = 0; i < bufLen; i++) {
      const time = i / ctx.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-time / tauSeconds);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = (tune.filterFreq ?? 3000) * instrument.pitchMult;

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
