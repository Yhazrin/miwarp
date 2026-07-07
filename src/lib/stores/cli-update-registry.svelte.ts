/**
 * CLI Update Registry — tracks update status for external CLI tools.
 *
 * Covers Claude Code, Codex, MiMo, and CC-Switch. The registry exposes a
 * `installOrUpdate` action that hands the heavy lifting off to the backend
 * (`run_cli_update`), which runs the canonical installer/upgrade command per
 * tool (npm global install for npm-distributed tools, `brew upgrade --cask`
 * for Homebrew-cask tools on macOS). Fallback strategies (`official_installer`,
 * `repo_guided`) remain for platforms / tools without a one-click path.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import * as api from "$lib/api";

export type CliUpdateStrategy =
  | "npm_global" // backend runs `npm install -g <pkg>` — Claude Code / Codex / MiMo
  | "homebrew_cask" // backend runs `brew upgrade --cask <cask>` on macOS — CC-Switch
  | "native_update" // legacy: tool exposes its own `update` subcommand
  | "official_installer" // user downloads from official site (no auto path)
  | "repo_guided"; // repo-specific install steps (no auto path)

export type CliUpdateStatus =
  | "unknown"
  | "checking"
  | "installed"
  | "up_to_date"
  | "update_available"
  | "installing"
  | "install_done"
  | "install_failed"
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
  updateCommand?: string; // shown in UI when no auto-update path is available
  /** How the tool is currently installed (e.g. "brew_cask", "dmg", "npm",
   *  "unknown"). Populated by the multi-source detect backend. Surfaced
   *  in the UI as a small "via Spotlight" / "via Homebrew" label so users
   *  can see why we picked the update method we did. */
  installMethod?: string;
  installPath?: string;
}

const STORAGE_KEY = "ocv:cli-update-registry";

const CLI_TOOLS: Omit<CliToolEntry, "installedVersion" | "latestVersion" | "status" | "error">[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    strategy: "npm_global",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
  },
  {
    id: "codex",
    name: "Codex CLI",
    strategy: "npm_global",
    docsUrl: "https://github.com/openai/codex",
  },
  {
    id: "mimo",
    name: "MiMo Code",
    strategy: "npm_global",
    docsUrl: "https://github.com/XiaomiMiMo/MiMo-Code",
  },
  {
    id: "ccswitch",
    name: "CC Switch",
    strategy: "homebrew_cask",
    docsUrl: "https://github.com/farion1231/cc-switch",
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
      } else if (toolId === "ccswitch") {
        // CC-Switch isn't a session agent and may have been installed via
        // a downloaded DMG (not on PATH). Use the multi-source detector
        // which knows about Spotlight / brew cask / etc.
        const detected = await api.detectCliTool("ccswitch").catch(() => null);
        const installed = detected?.found ? (detected.version ?? null) : null;

        this._entries[idx] = {
          ...this._entries[idx],
          installedVersion: installed,
          latestVersion: null,
          status: installed ? "installed" : "unknown",
          installMethod: detected?.install_method,
          installPath: detected?.install_path ?? undefined,
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

  /**
   * One-click install or update for a single tool. Delegates to the backend
   * `run_cli_update` command, which runs the canonical installer for the tool's
   * `strategy` (npm-global for codex/mimo/claude-code, homebrew-cask for
   * ccswitch on macOS). On success the local entry is refreshed via `checkTool`
   * so the UI immediately reflects the new installed version.
   *
   * Returns the raw `UpdateCliResult` (success/stdout/stderr) so callers can
   * surface logs to the user.
   */
  async installOrUpdate(toolId: string): Promise<api.UpdateCliResult> {
    const idx = this._entries.findIndex((e) => e.id === toolId);
    if (idx < 0) {
      throw new Error(`Unknown tool: ${toolId}`);
    }

    if (!this._canAutoUpdate(this._entries[idx])) {
      throw new Error(
        `Tool '${toolId}' does not support one-click install/upgrade from this build.`,
      );
    }

    this._entries[idx] = {
      ...this._entries[idx],
      status: "installing",
      error: null,
    };
    this._saveCache();
    dbg("cli-update-registry", "installOrUpdate start", { toolId });

    try {
      const result = await api.runCliUpdate(toolId);
      this._entries[idx] = {
        ...this._entries[idx],
        status: result.success ? "install_done" : "install_failed",
        error: result.success ? null : result.stderr || result.stdout || "install failed",
      };
      this._saveCache();

      // Only refresh on success — on failure the on-disk state didn't change,
      // and the post-refresh would clobber the `install_failed` indicator the
      // user needs to see. Best-effort; errors are swallowed.
      if (result.success) {
        void this.checkTool(toolId).catch(() => {
          /* best-effort refresh */
        });
      }

      dbg("cli-update-registry", "installOrUpdate done", {
        toolId,
        success: result.success,
      });
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._entries[idx] = {
        ...this._entries[idx],
        status: "install_failed",
        error: msg,
      };
      this._saveCache();
      dbgWarn("cli-update-registry", "installOrUpdate failed", { toolId, error: msg });
      throw e;
    }
  }

  /** Whether the tool has an automatic install/update path in this build. */
  private _canAutoUpdate(tool: CliToolEntry): boolean {
    return tool.strategy === "npm_global" || tool.strategy === "homebrew_cask";
  }

  /** Public accessor — UI uses this to decide whether to render the action button. */
  canAutoUpdate(toolId: string): boolean {
    const entry = this.getEntry(toolId);
    return entry ? this._canAutoUpdate(entry) : false;
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
