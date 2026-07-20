/**
 * Sweep-based sound factories — frequency glides, resonant tones, and note sequences.
 *
 * sweep    — frequency glide with optional harmonics + click layer
 * rise     — alias for sweep (pitch ascends)
 * drop     — alias for sweep (pitch descends)
 * chime    — resonant tonal with decay + optional harmonic overtone
 * arpeggio — sequence of notes with optional shimmer
 * chord    — multiple simultaneous notes
 */

import type { SoundSynthesizer, PlaySoundOptions, SoundPlayback } from "../../config/engine";
import type { BaseTune } from "./tunes";
import type { InstrumentConfig } from "./instruments";

/**
 * Create a sweep sound (frequency glide).
 * Supports an optional harmonic overtone when tune.harmonics is set,
 * and an optional click transient layer when tune.meta.clickLayer is true
 * (used by overlay open/close/expand/collapse sounds for tactility).
 */
export function createSweepSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const duration = tune.duration * instrument.decayMult;
    const startFreq = (tune.frequency ?? 300) * instrument.pitchMult;
    const endFreq = (tune.endFrequency ?? 500) * instrument.pitchMult;

    const oscs: OscillatorNode[] = [];
    const gainNodes: GainNode[] = [];
    const extraNodes: AudioNode[] = [];

    const osc = ctx.createOscillator();
    osc.type = instrument.oscType;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);
    oscs.push(osc);
    gainNodes.push(gain);

    // Parse meta for overlay enhancements
    const meta = tune.meta as
      | {
          clickLayer?: boolean;
          clickGain?: number;
          thirdPartial?: boolean;
          thirdRatio?: number;
          thirdVolume?: number;
        }
      | undefined;

    // Harmonic layer for richer overlay open/close/expand/collapse sounds
    if (tune.harmonics && tune.harmonicRatio) {
      const harmRatio = tune.harmonicRatio;
      const harmVol = vol * (tune.harmonicVolume ?? 0.15);
      const harmOsc = ctx.createOscillator();
      harmOsc.type = "sine";
      harmOsc.frequency.setValueAtTime(startFreq * harmRatio, t);
      harmOsc.frequency.exponentialRampToValueAtTime(endFreq * harmRatio, t + duration);
      const harmGain = ctx.createGain();
      harmGain.gain.setValueAtTime(harmVol, t);
      harmGain.gain.exponentialRampToValueAtTime(0.001, t + duration + 0.03);
      harmOsc.connect(harmGain);
      harmGain.connect(ctx.destination);
      oscs.push(harmOsc);
      gainNodes.push(harmGain);
    }

    // Third partial for richer timbre (adds bell-like quality to overlay sounds)
    if (meta?.thirdPartial) {
      const thirdRatio = meta.thirdRatio ?? 3;
      const thirdVol = vol * (meta.thirdVolume ?? 0.06);
      const thirdOsc = ctx.createOscillator();
      thirdOsc.type = "sine";
      thirdOsc.frequency.setValueAtTime(startFreq * thirdRatio, t);
      thirdOsc.frequency.exponentialRampToValueAtTime(endFreq * thirdRatio, t + duration);
      const thirdGain = ctx.createGain();
      thirdGain.gain.setValueAtTime(thirdVol, t);
      thirdGain.gain.exponentialRampToValueAtTime(0.001, t + duration * 0.6);
      thirdOsc.connect(thirdGain);
      thirdGain.connect(ctx.destination);
      oscs.push(thirdOsc);
      gainNodes.push(thirdGain);
    }

    // Click transient layer for overlay sounds (subtle tactile click at the start)
    if (meta?.clickLayer) {
      const clickDur = 0.005;
      const clickBufLen = Math.floor(ctx.sampleRate * clickDur);
      const clickBuffer = ctx.createBuffer(1, clickBufLen, ctx.sampleRate);
      const clickData = clickBuffer.getChannelData(0);
      for (let i = 0; i < clickBufLen; i++) {
        clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / 25);
      }
      const clickSrc = ctx.createBufferSource();
      clickSrc.buffer = clickBuffer;
      const clickFilter = ctx.createBiquadFilter();
      clickFilter.type = "bandpass";
      clickFilter.frequency.value = 3500 * instrument.pitchMult;
      clickFilter.Q.value = 2;
      const clickGainNode = ctx.createGain();
      clickGainNode.gain.value = vol * (meta.clickGain ?? 0.25);
      clickSrc.connect(clickFilter);
      clickFilter.connect(clickGainNode);
      clickGainNode.connect(ctx.destination);
      extraNodes.push(clickSrc, clickFilter, clickGainNode);
      clickSrc.start(t);
    }

    const cleanup = () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch {
          /* ok */
        }
      });
      gainNodes.forEach((g) => {
        try {
          g.disconnect();
        } catch {
          /* ok */
        }
      });
      extraNodes.forEach((n) => {
        try {
          n.disconnect();
        } catch {
          /* ok */
        }
      });
      opts.onEnd?.();
    };
    osc.onended = cleanup;

    oscs.forEach((o) => {
      o.start(t);
      o.stop(t + duration + 0.05);
    });

    return {
      stop: () => {
        oscs.forEach((o) => {
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
 * Create a rise sound (pitch ascends) - alias for sweep
 */
export function createRiseSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return createSweepSound(tune, instrument);
}

/**
 * Create a drop sound (pitch descends) - alias for sweep
 */
export function createDropSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return createSweepSound(tune, instrument);
}

/**
 * Create a chime sound (resonant tonal with decay)
 */
export function createChimeSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const duration = tune.duration * instrument.decayMult;
    const freq = (tune.frequency ?? 520) * instrument.pitchMult;

    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [];

    // Main tone
    const osc = ctx.createOscillator();
    osc.type = instrument.oscType;
    osc.frequency.setValueAtTime(freq, t);
    if (tune.endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(
        tune.endFrequency * instrument.pitchMult,
        t + duration * 0.5,
      );
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    oscillators.push(osc);
    gains.push(gain);

    // Harmonic overtone for richness
    if (tune.harmonics) {
      const harmonic = ctx.createOscillator();
      harmonic.type = "sine";
      harmonic.frequency.value = freq * (tune.harmonicRatio ?? 2);

      const harmonicGain = ctx.createGain();
      const harmonicVol = vol * (tune.harmonicVolume ?? 0.2);
      harmonicGain.gain.setValueAtTime(0.001, t);
      harmonicGain.gain.linearRampToValueAtTime(harmonicVol, t + 0.01);
      harmonicGain.gain.exponentialRampToValueAtTime(0.001, t + duration * 0.8);

      harmonic.connect(harmonicGain);
      harmonicGain.connect(ctx.destination);
      oscillators.push(harmonic);
      gains.push(harmonicGain);
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

    osc.onended = cleanup;

    oscillators.forEach((o) => {
      o.start(t);
      o.stop(t + duration + 0.05);
    });

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
 * Create an arpeggio sound (sequence of notes).
 * Supports meta.shimmerCents: adds a slightly detuned oscillator on the
 * final note for a subtle chorus shimmer (used by hero sounds).
 */
export function createArpeggioSound(
  tune: BaseTune,
  instrument: InstrumentConfig,
): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const notes = tune.notes ?? [261.63, 329.63, 392.0];
    const noteDur = (tune.noteDuration ?? 0.15) * instrument.decayMult;
    const gap = tune.noteGap ?? 0.12;
    const meta = tune.meta as { finalRing?: number; shimmerCents?: number } | undefined;
    const finalRing = meta?.finalRing ?? 0.4;
    const shimmerCents = meta?.shimmerCents;

    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [];

    notes.forEach((noteFreq, i) => {
      const freq = noteFreq * instrument.pitchMult;
      const noteStart = t + i * gap;
      const isLast = i === notes.length - 1;
      const ringDur = isLast ? finalRing : 0.06;
      const decay = noteStart + noteDur + ringDur;

      const osc = ctx.createOscillator();
      osc.type = instrument.oscType;
      osc.frequency.value = freq;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, noteStart);
      g.gain.linearRampToValueAtTime(vol, noteStart + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, decay);

      osc.connect(g);
      g.connect(ctx.destination);

      oscillators.push(osc);
      gains.push(g);

      osc.start(noteStart);
      osc.stop(decay + 0.05);

      // Shimmer: detuned copy on the final note (hero sounds only)
      if (isLast && shimmerCents) {
        const shimOsc = ctx.createOscillator();
        shimOsc.type = instrument.oscType;
        shimOsc.frequency.value = freq;
        shimOsc.detune.value = shimmerCents;
        const shimGain = ctx.createGain();
        shimGain.gain.setValueAtTime(0.001, noteStart);
        shimGain.gain.linearRampToValueAtTime(vol * 0.35, noteStart + 0.015);
        shimGain.gain.exponentialRampToValueAtTime(0.001, decay);
        shimOsc.connect(shimGain);
        shimGain.connect(ctx.destination);
        oscillators.push(shimOsc);
        gains.push(shimGain);
        shimOsc.start(noteStart);
        shimOsc.stop(decay + 0.05);
      }

      if (isLast) {
        osc.onended = () => {
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
      }
    });

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
 * Create a chord sound (multiple simultaneous notes)
 */
export function createChordSound(tune: BaseTune, instrument: InstrumentConfig): SoundSynthesizer {
  return (ctx: AudioContext, opts: PlaySoundOptions): SoundPlayback => {
    const t = ctx.currentTime;
    const vol = (opts.volume ?? 1) * (tune.volume ?? 1) * instrument.gainMult;
    const duration = tune.duration * instrument.decayMult;
    const notes = tune.notes ?? [261.63, 329.63, 392.0];

    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [];

    const noteVol = vol / Math.sqrt(notes.length);

    notes.forEach((noteFreq) => {
      const freq = noteFreq * instrument.pitchMult;
      const osc = ctx.createOscillator();
      osc.type = instrument.oscType;
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(noteVol, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      oscillators.push(osc);
      gains.push(gain);
    });

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

    oscillators[0].onended = cleanup;

    oscillators.forEach((o) => {
      o.start(t);
      o.stop(t + duration + 0.05);
    });

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
