/**
 * MiWarp semantic sound feedback — powered by Sensory UI (Web Audio synthesizers).
 * https://sensory-ui.com — core engine vendored under src/lib/sensory/
 */
import { getUserSettings } from "$lib/api";
import type { BusEvent } from "$lib/types";
import {
  mergeConfig,
  resolveRole,
  type SensoryUIConfig,
} from "$lib/sensory/config/config";
import { getAudioContext, playSound } from "$lib/sensory/config/engine";
import type { SoundRole } from "$lib/sensory/config/sound-roles";
import type { SoundPackName } from "$lib/sensory/config/registry";
import { dbg, dbgWarn } from "$lib/utils/debug";

export type SoundFeedbackLevel = "off" | "minimal" | "standard" | "detailed";

export type MiWarpSoundEvent =
  | "agent_start"
  | "tool_complete"
  | "approval_required"
  | "run_failed"
  | "run_completed"
  | "rewind_success"
  | "plugin_installed";

const DEFAULT_LEVEL: SoundFeedbackLevel = "minimal";

const LEVEL_VOLUME: Record<Exclude<SoundFeedbackLevel, "off">, number> = {
  minimal: 0.28,
  standard: 0.3,
  detailed: 0.35,
};

const LEVEL_PACK: Record<Exclude<SoundFeedbackLevel, "off">, SoundPackName> = {
  minimal: "minimal",
  standard: "minimal",
  detailed: "aero",
};

/** Which MiWarp events fire at each feedback level. */
const LEVEL_EVENTS: Record<SoundFeedbackLevel, ReadonlySet<MiWarpSoundEvent> | null> = {
  off: null,
  minimal: new Set(["approval_required", "run_failed", "run_completed"]),
  standard: new Set([
    "approval_required",
    "run_failed",
    "run_completed",
    "agent_start",
    "tool_complete",
  ]),
  detailed: new Set([
    "approval_required",
    "run_failed",
    "run_completed",
    "agent_start",
    "tool_complete",
    "rewind_success",
    "plugin_installed",
  ]),
};

const EVENT_ROLE: Record<MiWarpSoundEvent, SoundRole> = {
  agent_start: "interaction.subtle",
  tool_complete: "interaction.tap",
  approval_required: "notification.warning",
  run_failed: "notification.error",
  run_completed: "notification.success",
  rewind_success: "navigation.backward",
  plugin_installed: "notification.success",
};

const DETAILED_RUN_COMPLETE_ROLE: SoundRole = "hero.complete";

let _level: SoundFeedbackLevel = DEFAULT_LEVEL;
let _config: SensoryUIConfig = buildConfig(DEFAULT_LEVEL);
let _settingsFetchedAt = 0;
const SETTINGS_TTL_MS = 30_000;

let _lastToolTickAt = 0;
const TOOL_TICK_MIN_MS = 280;

const _agentStartPlayed = new Set<string>();

/** Runs that saw running/spawning since last idle — updated synchronously before any await. */
const _activeTurnByRun = new Set<string>();

let _lastRunCompleteSoundAt = 0;
const RUN_COMPLETE_DEBOUNCE_MS = 1200;

/** Dedupe when both bus listener and session-store dispatch the same event. */
const _recentDispatchKeys = new Set<string>();

/** Suppress sounds while replaying stored bus events (loadRun / catchup). */
let _historyReplayDepth = 0;

export function beginHistorySoundMute(): void {
  _historyReplayDepth++;
}

export function endHistorySoundMute(): void {
  _historyReplayDepth = Math.max(0, _historyReplayDepth - 1);
}

function soundDbg(msg: string, data?: Record<string, unknown>): void {
  dbg("sound", msg, data);
}

function buildConfig(level: Exclude<SoundFeedbackLevel, "off">): SensoryUIConfig {
  const heroEnabled = level === "detailed";
  return mergeConfig({
    enabled: true,
    volume: LEVEL_VOLUME[level],
    theme: LEVEL_PACK[level],
    reducedMotion: "inherit",
    categories: {
      interaction: level !== "minimal",
      overlay: level === "detailed",
      navigation: level === "detailed",
      notification: true,
      hero: heroEnabled,
    },
  });
}

const REDUCED_MOTION_EXEMPT: ReadonlySet<MiWarpSoundEvent> = new Set([
  "approval_required",
  "run_failed",
  "run_completed",
  "plugin_installed",
]);

function isSuppressedByReducedMotion(event: MiWarpSoundEvent): boolean {
  if (REDUCED_MOTION_EXEMPT.has(event)) return false;
  if (typeof window === "undefined") return true;
  if (_config.reducedMotion === "force-off") return true;
  if (_config.reducedMotion === "force-on") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export async function unlockSoundEngine(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const ctx = getAudioContext();
    if (ctx.state !== "running") await ctx.resume();
    soundDbg("unlock", { state: ctx.state });
  } catch (e) {
    dbgWarn("sound", "unlock failed", e);
  }
}

export function normalizeSoundFeedbackLevel(raw: string | undefined | null): SoundFeedbackLevel {
  if (raw === "off" || raw === "minimal" || raw === "standard" || raw === "detailed") {
    return raw;
  }
  return DEFAULT_LEVEL;
}

export function getSoundFeedbackLevel(): SoundFeedbackLevel {
  return _level;
}

export function applySoundFeedbackLevel(level: SoundFeedbackLevel): void {
  _level = level;
  if (level === "off") {
    _config = mergeConfig({ enabled: false });
  } else {
    _config = buildConfig(level);
  }
}

export async function refreshSoundFeedbackSettings(): Promise<void> {
  const now = Date.now();
  if (now - _settingsFetchedAt < SETTINGS_TTL_MS) return;
  _settingsFetchedAt = now;
  try {
    const s = await getUserSettings();
    applySoundFeedbackLevel(normalizeSoundFeedbackLevel(s.sound_feedback_level));
  } catch {
    applySoundFeedbackLevel(DEFAULT_LEVEL);
  }
}

export function resetAgentStartCue(runId: string): void {
  _agentStartPlayed.delete(runId);
}

function dispatchDedupeKey(ev: BusEvent): string | null {
  switch (ev.type) {
    case "run_state":
      return `rs:${ev.run_id}:${ev.state}`;
    case "permission_prompt":
      return `pp:${ev.request_id}`;
    case "tool_end":
      return `te:${ev.tool_use_id}:${ev.status}`;
    default:
      return null;
  }
}

/**
 * Dispatch semantic sound for a live bus event (not history replay).
 * Called from session-store reducer so run_state ordering matches UI state.
 */
export function dispatchLiveBusSound(ev: BusEvent): void {
  if (_historyReplayDepth > 0) return;
  const key = dispatchDedupeKey(ev);
  if (key) {
    if (_recentDispatchKeys.has(key)) return;
    _recentDispatchKeys.add(key);
    setTimeout(() => _recentDispatchKeys.delete(key), 400);
  }
  void processBusSound(ev);
}

function roleForEvent(event: MiWarpSoundEvent): SoundRole {
  if (event === "run_completed" && _level === "detailed") {
    return DETAILED_RUN_COMPLETE_ROLE;
  }
  return EVENT_ROLE[event];
}

async function playRunCompletedDebounced(): Promise<void> {
  const now = Date.now();
  if (now - _lastRunCompleteSoundAt < RUN_COMPLETE_DEBOUNCE_MS) return;
  _lastRunCompleteSoundAt = now;
  await playMiWarpSound("run_completed");
}

async function processBusSound(ev: BusEvent): Promise<void> {
  if (ev.type === "run_state") {
    const { state, run_id: runId } = ev;
    if (state === "running" || state === "spawning") {
      _activeTurnByRun.add(runId);
      soundDbg("turn-active", { runId, state });
      await refreshSoundFeedbackSettings();
      await playMiWarpSound("agent_start", runId);
      return;
    }
    if (state === "idle") {
      const hadTurn = _activeTurnByRun.delete(runId);
      soundDbg("turn-idle", { runId, hadTurn, level: _level });
      await refreshSoundFeedbackSettings();
      if (hadTurn) await playRunCompletedDebounced();
      resetAgentStartCue(runId);
      return;
    }
    if (state === "completed") {
      _activeTurnByRun.delete(runId);
      await refreshSoundFeedbackSettings();
      await playRunCompletedDebounced();
      resetAgentStartCue(runId);
      return;
    }
    if (state === "failed" || state === "error") {
      _activeTurnByRun.delete(runId);
      await refreshSoundFeedbackSettings();
      await playMiWarpSound("run_failed");
      resetAgentStartCue(runId);
      return;
    }
    if (state === "stopped") {
      _activeTurnByRun.delete(runId);
      resetAgentStartCue(runId);
      return;
    }
    return;
  }

  await refreshSoundFeedbackSettings();

  if (ev.type === "permission_prompt") {
    soundDbg("permission", { runId: ev.run_id, tool: ev.tool_name });
    await playMiWarpSound("approval_required");
    return;
  }

  if (ev.type === "tool_end") {
    const status = ev.status ?? "";
    if (status === "completed" || status === "success") {
      await playMiWarpSound("tool_complete");
    }
  }
}

/** Play a semantic sound if the current level allows this event. */
export async function playMiWarpSound(event: MiWarpSoundEvent, runId?: string): Promise<void> {
  if (_level === "off" || !_config.enabled) {
    soundDbg("skip-off", { event, level: _level });
    return;
  }
  const allowed = LEVEL_EVENTS[_level];
  if (!allowed?.has(event)) {
    soundDbg("skip-level", { event, level: _level });
    return;
  }
  if (isSuppressedByReducedMotion(event)) {
    soundDbg("skip-reduced-motion", { event });
    return;
  }

  if (event === "agent_start") {
    if (!runId || _agentStartPlayed.has(runId)) return;
    _agentStartPlayed.add(runId);
    if (_agentStartPlayed.size > 200) {
      const first = _agentStartPlayed.values().next().value;
      if (first) _agentStartPlayed.delete(first);
    }
  }

  if (event === "tool_complete") {
    const now = Date.now();
    if (now - _lastToolTickAt < TOOL_TICK_MIN_MS) return;
    _lastToolTickAt = now;
  }

  const role = roleForEvent(event);
  const source = resolveRole(role, _config);
  if (!source) {
    soundDbg("skip-no-source", { event, role });
    return;
  }

  try {
    await unlockSoundEngine();
    soundDbg("play", { event, role, volume: _config.volume });
    await playSound(source, { volume: _config.volume });
  } catch (e) {
    dbgWarn("sound", "play failed", { event, role, e });
  }
}

export async function previewSoundFeedback(): Promise<void> {
  if (_level === "off") return;
  await unlockSoundEngine();
  const role: SoundRole =
    _level === "detailed" ? "hero.complete" : "notification.success";
  const source = resolveRole(role, _config);
  if (!source) return;
  try {
    await playSound(source, { volume: _config.volume });
  } catch (e) {
    dbgWarn("sound", "preview failed", e);
  }
}

export async function initSoundFeedback(): Promise<void> {
  await refreshSoundFeedbackSettings();
  soundDbg("init", { level: _level });
}

applySoundFeedbackLevel(DEFAULT_LEVEL);
