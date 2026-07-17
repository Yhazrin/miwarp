/**
 * Slash-command controller for PromptInput.
 *
 * Drives the `/`-triggered command menu:
 *   - detection from input text (`/`, or the Chinese pause mark `、`)
 *   - filtering against CLI + virtual commands
 *   - grouping by category
 *   - keyboard navigation (Up/Down/Enter/Tab/Esc)
 *   - sub-view phase (model picker, fast on/off)
 *   - selection → fill, execute, or sub-select
 *   - quick-action pill clicks (L3 above the composer)
 *   - menu opening from the L2 slash button
 *
 * The controller owns its own $state for menu open/phase/selection. The
 * parent (PromptInput shell) reads those values to render CommandPopover.
 *
 * All commands ultimately flow through one of three transitions:
 *   - fill:   `/<name> ` → user keeps typing
 *   - execute: `/<name>` (or virtual) → triggers an effect (send, navigate)
 *   - sub-select: sub-model / fast mode
 *
 * Uses $state runes → file must end in `.svelte.ts` so the Svelte compiler
 * transforms it. To keep this controller unit-testable in the vitest node
 * env, tests should mock `$state` and `$derived` (or simply avoid touching
 * the rune-using fields and only exercise `detectFromInput`/`close`/
 * `quickAction`/`selectCommand`, which are logic-only).
 */
import { dbg } from "$lib/utils/debug";
import {
  type SlashCommandGroups,
  VIRTUAL_COMMANDS,
  classifyCloseReason,
  filterSlashCommands,
  getArgumentHint,
  getCommandInteraction,
  getQuickActions,
  groupSlashCommands,
  isSubViewInputValid,
  mergeWithVirtual,
  shouldBackFromSubView,
} from "$lib/utils/slash-commands";
import type { CliCommand, CliModelInfo } from "$lib/types";

export type SlashPhase = "commands" | "sub-model" | "sub-fast";

/** Allow parent to inject navigation (lets us stub it in tests / Tauri builds). */
type GotoFn (href: string) => void;

export interface SlashCommandControllerDeps {
  /** Read the input text (where the slash goes). */
  getInputText: () => string;
  setInputText: (text: string) => void;
  /** Get/clear the textarea (for cursor positioning). */
  getTextareaEl: () => HTMLTextAreaElement | undefined;
  /** Read CLI commands from parent. */
  getCliCommands: () => CliCommand[];
  /** Skill names for category bucketing. */
  getAvailableSkills: () => string[];
  /** Current fast mode state for sub-view default selection. */
  getFastModeState: () => string;
  /** Stable agent identifier (e.g. "claude") to enable slash menu. */
  getAgent: () => string;
  /** Whether the connection is remote (disable mention in remote — applies to slash too). */
  isRemote: () => boolean;
  /** Open / close a sibling menu (e.g. at-menu) so they don't overlap. */
  onOpenSiblingMenu?: () => void;
  onCloseSiblingMenu?: () => void;
  /** Effect hooks (parent wires to send, navigate, switch model, etc.). */
  onSend: (text: string, attachments: []) => void | Promise<void>;
  onModelSwitch?: (model: string) => void;
  onFastModeSwitch?: (mode: "on" | "off") => void;
  onVirtualCommand?: (action: string, args: string) => void;
  onTriggerSend?: () => void;
  /** Navigation (svelte $app/navigation goto in production). */
  goto?: GotoFn;
}

export class SlashCommandController {
  /** Reactive-ish state (read by parent view). */
  open = $state(false);
  selectedIndex = $state(0);
  phase: SlashPhase = $state("commands");
  subSelectedIndex = $state(0);
  activeCmd: CliCommand | null = $state(null);
  /** Saved user draft so we can restore it on close. */
  savedInput = $state("");

  constructor(private readonly deps: SlashCommandControllerDeps) {}

  // ── Derived ──

  get enabled(): boolean {
    return this.deps.getAgent() === "claude";
  }

  get allCommands(): CliCommand[] {
    return mergeWithVirtual(this.deps.getCliCommands() ?? []);
  }

  get quickActions(): CliCommand[] {
    return getQuickActions(this.allCommands);
  }

  get skillNameSet(): Set<string> {
    return new Set(this.deps.getAvailableSkills());
  }

  get query(): string | null {
    if (!this.open || this.phase !== "commands") return null;
    const m = this.deps.getInputText().match(/^[/、]([a-zA-Z0-9_-]*)$/);
    return m?.[1] ?? "";
  }

  get filteredCommands(): CliCommand[] {
    if (this.query === null) return [];
    return filterSlashCommands(this.allCommands, this.query);
  }

  get groups(): SlashCommandGroups | null {
    if (this.query !== "") return null;
    if (this.filteredCommands.length === 0) return null;
    return groupSlashCommands(this.filteredCommands, this.skillNameSet);
  }

  get effectiveCommands(): CliCommand[] {
    return this.groups ? this.groups.flatOrder : this.filteredCommands;
  }

  get hintText(): string {
    if (this.phase !== "commands" || this.effectiveCommands.length === 0) return "";
    const idx = Math.min(this.selectedIndex, this.effectiveCommands.length - 1);
    return getArgumentHint(this.effectiveCommands[idx]);
  }

  // ── Detection (called from text-input onAfterSanitize) ──

  detectFromInput(): void {
    if (!this.enabled) {
      if (this.open) this.close("disabled");
      return;
    }

    if (this.phase === "sub-model" || this.phase === "sub-fast") {
      if (this.activeCmd && !isSubViewInputValid(this.deps.getInputText(), this.activeCmd.name)) {
        this.close("sub-invalid-input");
      }
      return;
    }

    // Commands phase
    const match = this.deps.getInputText().match(/^\/([a-zA-Z0-9_-]*)$/);
    if (match) {
      this.selectedIndex = 0;
      if (!this.open) {
        dbg("slash", "open", { query: match[1] });
        this.open = true;
        this.phase = "commands";
      }
    } else if (this.open) {
      this.close("no-match");
    }
  }

  // ── Lifecycle ──

  openFromButton(): void {
    if (!this.enabled) return;
    if (this.open) {
      this.close("button-toggle");
      return;
    }
    this.deps.onCloseSiblingMenu?.();

    this.savedInput = this.deps.getInputText();
    this.deps.setInputText("/");
    this.open = true;
    this.phase = "commands";
    this.selectedIndex = 0;
    this.moveCursorToEnd();
    dbg("slash", "open:button", { saved: this.savedInput.length });
  }

  close(reason: string): void {
    if (!this.open) return;
    dbg("slash", `close:${reason}`);
    this.open = false;
    this.phase = "commands";
    this.activeCmd = null;
    this.selectedIndex = 0;
    this.subSelectedIndex = 0;

    if (classifyCloseReason(reason) === "clear") {
      this.savedInput = "";
    } else if (this.savedInput !== "") {
      this.deps.setInputText(this.savedInput);
      this.savedInput = "";
    }
  }

  goBackToCommands(): void {
    const cmdName = this.activeCmd?.name;
    dbg("slash", "back-to-commands", { from: cmdName });
    this.activeCmd = null;
    this.phase = "commands";
    this.subSelectedIndex = 0;
    if (cmdName) this.deps.setInputText(`/${cmdName}`);
    this.selectedIndex = 0;
    this.moveCursorToEnd();
  }

  // ── Selection ──

  selectCommand(cmd: CliCommand, trigger: "enter" | "tab"): void {
    const interaction = getCommandInteraction(cmd);
    dbg("slash", `select:${interaction}:${trigger}`, { name: cmd.name });

    switch (interaction) {
      case "immediate":
        if (trigger === "enter") {
          this.deps.setInputText(`/${cmd.name}`);
          this.close("execute");
          this.deps.onTriggerSend?.();
        } else {
          this.close("fill");
          this.deps.setInputText(`/${cmd.name} `);
          this.moveCursorToEnd();
        }
        break;
      case "free-text":
        this.close("fill");
        this.deps.setInputText(`/${cmd.name} `);
        this.moveCursorToEnd();
        break;
      case "enum":
        this.activeCmd = cmd;
        this.deps.setInputText(`/${cmd.name} `);
        if (cmd.name === "fast") {
          this.phase = "sub-fast";
          this.subSelectedIndex = this.deps.getFastModeState() === "on" ? 1 : 0;
        } else {
          this.phase = "sub-model";
          this.subSelectedIndex = 0;
        }
        this.moveCursorToEnd();
        break;
    }
  }

  /** Handle L3 quick-action pill click. Mirrors `selectCommand` but executes immediately. */
  quickAction(cmd: CliCommand): void {
    if (!this.enabled) return;
    dbg("slash", "quick-action", { name: cmd.name });
    const interaction = getCommandInteraction(cmd);

    if (interaction === "enum") {
      this.deps.onCloseSiblingMenu?.();
      this.savedInput = this.deps.getInputText();
      this.deps.setInputText(`/${cmd.name} `);
      this.activeCmd = cmd;
      if (cmd.name === "fast") {
        this.phase = "sub-fast";
        this.subSelectedIndex = this.deps.getFastModeState() === "on" ? 1 : 0;
      } else {
        this.phase = "sub-model";
        this.subSelectedIndex = 0;
      }
      this.open = true;
      this.moveCursorToEnd();
      return;
    }

    if (interaction === "free-text") {
      this.deps.onCloseSiblingMenu?.();
      this.deps.setInputText(`/${cmd.name} `);
      this.moveCursorToEnd();
      return;
    }

    // immediate
    const vDef = VIRTUAL_COMMANDS.find((v) => v.name === cmd.name);
    if (vDef) {
      if (typeof vDef["_action"] === "string" && this.deps.onVirtualCommand) {
        this.deps.onVirtualCommand(vDef["_action"] as string, "");
        return;
      }
      if (typeof vDef["_navigate"] === "string") {
        this.deps.goto?.(vDef["_navigate"] as string);
        return;
      }
    }
    this.deps.onSend(`/${cmd.name}`, []);
  }

  subModelSelect(model: CliModelInfo): void {
    dbg("slash", "sub-model-select", { value: model.value });
    const restoreText = this.savedInput;
    this.close("sub-select");
    this.deps.setInputText(restoreText);
    const el = this.deps.getTextareaEl();
    if (el) el.style.height = "auto";
    this.deps.onModelSwitch?.(model.value);
  }

  fastModeSelect(mode: "on" | "off"): void {
    dbg("slash", "fast-select", { mode });
    const restoreText = this.savedInput;
    this.close("sub-select");
    this.deps.setInputText(restoreText);
    const el = this.deps.getTextareaEl();
    if (el) el.style.height = "auto";
    this.deps.onFastModeSwitch?.(mode);
  }

  // ── Keyboard navigation (called by parent's keydown handler) ──

  /** Return true if the controller consumed the key. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.open) return false;

    if (this.phase === "sub-model") {
      if (e.key === "Escape") {
        e.preventDefault();
        this.goBackToCommands();
        return true;
      }
      if (e.key === "Backspace") {
        if (
          shouldBackFromSubView(
            this.deps.getInputText(),
            this.deps.getTextareaEl()?.selectionStart ?? 0,
            this.activeCmd?.name,
          )
        ) {
          e.preventDefault();
          this.goBackToCommands();
          return true;
        }
        return false; // let backspace through
      }
      return false;
    }

    if (this.phase === "sub-fast") {
      if (e.key === "Escape") {
        e.preventDefault();
        this.goBackToCommands();
        return true;
      }
      if (e.key === "Backspace") {
        if (
          shouldBackFromSubView(
            this.deps.getInputText(),
            this.deps.getTextareaEl()?.selectionStart ?? 0,
            this.activeCmd?.name,
          )
        ) {
          e.preventDefault();
          this.goBackToCommands();
          return true;
        }
        return false;
      }
      return false;
    }

    // Commands phase
    if (e.key === "Escape") {
      e.preventDefault();
      this.close("escape");
      return true;
    }
    if (this.effectiveCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.effectiveCommands.length - 1);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        return true;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        this.selectCommand(this.effectiveCommands[this.selectedIndex], "enter");
        return true;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        this.selectCommand(this.effectiveCommands[this.selectedIndex], "tab");
        return true;
      }
    }
    return false;
  }

  /** Sub-model phase key handling (parent has the model list). */
  handleSubModelKey(e: KeyboardEvent, models: CliModelInfo[]): boolean {
    if (!this.open || this.phase !== "sub-model") return false;
    if (e.key === "ArrowDown" && models.length > 0) {
      e.preventDefault();
      this.subSelectedIndex = Math.min(this.subSelectedIndex + 1, models.length - 1);
      return true;
    }
    if (e.key === "ArrowUp" && models.length > 0) {
      e.preventDefault();
      this.subSelectedIndex = Math.max(this.subSelectedIndex - 1, 0);
      return true;
    }
    if ((e.key === "Enter" || e.key === "Tab") && models.length > 0) {
      e.preventDefault();
      this.subModelSelect(models[this.subSelectedIndex]);
      return true;
    }
    return false;
  }

  /** Sub-fast phase key handling. */
  handleSubFastKey(e: KeyboardEvent): boolean {
    if (!this.open || this.phase !== "sub-fast") return false;
    const FAST_OPTIONS = 2;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.subSelectedIndex = Math.min(this.subSelectedIndex + 1, FAST_OPTIONS - 1);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.subSelectedIndex = Math.max(this.subSelectedIndex - 1, 0);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.fastModeSelect(this.subSelectedIndex === 0 ? "off" : "on");
      return true;
    }
    return false;
  }

  private moveCursorToEnd(): void {
    requestAnimationFrame(() => {
      const el = this.deps.getTextareaEl();
      if (el) {
        el.selectionStart = el.selectionEnd = this.deps.getInputText().length;
        el.focus();
      }
    });
  }
}
