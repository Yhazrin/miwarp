import type { SettingsTabId } from "$lib/components/settings/tabs/registry";
import * as api from "$lib/api";
import { cliUpdateRegistry } from "$lib/stores/cli-update-registry.svelte";
import { runtimeHubStore } from "$lib/stores/runtime-hub-store.svelte";
import { getTransport } from "$lib/transport";
import type { AgentSettings, UserSettings } from "$lib/types";

/** Tabs that may trigger subprocess / network heavy work when activated. */
export const HEAVY_SETTINGS_TABS = [
  "devices",
  "cli-behavior",
  "runtimes",
  "updates",
] as const satisfies readonly SettingsTabId[];

export type HeavySettingsTab = (typeof HEAVY_SETTINGS_TABS)[number];

export function isHeavySettingsTab(tab: SettingsTabId): tab is HeavySettingsTab {
  return (HEAVY_SETTINGS_TABS as readonly SettingsTabId[]).includes(tab);
}

export type WebServerStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  bind: string;
  tunnel_url?: string | null;
  warning?: string;
};

export type DevicesTabData = {
  webStatus: WebServerStatus | null;
  webToken: string | null;
  webLanIp: string | null;
};

export type CliBehaviorTabData = {
  cliConfig: Record<string, unknown>;
  projectCliConfig: Record<string, unknown>;
};

export type RuntimesTabData = {
  mimoAgentSettings: AgentSettings | null;
};

export type SettingsTabLoaderDeps = {
  getUserSettings: typeof api.getUserSettings;
  getWebServerStatus: typeof api.getWebServerStatus;
  getWebServerToken: typeof api.getWebServerToken;
  getLocalIp: typeof api.getLocalIp;
  getCliConfig: typeof api.getCliConfig;
  getProjectCliConfig: typeof api.getProjectCliConfig;
  getAgentSettings: typeof api.getAgentSettings;
  isDesktop: () => boolean;
  runtimeHubRefresh: (force?: boolean) => Promise<void>;
  cliUpdateLoadCache: () => void;
  readProjectCwd: () => string;
};

export const defaultSettingsTabLoaderDeps = (): SettingsTabLoaderDeps => ({
  getUserSettings: api.getUserSettings,
  getWebServerStatus: api.getWebServerStatus,
  getWebServerToken: api.getWebServerToken,
  getLocalIp: api.getLocalIp,
  getCliConfig: api.getCliConfig,
  getProjectCliConfig: api.getProjectCliConfig,
  getAgentSettings: api.getAgentSettings,
  isDesktop: () => getTransport().isDesktop(),
  runtimeHubRefresh: (force) => runtimeHubStore.refresh(force),
  cliUpdateLoadCache: () => cliUpdateRegistry.loadCache(),
  readProjectCwd: () =>
    typeof localStorage !== "undefined" ? localStorage.getItem("ocv:project-cwd") || "" : "",
});

export type TabLoadGuard = {
  isActive: () => boolean;
};

export class SettingsTabLoadController {
  private loaded = new Set<SettingsTabId>();
  private inFlight = new Map<SettingsTabId, Promise<void>>();
  private generation = 0;

  bumpGeneration(): void {
    this.generation += 1;
    this.loaded.clear();
    this.inFlight.clear();
  }

  isLoaded(tab: SettingsTabId): boolean {
    return this.loaded.has(tab);
  }

  loadedTabs(): SettingsTabId[] {
    return [...this.loaded];
  }

  async ensureTabLoaded(
    tab: SettingsTabId,
    guard: TabLoadGuard,
    load: (tab: SettingsTabId) => Promise<void>,
  ): Promise<void> {
    if (this.loaded.has(tab)) return;
    const existing = this.inFlight.get(tab);
    if (existing) return existing;

    const gen = this.generation;
    const promise = Promise.resolve()
      .then(() => load(tab))
      .then(() => {
        if (gen === this.generation && guard.isActive()) {
          this.loaded.add(tab);
        }
      })
      .finally(() => {
        // A previous generation may finish after a replacement request has
        // already occupied this slot. Only the owning promise may clear it.
        if (this.inFlight.get(tab) === promise) {
          this.inFlight.delete(tab);
        }
      });
    this.inFlight.set(tab, promise);
    return promise;
  }
}

export async function fetchDevicesTabData(
  guard: TabLoadGuard,
  deps: SettingsTabLoaderDeps = defaultSettingsTabLoaderDeps(),
): Promise<DevicesTabData | null> {
  if (!deps.isDesktop()) {
    return { webStatus: null, webToken: null, webLanIp: null };
  }
  const [webStatus, webToken] = await Promise.all([
    deps.getWebServerStatus(),
    deps.getWebServerToken(),
  ]);
  if (!guard.isActive()) return null;

  let webLanIp: string | null = null;
  if (webStatus?.running) {
    const bind = webStatus.bind;
    if (bind === "0.0.0.0" || bind === "::" || bind === "[::]") {
      const preferV6 = bind === "::" || bind === "[::]";
      webLanIp = await deps.getLocalIp(preferV6).catch(() => null);
      if (!guard.isActive()) return null;
    }
  }

  return { webStatus, webToken, webLanIp };
}

export async function fetchCliBehaviorTabData(
  guard: TabLoadGuard,
  deps: SettingsTabLoaderDeps = defaultSettingsTabLoaderDeps(),
): Promise<CliBehaviorTabData | null> {
  const cliConfig = await deps.getCliConfig();
  if (!guard.isActive()) return null;

  let projectCliConfig: Record<string, unknown> = {};
  const cwd = deps.readProjectCwd();
  if (cwd) {
    projectCliConfig = await deps.getProjectCliConfig(cwd).catch(() => ({}));
    if (!guard.isActive()) return null;
  }

  return { cliConfig, projectCliConfig };
}

export async function fetchRuntimesTabData(
  guard: TabLoadGuard,
  deps: SettingsTabLoaderDeps = defaultSettingsTabLoaderDeps(),
): Promise<RuntimesTabData | null> {
  await deps.runtimeHubRefresh(false);
  if (!guard.isActive()) return null;
  const mimoAgentSettings = await deps.getAgentSettings("mimo").catch(() => null);
  if (!guard.isActive()) return null;
  return { mimoAgentSettings };
}

export function fetchUpdatesTabData(
  guard: TabLoadGuard,
  deps = defaultSettingsTabLoaderDeps(),
): void {
  if (!guard.isActive()) return;
  deps.cliUpdateLoadCache();
}

export async function loadSettingsPageCore(
  guard: TabLoadGuard,
  deps: Pick<SettingsTabLoaderDeps, "getUserSettings"> = defaultSettingsTabLoaderDeps(),
): Promise<UserSettings | null> {
  const settings = await deps.getUserSettings();
  if (!guard.isActive()) return null;
  return settings;
}

export function createMountedGuard(getMounted: () => boolean): TabLoadGuard {
  return { isActive: getMounted };
}
