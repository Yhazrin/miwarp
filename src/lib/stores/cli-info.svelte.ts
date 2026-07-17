import * as api from "$lib/api";
import type { CliInfo, CliModelInfo, CliCommand } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

let _infos: Record<string, CliInfo | null> = $state({});
const _loadingAgents = new Set<string>();
const _loadedAgents = new Set<string>();

function normalizeAgent(agent?: string): string {
  return agent?.trim() || "claude";
}

export function getCliModels(agent?: string): CliModelInfo[] {
  return _infos[normalizeAgent(agent)]?.models ?? [];
}

export function getCliCommands(agent?: string): CliCommand[] {
  return _infos[normalizeAgent(agent)]?.commands ?? [];
}

/** The model currently active in Claude Code (from ~/.claude/settings.json). */
export function getCliCurrentModel(agent?: string): string | undefined {
  return _infos[normalizeAgent(agent)]?.current_model ?? undefined;
}

function getCliInfo_cached(agent?: string): CliInfo | null {
  return _infos[normalizeAgent(agent)] ?? null;
}

export async function loadCliInfo(force = false, agent?: string): Promise<CliInfo | null> {
  const key = normalizeAgent(agent);
  if (_loadedAgents.has(key) && !force) return _infos[key] ?? null;
  if (_loadingAgents.has(key)) return _infos[key] ?? null; // dedupe concurrent calls
  _loadingAgents.add(key);
  try {
    dbg("cli-info", "loading", { agent: key, force });
    const info = await api.getCliInfo(force, key);
    _infos = { ..._infos, [key]: info };
    _loadedAgents.add(key);
    dbg("cli-info", "loaded", { agent: key, models: info.models.length });
  } catch (e) {
    dbgWarn("cli-info", "failed to load", { agent: key, error: e });
  } finally {
    _loadingAgents.delete(key);
  }
  return _infos[key] ?? null;
}

// ── CLI Version Info ──

export interface CliVersionInfo {
  installed?: string;
  channel?: string;
  latest?: string;
  stable?: string;
}

let _versionInfo: CliVersionInfo | null = $state(null);
let _versionLoading = $state(false);

export function getCliVersionInfo_cached(): CliVersionInfo | null {
  return _versionInfo;
}

function isCliVersionLoading(): boolean {
  return _versionLoading;
}

/** Update the cached installed version (e.g. after CLI self-updates during a session). */
export function updateInstalledVersion(version: string): void {
  if (!version || !_versionInfo) return;
  if (_versionInfo.installed === version) return;
  dbg("cli-info", "updateInstalledVersion", { from: _versionInfo.installed, to: version });
  _versionInfo = { ..._versionInfo, installed: version };
}

export async function loadCliVersionInfo(): Promise<void> {
  if (_versionLoading) return;
  _versionLoading = true;
  try {
    dbg("cli-info", "loadCliVersionInfo");
    const [cliCheck, distTags, cliConfig] = await Promise.all([
      api.checkAgentCli("claude").catch(() => null),
      api.getCliDistTags().catch(() => ({ latest: undefined, stable: undefined })),
      api.getCliConfig().catch(() => ({})),
    ]);

    if (!cliCheck?.found) {
      _versionInfo = null;
      dbg("cli-info", "loadCliVersionInfo: CLI not found");
      return;
    }

    _versionInfo = {
      installed: cliCheck.version ?? undefined,
      channel: ((cliConfig as Record<string, unknown>).autoUpdatesChannel as string) ?? undefined,
      latest: distTags.latest ?? undefined,
      stable: distTags.stable ?? undefined,
    };
    dbg("cli-info", "loadCliVersionInfo done", _versionInfo);
  } catch (e) {
    dbgWarn("cli-info", "loadCliVersionInfo failed", e);
  } finally {
    _versionLoading = false;
  }
}
