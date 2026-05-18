/**
 * Composable: slash command menu for PromptInput.
 *
 * Manages the "/" command menu with sub-views for model selection and fast mode.
 */
import { goto } from "$app/navigation";
import type { CliCommand, CliModelInfo } from "$lib/types";
import type { PromptInputStore } from "$lib/stores";
import { dbg } from "$lib/utils/debug";
import {
  filterSlashCommands,
  mergeWithVirtual,
  getCommandInteraction,
  getArgumentHint,
  getQuickActions,
  classifyCloseReason,
  groupSlashCommands,
  VIRTUAL_COMMANDS,
} from "$lib/utils/slash-commands";
import type { SlashCommandGroups } from "$lib/utils/slash-commands";

export function useSlashMenu(opts: {
  store: PromptInputStore;
  agent: () => string;
  useStreamSession: () => boolean;
  cliCommands: () => CliCommand[];
  models: () => CliModelInfo[];
  fastModeState: () => string;
  availableSkills: () => string[];
  onModelSwitch?: (model: string) => void;
  onFastModeSwitch?: (mode: "on" | "off") => void;
  onVirtualCommand?: (action: string, args: string) => void;
  onSend: (text: string) => void;
  closeAtMenu: (reason: string) => void;
  closeModeDropdown: () => void;
}) {
  const { store } = opts;

  // ── State ──
  let slashMenuOpen = $state(false);
  let slashSelectedIndex = $state(0);
  let slashPhase: "commands" | "sub-model" | "sub-fast" = $state("commands");
  let slashSubSelectedIndex = $state(0);
  let activeSlashCmd: CliCommand | null = $state(null);
  let slashBtnEl = $state<HTMLButtonElement | undefined>();
  /** When true, position the slash menu from the / toolbar button (right-aligned) instead of the textarea. */
  let slashPreferTriggerAnchor = $state(false);
  let savedInputForSlash = $state("");

  // ── Derived ──
  const slashEnabled = $derived(opts.agent() === "claude" && !!opts.useStreamSession());

  const allCommands = $derived(mergeWithVirtual(opts.cliCommands()));
  const quickActions = $derived(getQuickActions(allCommands));
  const skillNameSet = $derived(new Set(opts.availableSkills()));

  const slashQuery = $derived.by(() => {
    if (!slashMenuOpen || slashPhase !== "commands") return null;
    const m = store.inputText.match(/^\/([a-zA-Z0-9_-]*)$/);
    return m?.[1] ?? "";
  });

  const filteredCommands = $derived.by(() => {
    if (slashQuery === null) return [];
    return filterSlashCommands(allCommands, slashQuery);
  });

  const slashGroups = $derived.by((): SlashCommandGroups | null => {
    if (slashQuery !== "") return null;
    if (filteredCommands.length === 0) return null;
    return groupSlashCommands(filteredCommands, skillNameSet);
  });

  const effectiveCommands = $derived(slashGroups ? slashGroups.flatOrder : filteredCommands);

  const hintText = $derived.by(() => {
    if (slashPhase !== "commands" || effectiveCommands.length === 0) return "";
    const idx = Math.min(slashSelectedIndex, effectiveCommands.length - 1);
    return getArgumentHint(effectiveCommands[idx]);
  });

  $effect(() => {
    if (slashMenuOpen)
      dbg("slash", slashGroups ? "grouped" : "flat", { count: effectiveCommands.length });
  });

  // Force close when conditions no longer met
  $effect(() => {
    if (!slashEnabled && slashMenuOpen) {
      closeSlashMenu("disabled");
    }
  });

  // ── Functions ──

  function restoreSavedInput() {
    if (savedInputForSlash !== "") {
      store.inputText = savedInputForSlash;
      savedInputForSlash = "";
    }
  }

  function clearSavedInput() {
    savedInputForSlash = "";
  }

  function closeSlashMenu(reason: string) {
    if (!slashMenuOpen) return;
    dbg("slash", `close:${reason}`);
    slashPreferTriggerAnchor = false;
    slashMenuOpen = false;
    slashPhase = "commands";
    activeSlashCmd = null;
    slashSelectedIndex = 0;
    slashSubSelectedIndex = 0;

    if (classifyCloseReason(reason) === "clear") {
      clearSavedInput();
    } else {
      restoreSavedInput();
    }
  }

  function selectSlashCommand(cmd: CliCommand, trigger: "enter" | "tab") {
    const interaction = getCommandInteraction(cmd);
    dbg("slash", `select:${interaction}:${trigger}`, { name: cmd.name });

    switch (interaction) {
      case "immediate":
        if (trigger === "enter") {
          store.inputText = `/${cmd.name}`;
          closeSlashMenu("execute");
          opts.onSend(`/${cmd.name}`);
        } else {
          closeSlashMenu("fill");
          store.inputText = `/${cmd.name} `;
          moveCursorToEnd();
        }
        break;
      case "free-text":
        closeSlashMenu("fill");
        store.inputText = `/${cmd.name} `;
        moveCursorToEnd();
        break;
      case "enum":
        activeSlashCmd = cmd;
        store.inputText = `/${cmd.name} `;
        if (cmd.name === "fast") {
          slashPhase = "sub-fast";
          slashSubSelectedIndex = opts.fastModeState() === "on" ? 1 : 0;
        } else {
          slashPhase = "sub-model";
          slashSubSelectedIndex = 0;
        }
        moveCursorToEnd();
        break;
    }
  }

  function goBackToCommands() {
    const cmdName = activeSlashCmd?.name;
    dbg("slash", "back-to-commands", { from: cmdName });
    activeSlashCmd = null;
    slashPhase = "commands";
    slashSubSelectedIndex = 0;
    if (cmdName) store.inputText = `/${cmdName}`;
    slashSelectedIndex = 0;
    moveCursorToEnd();
  }

  function handleSubModelSelect(model: CliModelInfo) {
    dbg("slash", "sub-model-select", { value: model.value });
    const restoreText = savedInputForSlash;
    closeSlashMenu("sub-select");
    store.inputText = restoreText;
    if (store.textareaEl) store.textareaEl.style.height = "auto";
    opts.onModelSwitch?.(model.value);
  }

  function handleFastModeSelect(mode: "on" | "off") {
    dbg("slash", "fast-select", { mode });
    const restoreText = savedInputForSlash;
    closeSlashMenu("sub-select");
    store.inputText = restoreText;
    if (store.textareaEl) store.textareaEl.style.height = "auto";
    opts.onFastModeSwitch?.(mode);
  }

  function moveCursorToEnd() {
    requestAnimationFrame(() => {
      if (store.textareaEl) {
        store.textareaEl.selectionStart = store.textareaEl.selectionEnd = store.inputText.length;
        store.textareaEl.focus();
      }
    });
  }

  function openSlashMenuFromButton() {
    if (!slashEnabled) return;
    if (slashMenuOpen) {
      closeSlashMenu("button-toggle");
      return;
    }
    opts.closeAtMenu("slash-button");
    opts.closeModeDropdown();

    savedInputForSlash = store.inputText;
    store.inputText = "/";
    slashPreferTriggerAnchor = true;
    slashMenuOpen = true;
    slashPhase = "commands";
    slashSelectedIndex = 0;
    moveCursorToEnd();
    dbg("slash", "open:button", { saved: savedInputForSlash.length });
  }

  function handleQuickAction(cmd: CliCommand) {
    if (!slashEnabled) return;
    dbg("slash", "quick-action", { name: cmd.name });
    const interaction = getCommandInteraction(cmd);

    if (interaction === "enum") {
      opts.closeAtMenu("quick-action");
      opts.closeModeDropdown();
      savedInputForSlash = store.inputText;
      store.inputText = `/${cmd.name} `;
      activeSlashCmd = cmd;
      if (cmd.name === "fast") {
        slashPhase = "sub-fast";
        slashSubSelectedIndex = opts.fastModeState() === "on" ? 1 : 0;
      } else {
        slashPhase = "sub-model";
        slashSubSelectedIndex = 0;
      }
      slashPreferTriggerAnchor = false;
      slashMenuOpen = true;
      moveCursorToEnd();
      return;
    }

    if (interaction === "free-text") {
      opts.closeAtMenu("quick-action");
      opts.closeModeDropdown();
      store.inputText = `/${cmd.name} `;
      moveCursorToEnd();
      return;
    }

    // immediate
    const vDef = VIRTUAL_COMMANDS.find((v) => v.name === cmd.name);
    if (vDef) {
      if (typeof vDef["_action"] === "string" && opts.onVirtualCommand) {
        opts.onVirtualCommand(vDef["_action"] as string, "");
        return;
      }
      if (typeof vDef["_navigate"] === "string") {
        goto(vDef["_navigate"] as string);
        return;
      }
    }
    opts.onSend(`/${cmd.name}`);
  }

  /** Open slash menu programmatically (from handleInput when "/" is typed). */
  function openSlashMenu() {
    slashPreferTriggerAnchor = false;
    slashMenuOpen = true;
    slashPhase = "commands";
    slashSelectedIndex = 0;
  }

  return {
    get slashMenuOpen() {
      return slashMenuOpen;
    },
    get slashSelectedIndex() {
      return slashSelectedIndex;
    },
    set slashSelectedIndex(v: number) {
      slashSelectedIndex = v;
    },
    get slashPhase() {
      return slashPhase;
    },
    get slashSubSelectedIndex() {
      return slashSubSelectedIndex;
    },
    set slashSubSelectedIndex(v: number) {
      slashSubSelectedIndex = v;
    },
    get activeSlashCmd() {
      return activeSlashCmd;
    },
    get slashEnabled() {
      return slashEnabled;
    },
    get slashBtnEl() {
      return slashBtnEl;
    },
    set slashBtnEl(v: HTMLButtonElement | undefined) {
      slashBtnEl = v;
    },
    get slashPreferTriggerAnchor() {
      return slashPreferTriggerAnchor;
    },
    get filteredCommands() {
      return filteredCommands;
    },
    get slashGroups() {
      return slashGroups;
    },
    get effectiveCommands() {
      return effectiveCommands;
    },
    get hintText() {
      return hintText;
    },
    get quickActions() {
      return quickActions;
    },
    get allCommands() {
      return allCommands;
    },
    openSlashMenu,
    closeSlashMenu,
    selectSlashCommand,
    goBackToCommands,
    handleSubModelSelect,
    handleFastModeSelect,
    openSlashMenuFromButton,
    handleQuickAction,
    moveCursorToEnd,
  };
}
