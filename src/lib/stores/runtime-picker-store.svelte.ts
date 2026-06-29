/**
 * v1.0.10 [R1-B] — Runtime picker selection state.
 *
 * Single source of truth for the welcome-screen CLI picker. Lifted out of
 * ChatConversationStage's local `$state` so the selection survives:
 *   - effect re-runs (`welcomeVisible` toggling, route changes)
 *   - component unmount/remount (split-workspace swaps)
 *   - concurrent probes (runtimeHubStore refresh)
 *
 * The probe lifecycle still lives in runtimeHubStore — this module only
 * owns *which* runtime the user has picked (and whether that choice was
 * manual or from the configured default).
 */
import type { SupportedRuntimeId } from "$lib/runtime";

const FALLBACK_RUNTIME: SupportedRuntimeId = "claude";

class RuntimePickerStore {
  /** Current selection shown by the picker; mirrored onto `store.agent`. */
  selected = $state<SupportedRuntimeId>(FALLBACK_RUNTIME);
  /** True once the user has explicitly chosen a runtime this session —
   *  blocks `loadRuntimeAvailability` from overwriting the manual pick. */
  userPicked = $state(false);

  select(id: SupportedRuntimeId): void {
    this.selected = id;
    this.userPicked = true;
  }

  /** Called by the probe effect when the user has NOT picked a runtime yet.
   *  Reconciles the selection with the configured default. */
  applyDefault(id: SupportedRuntimeId): void {
    if (this.userPicked) return;
    this.selected = id;
  }
}

export const runtimePickerStore = new RuntimePickerStore();
