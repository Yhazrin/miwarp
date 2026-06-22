import { probeRuntimeAvailabilityWithStatus } from "$lib/runtime/availability";
import {
  isStartableRuntime,
  mergeRuntimeAvailability,
  resolveSelectionFallback,
} from "$lib/runtime/registry";
import type { ResolvedRuntime, RuntimeDetectionMap, SupportedRuntimeId } from "$lib/runtime/types";

const DEFAULT_RUNTIME_KEY = "ocv:default-runtime";
/** Skip re-probing when a recent refresh is still fresh (settings fast-path). */
export const RUNTIME_PROBE_TTL_MS = 30_000;

function readStoredDefault(): SupportedRuntimeId {
  try {
    const value = localStorage.getItem(DEFAULT_RUNTIME_KEY) as SupportedRuntimeId | null;
    return value ?? "claude";
  } catch {
    return "claude";
  }
}

export class RuntimeHubStore {
  detections = $state<RuntimeDetectionMap>({});
  runtimes = $state<ResolvedRuntime[]>(mergeRuntimeAvailability());
  loading = $state(false);
  error = $state<string | null>(null);
  lastCheckedAt = $state<number | null>(null);
  defaultRuntime = $state<SupportedRuntimeId>("claude");
  private inFlight: Promise<void> | null = null;
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.defaultRuntime = readStoredDefault();
    void this.refresh();
  }

  refresh(force = false): Promise<void> {
    if (
      !force &&
      !this.inFlight &&
      this.lastCheckedAt != null &&
      Date.now() - this.lastCheckedAt < RUNTIME_PROBE_TTL_MS
    ) {
      return Promise.resolve();
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefresh();
    return this.inFlight.finally(() => {
      this.inFlight = null;
    });
  }

  private async performRefresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const outcome = await probeRuntimeAvailabilityWithStatus();
      this.detections = outcome.detections;
      this.runtimes = mergeRuntimeAvailability(this.detections);
      this.defaultRuntime = resolveSelectionFallback(this.defaultRuntime, this.runtimes);
      this.persistDefault();
      this.lastCheckedAt = Date.now();
      if (outcome.probeFailed) {
        this.error = "Runtime detection failed: probes did not respond";
      }
    } catch (error) {
      this.error = String(error);
    } finally {
      this.loading = false;
    }
  }

  setDefault(id: SupportedRuntimeId): boolean {
    const runtime = this.runtimes.find((item) => item.id === id);
    if (!runtime?.available || !isStartableRuntime(id)) return false;
    this.defaultRuntime = id;
    this.persistDefault();
    return true;
  }

  runtime(id: SupportedRuntimeId): ResolvedRuntime | undefined {
    return this.runtimes.find((item) => item.id === id);
  }

  get installedCount(): number {
    return this.runtimes.filter((runtime) => runtime.available).length;
  }

  get startableCount(): number {
    return this.runtimes.filter((runtime) => runtime.selectable).length;
  }

  private persistDefault(): void {
    try {
      localStorage.setItem(DEFAULT_RUNTIME_KEY, this.defaultRuntime);
    } catch {
      // Private mode or unavailable storage: keep the in-memory choice.
    }
  }
}

export const runtimeHubStore = new RuntimeHubStore();
