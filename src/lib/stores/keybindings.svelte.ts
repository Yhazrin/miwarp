import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { KeyBinding, KeyBindingOverride } from "$lib/types";
import { IS_MAC } from "$lib/utils/platform";
import { t } from "$lib/i18n/index.svelte";

// ── Platform detection ──

/** Physical Ctrl key → "Ctrl" on macOS, "Cmd" on other platforms
 *  (because normalizeKeyEvent maps non-mac Ctrl to "Cmd") */
const CTRL = IS_MAC ? "Ctrl" : "Cmd";

// ── Reserved system keys ──

export const RESERVED_KEYS = new Set([
  "Cmd+C",
  "Cmd+V",
  "Cmd+X",
  "Cmd+Z",
  "Cmd+A",
  "Cmd+Q",
  "Cmd+H",
  "Cmd+M",
  "Cmd+W",
  "Cmd+Tab",
  "Ctrl+C",
  "Ctrl+V",
  "Ctrl+X",
  "Ctrl+Z",
  "Ctrl+A",
]);

// ── Default App keybindings ──

export const APP_DEFAULTS: KeyBinding[] = [
  {
    command: "app:toggleSidebar",
    label: t("keybind_toggleSidebar"),
    key: "Cmd+B",
    context: "global",
    editable: true,
    source: "app",
  },
  {
    command: "app:commandPalette",
    label: t("keybind_commandPalette"),
    key: "Cmd+K",
    context: "global",
    editable: true,
    source: "app",
  },
  {
    command: "app:newChat",
    label: t("keybind_newChat"),
    key: "Cmd+N",
    context: "global",
    editable: true,
    source: "app",
  },
  // Screenshot only on macOS (backend uses screencapture)
  ...(IS_MAC
    ? [
        {
          command: "app:screenshot" as const,
          label: t("keybind_captureScreenshot"),
          // SYNC: default also in src-tauri/src/commands/screenshot.rs init_screenshot_hotkey
          key: "Cmd+Ctrl+S",
          context: "global" as const,
          editable: true,
          source: "app" as const,
          osGlobal: true,
        },
      ]
    : []),
  {
    command: "chat:interrupt",
    label: t("keybind_interruptSession"),
    key: "Escape",
    context: "chat",
    editable: true,
    source: "app",
  },
  {
    command: "chat:sendGlobal",
    label: t("keybind_sendMessage"),
    key: "Cmd+Enter",
    context: "chat",
    editable: true,
    source: "app",
  },
  {
    command: "prompt:send",
    label: t("keybind_sendMessage"),
    key: "Enter",
    context: "prompt",
    editable: false,
    source: "app",
  },
  {
    command: "prompt:newline",
    label: t("keybind_newLine"),
    key: "Shift+Enter",
    context: "prompt",
    editable: false,
    source: "app",
  },
  {
    command: "app:shortcutHelp",
    label: t("keybind_shortcutHelp"),
    key: "?",
    context: "chat",
    editable: true,
    source: "app",
  },
  {
    command: "app:modelPicker",
    label: t("keybind_switchModel"),
    key: "Cmd+P",
    context: "global",
    editable: true,
    source: "app",
  },
  {
    command: "chat:cyclePermission",
    label: t("keybind_cyclePermMode"),
    key: "Shift+Tab",
    context: "chat",
    editable: true,
    source: "app",
  },
  {
    command: "chat:stashPrompt",
    label: t("keybind_stashPrompt"),
    key: `${CTRL}+S`,
    context: "global",
    editable: true,
    source: "app",
  },
  {
    command: "app:toggleFastMode",
    label: t("keybind_toggleFast"),
    key: "Cmd+O",
    context: "global",
    editable: true,
    source: "app",
  },
  {
    command: "chat:toggleVerbose",
    label: t("keybind_toggleVerbose"),
    key: IS_MAC ? "Ctrl+O" : "Alt+O",
    context: "chat",
    editable: true,
    source: "app",
  },
  {
    command: "chat:toggleTasks",
    label: t("keybind_toggleTaskPanel"),
    key: `${CTRL}+T`,
    context: "chat",
    editable: true,
    source: "app",
  },
  {
    command: "chat:undoLastTurn",
    label: t("keybind_undoRewind"),
    key: `${CTRL}+Shift+_`,
    context: "chat",
    editable: true,
    source: "app",
  },
  {
    command: "app:exportChatHtml",
    label: t("keybind_exportHtml"),
    key: "Cmd+Shift+H",
    context: "global",
    editable: true,
    source: "app",
  },
];

// ── Default CLI keybindings (read-only, best-effort) ──

export const CLI_DEFAULTS: KeyBinding[] = [
  {
    command: "cli:interrupt",
    label: t("keybind_interrupt"),
    key: "Ctrl+C",
    context: "cli",
    editable: false,
    source: "cli",
  },
  {
    command: "cli:cycleMode",
    label: t("keybind_cycleMode"),
    key: "Shift+Tab",
    context: "cli",
    editable: false,
    source: "cli",
  },
  {
    command: "cli:modelPicker",
    label: t("keybind_modelPicker"),
    key: "Alt+P",
    context: "cli",
    editable: false,
    source: "cli",
  },
  {
    command: "cli:themeToggle",
    label: t("keybind_themeToggle"),
    key: "Alt+T",
    context: "cli",
    editable: false,
    source: "cli",
  },
  {
    command: "cli:verboseToggle",
    label: t("keybind_verboseToggle"),
    key: "Alt+V",
    context: "cli",
    editable: false,
    source: "cli",
  },
  {
    command: "cli:debugPanel",
    label: t("keybind_debugPanel"),
    key: "Alt+D",
    context: "cli",
    editable: false,
    source: "cli",
  },
];

// ── Key normalization utilities ──

/**
 * Normalize a KeyboardEvent into a canonical key string like "Cmd+Shift+B".
 * Returns "" for modifier-only presses.
 */
export function normalizeKeyEvent(e: KeyboardEvent): string {
  const key = e.key;

  // Ignore modifier-only presses
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) return "";

  const parts: string[] = [];
  if (IS_MAC ? e.metaKey : e.ctrlKey) parts.push("Cmd");
  if (!IS_MAC && e.metaKey) parts.push("Meta");
  if (e.ctrlKey && IS_MAC) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  // Shift+symbol fix: when Shift is the only modifier and produces a symbol char
  // (e.g. Shift+/ → "?"), omit the Shift prefix so the binding matches plain "?".
  // When other modifiers are present (e.g. Ctrl+Shift+- → "_"), keep Shift.
  const hasOtherMods = parts.length > 0;
  const isShiftedSymbol =
    e.shiftKey && !hasOtherMods && key.length === 1 && /[^a-zA-Z0-9]/.test(key);
  if (e.shiftKey && !isShiftedSymbol) parts.push("Shift");

  // Normalize key names
  let normalizedKey = key;
  if (key === "Enter") normalizedKey = "Enter";
  else if (key === "Escape") normalizedKey = "Escape";
  else if (key === "Tab") normalizedKey = "Tab";
  else if (key === "Backspace") normalizedKey = "Backspace";
  else if (key === "Delete") normalizedKey = "Delete";
  else if (key === " ") normalizedKey = "Space";
  else if (key.length === 1) normalizedKey = key.toUpperCase();

  parts.push(normalizedKey);
  return parts.join("+");
}

/**
 * Format a key string for display using macOS symbols.
 * "Cmd+Shift+B" → "⌘⇧B"
 */
export function formatKeyDisplay(key: string): string {
  if (!key || key === "disabled") return "";

  if (IS_MAC) {
    const macSymbols: Record<string, string> = {
      Cmd: "⌘",
      Ctrl: "⌃",
      Alt: "⌥",
      Shift: "⇧",
      Meta: "⊞",
      Enter: "↵",
      Escape: "⎋",
      Tab: "⇥",
      Backspace: "⌫",
      Delete: "⌦",
      Space: "␣",
    };
    return key
      .split("+")
      .map((p) => macSymbols[p] ?? p)
      .join("");
  }

  // Windows / Linux: readable text joined with "+"
  const textMap: Record<string, string> = {
    Cmd: "Ctrl",
    Alt: "Alt",
    Shift: "Shift",
    Meta: "Win",
    Enter: "Enter",
    Escape: "Esc",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Space: "Space",
  };
  const mapped = key.split("+").map((p) => textMap[p] ?? p);
  // De-duplicate consecutive modifiers (e.g. Cmd+Ctrl → Ctrl+Ctrl → Ctrl)
  const deduped = mapped.filter((v, i, a) => i === 0 || v !== a[i - 1]);
  return deduped.join("+");
}

// ── Input target detection ──

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  // Duck-type check for HTMLElement (works in both browser and Node test env)
  const el = target as unknown as Record<string, unknown>;
  if (typeof el.tagName !== "string") return false;
  const tag = el.tagName as string;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable === true) return true;
  if (
    typeof el.closest === "function" &&
    (el.closest as (s: string) => unknown)("[role='textbox']")
  )
    return true;
  return false;
}

// ── KeybindingStore ──

export class KeybindingStore {
  bindings = $state<KeyBinding[]>([...APP_DEFAULTS, ...CLI_DEFAULTS]);
  overrides = $state<KeyBindingOverride[]>([]);
  recording = $state(false);

  // Command callback registry
  private _callbacks = new Map<string, () => void>();

  /** Resolved bindings (defaults + overrides applied) */
  resolved = $derived.by(() => {
    return this.bindings.map((b) => {
      if (!b.editable) return b;
      const o = this.overrides.find((x) => x.command === b.command);
      return o ? { ...b, key: o.key } : b;
    });
  });

  /**
   * Central dispatch: called by layout's single `<svelte:window onkeydown>`.
   * Matches event against resolved bindings and fires registered callbacks.
   */
  dispatch(e: KeyboardEvent): void {
    if (this.recording) return;

    const inInput = isEditableTarget(e.target);

    for (const b of this.resolved) {
      if (b.source !== "app") continue;
      if (b.key === "" || b.key === "disabled") continue;
      // In input fields, only fire global context commands
      if (inInput && b.context !== "global") continue;
      if (this._matchesEvent(e, b.key)) {
        const cb = this._callbacks.get(b.command);
        if (cb) {
          e.preventDefault();
          cb();
          return; // One command per keypress
        }
      }
    }
  }

  /** Register a command callback (called by page components on mount). */
  registerCallback(command: string, cb: () => void): void {
    this._callbacks.set(command, cb);
    dbg("keybindings", "registerCallback", command);
  }

  /** Unregister a command callback (called by page components on unmount). */
  unregisterCallback(command: string): void {
    this._callbacks.delete(command);
    dbg("keybindings", "unregisterCallback", command);
  }

  /** Check if a KeyboardEvent matches a specific command binding. */
  matches(e: KeyboardEvent, command: string): boolean {
    const b = this.resolved.find((x) => x.command === command);
    if (!b || b.key === "" || b.key === "disabled") return false;
    return this._matchesEvent(e, b.key);
  }

  /** Load overrides from persisted settings. */
  async loadOverrides(): Promise<void> {
    try {
      const settings = await api.getUserSettings();
      this.overrides = settings.keybinding_overrides ?? [];
      dbg("keybindings", "loadOverrides", { count: this.overrides.length });
    } catch (e) {
      dbgWarn("keybindings", "loadOverrides failed", e);
    }
  }

  /** Load CLI keybindings from ~/.claude/keybindings.json (best-effort). */
  async loadCliBindings(): Promise<void> {
    try {
      const { homeDir, join } = await import("@tauri-apps/api/path");
      const home = await homeDir();
      const absPath = await join(home, ".claude", "keybindings.json");
      const text = await api.readTextFile(absPath);
      const parsed = JSON.parse(text);
      dbg("keybindings", "loadCliBindings: parsed from file", {
        keys: Object.keys(parsed).length,
      });

      // Merge CLI keybindings onto defaults
      const updated = this.bindings.map((b) => {
        if (b.source !== "cli") return b;
        // Try to find matching key in parsed data
        const cliKey = parsed[b.command.replace("cli:", "")];
        if (cliKey && typeof cliKey === "string") {
          return { ...b, key: cliKey };
        }
        return b;
      });
      this.bindings = updated;
    } catch {
      // File doesn't exist or parse error — use defaults
      dbg("keybindings", "loadCliBindings: using defaults (file not found or parse error)");
    }
  }

  /** Sync an OS-level global shortcut with the Rust backend. */
  private async syncOsGlobal(command: string): Promise<void> {
    const def = APP_DEFAULTS.find((d) => d.command === command && d.osGlobal);
    if (!def) return;
    const resolved = this.resolved.find((b) => b.command === command);
    const key = resolved?.key || def.key;
    dbg("keybindings", "syncOsGlobal", { command, key });
    try {
      await api.updateScreenshotHotkey(key === "disabled" || key === "" ? null : key);
    } catch (e) {
      dbgWarn("keybindings", "syncOsGlobal failed", e);
    }
  }

  /** Set an override for a command. Persists to settings. */
  async setOverride(command: string, newKey: string): Promise<void> {
    const existing = this.overrides.filter((o) => o.command !== command);
    this.overrides = [...existing, { command, key: newKey }];
    dbg("keybindings", "setOverride", { command, key: newKey });

    try {
      await api.updateUserSettings({ keybinding_overrides: this.overrides });
    } catch (e) {
      dbgWarn("keybindings", "setOverride persist failed", e);
    }
    await this.syncOsGlobal(command);
  }

  /** Reset a single binding to default. */
  async resetBinding(command: string): Promise<void> {
    this.overrides = this.overrides.filter((o) => o.command !== command);
    dbg("keybindings", "resetBinding", command);

    try {
      await api.updateUserSettings({ keybinding_overrides: this.overrides });
    } catch (e) {
      dbgWarn("keybindings", "resetBinding persist failed", e);
    }
    await this.syncOsGlobal(command);
  }

  /** Reset all bindings to defaults. */
  async resetAll(): Promise<void> {
    this.overrides = [];
    dbg("keybindings", "resetAll");

    try {
      await api.updateUserSettings({ keybinding_overrides: [] });
    } catch (e) {
      dbgWarn("keybindings", "resetAll persist failed", e);
    }
    for (const def of APP_DEFAULTS) {
      if (def.osGlobal) await this.syncOsGlobal(def.command);
    }
  }

  /**
   * Find a conflicting binding for the given key and context.
   * Conflict matrix: global conflicts with everything, same context conflicts.
   */
  findConflict(key: string, context: string, excludeCmd?: string): KeyBinding | null {
    const conflicts = (ctx1: string, ctx2: string) =>
      ctx1 === "global" || ctx2 === "global" || ctx1 === ctx2;

    return (
      this.resolved.find(
        (b) =>
          b.command !== excludeCmd &&
          b.key === key &&
          b.source === "app" &&
          conflicts(b.context, context),
      ) ?? null
    );
  }

  /** Internal: check if a KeyboardEvent matches a key string. */
  private _matchesEvent(e: KeyboardEvent, key: string): boolean {
    const normalized = normalizeKeyEvent(e);
    if (!normalized) return false;
    return normalized === key;
  }
}
