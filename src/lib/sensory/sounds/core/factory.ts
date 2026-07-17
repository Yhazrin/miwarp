/**
 * Sound Factory - Combines tunes with instruments to produce synthesizers.
 *
 * This is the core of the soundpack system. It takes a tune (musical definition)
 * and an instrument (synthesis parameters) and produces a SoundSynthesizer.
 *
 * Based on the FeelParams system from userinterface.wiki
 */

import type { SoundSynthesizer } from "../../config/engine";
import type { BaseTune } from "./tunes";
import type { InstrumentConfig } from "./instruments";

import { createClickSound, createPopSound, createToggleSound, createTickSound } from "./factory-basic";
import {
  createSweepSound,
  createRiseSound,
  createDropSound,
  createChimeSound,
  createArpeggioSound,
  createChordSound,
} from "./factory-sweep";
import { createBurstSound, createPulseSound, createWobbleSound } from "./factory-rhythmic";

/**
 * Create a SoundSynthesizer by combining a tune with an instrument.
 */
export function createSoundFromTune(
  tune: BaseTune,
  instrument: InstrumentConfig,
): SoundSynthesizer {
  switch (tune.type) {
    case "click":
      return createClickSound(tune, instrument);
    case "pop":
      return createPopSound(tune, instrument);
    case "toggle":
      return createToggleSound(tune, instrument);
    case "tick":
      return createTickSound(tune, instrument);
    case "sweep":
      return createSweepSound(tune, instrument);
    case "rise":
      return createRiseSound(tune, instrument);
    case "drop":
      return createDropSound(tune, instrument);
    case "chime":
      return createChimeSound(tune, instrument);
    case "arpeggio":
      return createArpeggioSound(tune, instrument);
    case "chord":
      return createChordSound(tune, instrument);
    case "burst":
      return createBurstSound(tune, instrument);
    case "pulse":
      return createPulseSound(tune, instrument);
    case "wobble":
      return createWobbleSound(tune, instrument);
    default:
      return createChimeSound(tune, instrument);
  }
}
