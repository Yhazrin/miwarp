/**
 * CLI Update Registry — tracks update status for external CLI tools.
 *
 * Covers Claude Code, Codex, and MiMo. Each tool has an update strategy:
 * - Claude Code: `claude update` (native self-update)
 * - Codex: official installer upgrade
 * - MiMo: repository-accurate capability display
 *
 * The registry does NOT auto-download or execute remote scripts.
 * It only checks versions and provides accurate guidance.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import * as api from "$lib/api";

export type CliUpdateStrategy =
  | "native_update" // e.g. `claude update`
  | "official_installer" // user downloads from official site
  | "repo_guided"; // show accurate guidance based on repo capability

export type CliUpdateStatus =
  | "unknown"
  | "checking"
  | "installed"
  | "up_to_date"
  | "update_available"
  | "error";

export interface CliToolEntry {
  id: string;
  name: string;
  strategy: CliUpdateStrategy;
  installedVersion: string | null;
  latestVersion: string | null;
  status: CliUpdateStatus;
  error: string | null;
  docsUrl: string;
  updateCommand?: string; // e.g. "claude update"
}

const STORAGE_KEY = "ocv:cli-update-registry";

const CLI_TOOLS: Omit<CliToolEntry, "installedVersion" | "latestVersion" | "status" | "error">[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    strategy: "native_update",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
    updateCommand: "claude update",
  },
  {
    id: "codex",
    name: "Codex CLI",
    strategy: "official_installer",
    docsUrl: "https://github.com/openai/codex",
  },
  {
    id: "mimo",
    name: "MiMo Code",
    strategy: "repo_guided",
    docsUrl: "https://github.com/XiaoMiMiMo/mimo",
  },
];

function createDefaultEntries(): CliToolEntry[] {
  return CLI_TOOLS.map((t) => ({
    ...t,
    installedVersion: null,
    latestVersion: null,
    status: "unknown" as CliUpdateStatus,
    error: null,
  }));
}

export class CliUpdateRegistry {
  private _entries = $state<CliToolEntry[]>(createDefaultEntries());
  private _checkInFlight: Map<string, Promise<void>> = new Map();
  private _checkAllInFlight: Promise<void> | null = null;

  get entries(): CliToolEntry[] {
    return this._entries;
  }

  getEntry(id: string): CliToolEntry | undefined {
    return this._entries.find((e) => e.id === id);
  }

  /** Load cached state from localStorage. */
  loadCache(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as Partial<CliToolEntry>[];
      if (!Array.isArray(cached)) return;
      const defaults = createDefaultEntries();
      this._entries = defaults.map((d) => {
        const c = cached.find((e) => e.id === d.id);
        return c ? { ...d, ...c } : d;
      });
    } catch {
      // ignore
    }
  }

  /** Persist current state to localStorage. */
  private _saveCache(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._entries));
    } catch {
      // ignore
    }
  }

  /** Check a single CLI tool's version. Single-flight per tool. */
  async checkTool(toolId: string): Promise<void> {
    if (this._checkInFlight.has(toolId)) return this._checkInFlight.get(toolId);

    const promise = this._doCheckTool(toolId);
    this._checkInFlight.set(toolId, promise);
    try {
      await promise;
    } finally {
      this._checkInFlight.delete(toolId);
    }
  }

  private async _doCheckTool(toolId: string): Promise<void> {
    const idx = this._entries.findIndex((e) => e.id === toolId);
    if (idx < 0) return;

    this._entries[idx] = { ...this._entries[idx], status: "checking", error: null };

    try {
      if (toolId === "claude-code") {
        const agentInfo = await api.checkAgentCli("claude").catch(() => null);
        const distTags = await api.getCliDistTags().catch(() => ({
          latest: undefined as string | undefined,
          stable: undefined as string | undefined,
        }));

        const installed = agentInfo?.found ? (agentInfo.version ?? null) : null;
        const latest = distTags.latest ?? null;

        this._entries[idx] = {
          ...this._entries[idx],
          installedVersion: installed,
          latestVersion: latest,
          status:
            installed && latest && installed !== latest
              ? "update_available"
              : installed
                ? "up_to_date"
                : "unknown",
        };
      } else if (toolId === "codex") {
        const agentInfo = await api.checkAgentCli("codex").catch(() => null);
        const installed = agentInfo?.found ? (agentInfo.version ?? null) : null;

        this._entries[idx] = {
          ...this._entries[idx],
          installedVersion: installed,
          latestVersion: null,
          status: installed ? "installed" : "unknown",
        };
      } else if (toolId === "mimo") {
        const runtime = await api.detectMimoRuntime().catch(() => null);
        const installed = runtime?.available ? (runtime.version ?? null) : null;

        this._entries[idx] = {
          ...this._entries[idx],
          installedVersion: installed,
          latestVersion: null,
          status: installed ? "installed" : "unknown",
        };
      }
    } catch (e) {
      this._entries[idx] = {
        ...this._entries[idx],
        status: "error",
        error: String(e),
      };
      dbgWarn("cli-update-registry", "check failed", { toolId, error: e });
    }

    this._saveCache();
    dbg("cli-update-registry", "checked", { toolId, status: this._entries[idx].status });
  }

  /** Check all tools. Single-flight. */
  async checkAll(): Promise<void> {
    if (this._checkAllInFlight) return this._checkAllInFlight;

    this._checkAllInFlight = (async () => {
      await Promise.allSettled(this._entries.map((e) => this.checkTool(e.id)));
    })();

    try {
      await this._checkAllInFlight;
    } finally {
      this._checkAllInFlight = null;
    }
  }

  /** Reset entries and in-flight state (tests / session teardown). */
  reset(): void {
    this._entries = createDefaultEntries();
    this._checkInFlight.clear();
    this._checkAllInFlight = null;
  }
}

export function createCliUpdateRegistry(): CliUpdateRegistry {
  return new CliUpdateRegistry();
}

export const cliUpdateRegistry = new CliUpdateRegistry();
