<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import type {
    Attachment,
    AuthOverview,
    CliCommand,
    CliModelInfo,
    DirEntry,
    PlatformCredential,
  } from "$lib/types";
  import * as api from "$lib/api";
  import { createGitBranchPoller } from "$lib/utils/git-branch";
  import AgentSelector from "./AgentSelector.svelte";
  import AuthSourceBadge from "./AuthSourceBadge.svelte";
  import SkillSelector from "./SkillSelector.svelte";
  import FileAttachment from "./FileAttachment.svelte";
  import SlashMenu from "./SlashMenu.svelte";
  import AtMentionMenu from "./AtMentionMenu.svelte";
  import {
    parseVirtualAction,
    VIRTUAL_COMMANDS,
    isSubViewInputValid,
    shouldBackFromSubView,
  } from "$lib/utils/slash-commands";
  import type { MessageKey } from "$lib/i18n/types";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { IS_MAC } from "$lib/utils/platform";
  import { t } from "$lib/i18n/index.svelte";
  import { formatPasteSize } from "$lib/utils/format";
  import { isSpreadsheetExt, getFileExtension } from "$lib/utils/file-types";
  import type { PromptInputSnapshot } from "$lib/types";
  import { PromptInputStore } from "$lib/stores";
  import {
    type HistoryState,
    type HistoryAction,
    createHistoryState,
    checkAndReset,
    resetHistory,
    shouldIntercept,
    getHistoryAction,
    hasMultipleVisualLines,
  } from "$lib/utils/input-history";
  import { useFileHandling } from "$lib/prompt/use-file-handling.svelte";
  import { useSlashMenu } from "$lib/prompt/use-slash-menu.svelte";
  import { useAtMention } from "$lib/prompt/use-at-mention.svelte";

  let {
    agent = "claude",
    disabled = false,
    hasRun = false,
    running = false,
    sessionAlive = false,
    canResume = false,
    useStreamSession = false,
    isRemote = false,
    cliCommands = [],
    models = [],
    currentModel = "",
    permissionMode = "",
    onSend,
    onAgentChange,
    onInterrupt,
    onModelSwitch,
    onPermissionModeChange,
    onVirtualCommand,
    fastModeState = "",
    onFastModeSwitch,
    cwd = "/",
    authMode = "cli",
    platformId = "anthropic",
    platformCredentials = [],
    onPlatformChange,
    authOverview = null,
    authSourceLabel = "",
    authSourceCategory = "unknown",
    apiKeySource = "",
    onAuthModeChange,
    localProxyStatuses = {} as Record<string, { running: boolean; needsAuth: boolean }>,
    availableSkills = [],
    skillItems = [],
    agents = [],
    showAuthBadge = true,
    pendingPermission = false,
    hasStash = false,
    onBtwSend,
    onRestoreStash,
    onShortcutHelp,
    userHistory = [] as string[],
    runId = "",
    onValueChange,
    contextWindow = 0,
    inputStore,
  }: {
    agent?: string;
    disabled?: boolean;
    hasRun?: boolean;
    running?: boolean;
    sessionAlive?: boolean;
    canResume?: boolean;
    useStreamSession?: boolean;
    isRemote?: boolean;
    cliCommands?: CliCommand[];
    models?: CliModelInfo[];
    currentModel?: string;
    permissionMode?: string;
    onSend: (text: string, attachments: Attachment[]) => void;
    onAgentChange?: (agent: string) => void;
    onInterrupt?: () => void;
    onModelSwitch?: (model: string) => void;
    onPermissionModeChange?: (mode: string) => void;
    onVirtualCommand?: (action: string, args: string) => void;
    fastModeState?: string;
    onFastModeSwitch?: (mode: "on" | "off") => void;
    cwd?: string;
    authMode?: string;
    platformId?: string;
    platformCredentials?: PlatformCredential[];
    onPlatformChange?: (platformId: string) => void;
    authOverview?: AuthOverview | null;
    authSourceLabel?: string;
    authSourceCategory?: string;
    apiKeySource?: string;
    onAuthModeChange?: (mode: string) => void;
    localProxyStatuses?: Record<string, { running: boolean; needsAuth: boolean }>;
    availableSkills?: string[];
    skillItems?: { name: string; description: string }[];
    agents?: { name: string; description: string }[];
    showAuthBadge?: boolean; // TODO: remove unused auth props after hero migration
    pendingPermission?: boolean;
    hasStash?: boolean;
    onBtwSend?: (question: string) => void;
    onRestoreStash?: () => void;
    onShortcutHelp?: () => void;
    userHistory?: string[];
    runId?: string;
    onValueChange?: (value: string) => void;
    contextWindow?: number;
    inputStore?: PromptInputStore;
  } = $props();

  // ── Store ──
  const store = inputStore ?? new PromptInputStore();

  // Sync permissionMode prop → store
  $effect(() => {
    store.permissionMode = permissionMode;
  });

  // ── BTW mode (side question) ──
  let btwMode = $state(false);

  // Auto-close BTW mode when agent stops running
  $effect(() => {
    if (!running) btwMode = false;
  });

  let effectivePlaceholder = $derived(
    btwMode
      ? "Ask a side question..."
      : pendingPermission
        ? t("prompt_pendingPermission")
        : hasRun
          ? t("prompt_hasRunPlaceholder")
          : t("prompt_newPlaceholder"),
  );

  // ── Git branch (fetched from cwd) ──
  const branchPoller = createGitBranchPoller(api.getGitBranch);
  let gitBranch = $state("");

  // Fetch on cwd / isRemote change
  $effect(() => {
    void cwd;
    void isRemote;
    const effectiveCwd = isRemote ? "" : cwd;
    branchPoller.refresh(effectiveCwd).then((b) => {
      gitBranch = b;
    });
  });

  // Poll every 10s to catch branch changes made by CLI commands
  $effect(() => {
    if (isRemote) return;
    const interval = setInterval(() => {
      branchPoller.refresh(cwd).then((b) => {
        gitBranch = b;
      });
    }, 10_000);
    return () => clearInterval(interval);
  });

  // ── Branch color (7 rainbow colors based on name hash) ──
  const BRANCH_COLORS = [
    { bg: "bg-red-500/15", text: "text-red-400" },
    { bg: "bg-orange-500/15", text: "text-orange-400" },
    { bg: "bg-yellow-500/15", text: "text-yellow-400" },
    { bg: "bg-green-500/15", text: "text-green-400" },
    { bg: "bg-miwarp-status-info/10", text: "text-miwarp-status-info" },
    { bg: "bg-indigo-500/15", text: "text-indigo-400" },
    { bg: "bg-purple-500/15", text: "text-purple-400" },
  ];

  function branchColor(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    return BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length];
  }

  let currentBranchColor = $derived(branchColor(gitBranch));

  // ── Permission mode selector ──
  const PERMISSION_MODES = [
    {
      value: "default",
      label: () => t("prompt_permAskLabel"),
      shortLabel: () => t("prompt_permAskShort"),
      description: () => t("prompt_permAskDesc"),
      cls: "text-foreground/70",
      dotCls: "bg-foreground/40",
      borderCls: "",
    },
    {
      value: "acceptEdits",
      label: () => t("prompt_permAutoReadLabel"),
      shortLabel: () => t("prompt_permAutoReadShort"),
      description: () => t("prompt_permAutoReadDesc"),
      cls: "text-miwarp-status-info",
      dotCls: "bg-blue-400",
      borderCls:
        "border-blue-400/40 focus-within:border-blue-400/60 focus-within:shadow-[0_0_0_1px_rgba(96,165,250,0.15)]",
    },
    {
      value: "bypassPermissions",
      label: () => t("prompt_permAutoAllLabel"),
      shortLabel: () => t("prompt_permAutoAllShort"),
      description: () => t("prompt_permAutoAllDesc"),
      cls: "text-miwarp-status-warning",
      dotCls: "bg-amber-500",
      borderCls:
        "border-amber-500/40 focus-within:border-amber-500/60 focus-within:shadow-[0_0_0_1px_rgba(245,158,11,0.15)]",
    },
    {
      value: "plan",
      label: () => t("prompt_permPlanLabel"),
      shortLabel: () => t("prompt_permPlanShort"),
      description: () => t("prompt_permPlanDesc"),
      cls: "text-purple-400",
      dotCls: "bg-purple-400",
      borderCls:
        "border-purple-400/40 focus-within:border-purple-400/60 focus-within:shadow-[0_0_0_1px_rgba(192,132,252,0.15)]",
    },
    {
      value: "auto",
      label: () => t("prompt_permAutoLabel"),
      shortLabel: () => t("prompt_permAutoShort"),
      description: () => t("prompt_permAutoDesc"),
      cls: "text-teal-400",
      dotCls: "bg-teal-400",
      borderCls:
        "border-teal-400/40 focus-within:border-teal-400/60 focus-within:shadow-[0_0_0_1px_rgba(45,212,191,0.15)]",
    },
    {
      value: "dontAsk",
      label: () => t("prompt_permDontAskLabel"),
      shortLabel: () => t("prompt_permDontAskShort"),
      description: () => t("prompt_permDontAskDesc"),
      cls: "text-red-400",
      dotCls: "bg-red-400",
      borderCls:
        "border-red-400/40 focus-within:border-red-400/60 focus-within:shadow-[0_0_0_1px_rgba(248,113,113,0.15)]",
    },
  ];

  let modeDropdownOpen = $state(false);
  let modeBtnEl: HTMLButtonElement | undefined = $state();
  let modeDropdownEl: HTMLDivElement | undefined = $state();
  let modeDropdownStyle = $state("");

  let currentMode = $derived(
    PERMISSION_MODES.find((m) => m.value === permissionMode) ?? PERMISSION_MODES[0],
  );

  // Store-provided reactive state (store.inputText, store.pendingAttachments, store.pastedBlocks, store.pendingPathRefs, store.textareaEl)

  let lastEscTime = 0;
  let histState: HistoryState = createHistoryState();

  $effect(() => {
    if (checkAndReset(histState, userHistory.length, runId)) {
      dbg("prompt-history", "reset", { runId, len: userHistory.length });
    }
  });

  // ── Composables ──
  const file = useFileHandling({
    store,
    disabled: () => disabled,
    contextWindow: () => contextWindow,
  });

  function closeModeDropdown() {
    modeDropdownOpen = false;
  }

  const slash = useSlashMenu({
    store,
    agent: () => agent,
    useStreamSession: () => useStreamSession,
    cliCommands: () => cliCommands,
    models: () => models,
    fastModeState: () => fastModeState,
    availableSkills: () => availableSkills,
    onModelSwitch,
    onFastModeSwitch,
    onVirtualCommand,
    onSend: (text: string) => {
      store.inputText = "";
      if (store.textareaEl) store.textareaEl.style.height = "auto";
      store.pendingAttachments = [];
      store.pastedBlocks = [];
      store.pendingPathRefs = [];
      resetHistory(histState);
      onSend(text, []);
    },
    closeAtMenu: (reason: string) => at.closeAtMenu(reason),
    closeModeDropdown,
  });

  const at = useAtMention({
    store,
    isRemote: () => isRemote,
    cwd: () => cwd,
    closeSlashMenu: (reason: string) => slash.closeSlashMenu(reason),
    closeModeDropdown,
  });

  function toggleModeDropdown() {
    if (modeDropdownOpen) {
      modeDropdownOpen = false;
      return;
    }
    if (slash.slashMenuOpen) slash.closeSlashMenu("mode-open");
    if (at.atMenuOpen) at.closeAtMenu("mode-open");

    modeDropdownOpen = true;
    if (modeBtnEl) {
      const rect = modeBtnEl.getBoundingClientRect();
      modeDropdownStyle = `position:fixed; bottom:${window.innerHeight - rect.top + 4}px; left:${rect.left}px; z-index:50;`;
    }
  }

  function selectMode(mode: string) {
    modeDropdownOpen = false;
    onPermissionModeChange?.(mode);
  }

  function handleInput() {
    autoResize();
    onValueChange?.(store.inputText);

    // Exit history mode if user edits the recalled text
    if (histState.index >= 0 && store.inputText !== userHistory[histState.index]) {
      dbg("prompt-history", "exit: user edited", { index: histState.index });
      resetHistory(histState);
    }

    // @-mention detection: runs BEFORE slashEnabled guard so it works pre-session
    const cursorPos = store.textareaEl?.selectionStart ?? store.inputText.length;
    at.handleAtInput(cursorPos);

    if (!slash.slashEnabled) {
      dbg("slash", "disabled", {
        agent,
        useStreamSession,
        sessionAlive,
        canResume,
        inputText: store.inputText,
      });
      return;
    }

    if (slash.slashPhase === "sub-model" || slash.slashPhase === "sub-fast") {
      // Close sub-view if input no longer matches /activeCmdName
      if (
        slash.activeSlashCmd &&
        !isSubViewInputValid(store.inputText, slash.activeSlashCmd.name)
      ) {
        slash.closeSlashMenu("sub-invalid-input");
      }
      return;
    }

    // Commands phase
    const match = store.inputText.match(/^\/([a-zA-Z0-9_-]*)$/);
    if (match) {
      if (!slash.slashMenuOpen) {
        dbg("slash", "open", { query: match[1] });
        if (modeDropdownOpen) modeDropdownOpen = false;
        slash.openSlashMenu();
      }
    } else if (slash.slashMenuOpen) {
      slash.closeSlashMenu("no-match");
    }
  }

  /** Apply a history action (shared by immediate and deferred paths). */
  function applyHistoryAction(action: NonNullable<HistoryAction>) {
    if (action.type === "boundary") {
      dbg("prompt-history", "boundary", { index: histState.index });
      return;
    }

    if (action.type === "enter") {
      histState.draft = getInputSnapshot();
      histState.index = action.index;
      dbg("prompt-history", "up: enter history", { index: 0, total: userHistory.length });
    } else if (action.type === "up") {
      histState.index = action.index;
      dbg("prompt-history", "up", { index: action.index });
    } else if (action.type === "down") {
      histState.index = action.index;
      dbg("prompt-history", "down", { index: action.index });
    } else if (action.type === "restore-draft") {
      histState.index = -1;
      if (histState.draft) {
        dbg("prompt-history", "restore-draft", {
          textLen: histState.draft.text.length,
          atts: histState.draft.attachments.length,
          pastes: histState.draft.pastedBlocks.length,
        });
        restoreSnapshot(histState.draft);
        histState.draft = null;
        return; // restoreSnapshot handles autoResize + focus
      }
      store.inputText = "";
      store.pendingAttachments = [];
      store.pastedBlocks = [];
    }

    if (action.type !== "restore-draft") {
      // Bounds guard: if index is stale (timeline changed between events), bail out
      if (histState.index >= userHistory.length) {
        dbg("prompt-history", "stale index, resetting", {
          index: histState.index,
          len: userHistory.length,
        });
        resetHistory(histState);
        return;
      }
      store.inputText = userHistory[histState.index];
      store.pendingAttachments = [];
      store.pastedBlocks = [];
    }

    requestAnimationFrame(() => {
      autoResize();
      if (store.textareaEl) {
        store.textareaEl.selectionStart = store.textareaEl.selectionEnd =
          store.textareaEl.value.length;
      }
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    // Skip during IME composition (e.g., Chinese input confirming with Enter)
    if (e.isComposing || e.keyCode === 229) return;

    // ── @-mention menu ──
    if (at.atMenuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        at.closeAtMenu("escape");
        return;
      }
      if (at.atResults.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          at.atSelectedIndex = Math.min(at.atSelectedIndex + 1, at.atResults.length - 1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          at.atSelectedIndex = Math.max(at.atSelectedIndex - 1, 0);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          at.selectAtEntry(at.atResults[at.atSelectedIndex]);
          return;
        }
      }
      // Let other keys through for typing
    }

    // ── Sub-model phase ──
    if (slash.slashMenuOpen && slash.slashPhase === "sub-model") {
      if (e.key === "Escape") {
        e.preventDefault();
        slash.goBackToCommands();
        return;
      }
      if (e.key === "Backspace") {
        if (
          shouldBackFromSubView(
            store.inputText,
            store.textareaEl?.selectionStart ?? 0,
            slash.activeSlashCmd?.name,
          )
        ) {
          e.preventDefault();
          slash.goBackToCommands();
          return;
        }
        // else: normal backspace (let it through)
        return;
      }
      if (models.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          slash.slashSubSelectedIndex = Math.min(
            slash.slashSubSelectedIndex + 1,
            models.length - 1,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          slash.slashSubSelectedIndex = Math.max(slash.slashSubSelectedIndex - 1, 0);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          slash.handleSubModelSelect(models[slash.slashSubSelectedIndex]);
          return;
        }
      }
      // Let other keys through for typing in sub-view
      return;
    }

    // ── Sub-fast phase ──
    if (slash.slashMenuOpen && slash.slashPhase === "sub-fast") {
      if (e.key === "Escape") {
        e.preventDefault();
        slash.goBackToCommands();
        return;
      }
      if (e.key === "Backspace") {
        if (
          shouldBackFromSubView(
            store.inputText,
            store.textareaEl?.selectionStart ?? 0,
            slash.activeSlashCmd?.name,
          )
        ) {
          e.preventDefault();
          slash.goBackToCommands();
          return;
        }
        return;
      }
      const FAST_OPTIONS = 2;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slash.slashSubSelectedIndex = Math.min(slash.slashSubSelectedIndex + 1, FAST_OPTIONS - 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slash.slashSubSelectedIndex = Math.max(slash.slashSubSelectedIndex - 1, 0);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        slash.handleFastModeSelect(slash.slashSubSelectedIndex === 0 ? "off" : "on");
        return;
      }
      return;
    }

    // ── Commands phase ──
    if (slash.slashMenuOpen && slash.slashPhase === "commands") {
      if (e.key === "Escape") {
        e.preventDefault();
        slash.closeSlashMenu("escape");
        return;
      }
      if (slash.effectiveCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          slash.slashSelectedIndex = Math.min(
            slash.slashSelectedIndex + 1,
            slash.effectiveCommands.length - 1,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          slash.slashSelectedIndex = Math.max(slash.slashSelectedIndex - 1, 0);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          slash.selectSlashCommand(slash.effectiveCommands[slash.slashSelectedIndex], "enter");
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          slash.selectSlashCommand(slash.effectiveCommands[slash.slashSelectedIndex], "tab");
          return;
        }
      }
      // No filteredCommands but menu open (empty state) — only Esc handled above
      return;
    }

    // ── Input history (Up/Down arrow) ──
    if (
      shouldIntercept(
        e.key,
        e,
        { atMenuOpen: at.atMenuOpen, slashMenuOpen: slash.slashMenuOpen, modeDropdownOpen },
        store.textareaEl?.selectionStart ?? 0,
        store.textareaEl?.selectionEnd ?? 0,
        userHistory.length,
      ) &&
      store.textareaEl
    ) {
      // Multi-line or visually wrapped text: defer to next frame to let the
      // browser move the cursor first. Only trigger history if cursor didn't
      // move (meaning we're at the visual top/bottom edge).
      if (hasMultipleVisualLines(store.textareaEl)) {
        const posBefore = store.textareaEl.selectionStart;
        const key = e.key;
        // Immediate path: cursor at absolute start (Up) or end (Down)
        // — guaranteed to be at the visual edge, no need to defer.
        const atAbsoluteEdge =
          (key === "ArrowUp" && posBefore === 0) ||
          (key === "ArrowDown" && posBefore === store.textareaEl.value.length);
        if (atAbsoluteEdge) {
          const action = getHistoryAction(
            key,
            histState,
            userHistory.length,
            store.textareaEl.value,
            posBefore,
          );
          if (action) {
            e.preventDefault();
            applyHistoryAction(action);
            return;
          }
        }
        // Let browser handle cursor movement, check on next frame
        requestAnimationFrame(() => {
          if (!store.textareaEl) return;
          if (store.textareaEl.selectionStart !== posBefore) return; // cursor moved — normal nav
          const action = getHistoryAction(
            key,
            histState,
            userHistory.length,
            store.textareaEl.value,
            store.textareaEl.selectionStart,
          );
          if (action) {
            applyHistoryAction(action);
          }
        });
        return;
      }

      // Single visual line: handle immediately
      const action = getHistoryAction(
        e.key,
        histState,
        userHistory.length,
        store.textareaEl.value,
        store.textareaEl.selectionStart,
      );
      if (action) {
        e.preventDefault();
        applyHistoryAction(action);
        return;
      }
    }

    // ── Double Esc: clear all input ──
    if (e.key === "Escape") {
      const now = Date.now();
      if (now - lastEscTime < 400 && hasContent()) {
        e.preventDefault();
        clearAll();
        lastEscTime = 0;
        return;
      }
      lastEscTime = now;
      return;
    }

    // ── ? shortcut help: when input is empty, forward to parent instead of typing "?" ──
    if (e.key === "?" && !hasContent() && onShortcutHelp) {
      e.preventDefault();
      onShortcutHelp();
      return;
    }

    // ── Normal input ──
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const typed = store.inputText.trim();

    // Virtual slash command check — based on raw textarea, not paste blocks
    if (typed) {
      const virtual = parseVirtualAction(typed);
      if (virtual) {
        dbg("slash", `virtual:${virtual.name}`, { args: virtual.args });
        if (virtual.name === "model" && virtual.args && onModelSwitch) {
          store.inputText = "";
          if (store.textareaEl) store.textareaEl.style.height = "auto";
          onModelSwitch(virtual.args);
          return; // store.pastedBlocks preserved
        }
        // Navigation virtual commands (e.g. /config → /settings?tab=cli-config)
        const vDef = VIRTUAL_COMMANDS.find((v) => v.name === virtual.name);
        if (vDef && typeof vDef["_navigate"] === "string") {
          store.inputText = "";
          if (store.textareaEl) store.textareaEl.style.height = "auto";
          goto(vDef["_navigate"] as string);
          return;
        }
        // Side question virtual command (/btw <question>)
        if (vDef && vDef["_action"] === "side-question" && onBtwSend) {
          if (virtual.args) {
            store.inputText = "";
            if (store.textareaEl) store.textareaEl.style.height = "auto";
            onBtwSend(virtual.args);
          }
          return;
        }
        // Action virtual commands (e.g. /copy → copy-last)
        if (vDef && typeof vDef["_action"] === "string" && onVirtualCommand) {
          store.inputText = "";
          if (store.textareaEl) store.textareaEl.style.height = "auto";
          onVirtualCommand(vDef["_action"] as string, virtual.args);
          return;
        }
      }
    }

    // Get attachments from file composable
    const { regularAtts, pathRefParts, pathRefAttParts } = file.getAttachmentsForSend();

    // Combine paste blocks + typed text + path-reference file paths
    const parts: string[] = store.pastedBlocks.map((b) => b.text);
    if (pathRefAttParts.length > 0) {
      parts.push(pathRefAttParts.join("\n"));
    }
    if (pathRefParts.length > 0) {
      parts.push(pathRefParts.join("\n"));
    }

    if (typed) parts.push(typed);
    const text = parts.join("\n\n");
    if (!text || disabled) return;

    dbg("prompt", "send", {
      len: text.length,
      pasteBlocks: store.pastedBlocks.length,
      attachments: regularAtts.length,
      pathRefs: pathRefAttParts.length,
      dragPathRefs: pathRefParts.length,
      agent,
    });

    const attachments: Attachment[] = regularAtts.map((a) => ({
      name: a.name,
      type: a.type,
      size: a.size,
      contentBase64: a.contentBase64,
    }));

    store.inputText = "";
    store.pendingAttachments = [];
    store.pastedBlocks = [];
    store.pendingPathRefs = [];
    resetHistory(histState);
    onSend(text, attachments);

    // Reset textarea height
    if (store.textareaEl) store.textareaEl.style.height = "auto";
  }

  function handleBtwSend() {
    const question = store.inputText.trim();
    if (!question || !onBtwSend) return;
    dbg("prompt", "btwSend", { len: question.length });
    store.inputText = "";
    if (store.textareaEl) store.textareaEl.style.height = "auto";
    onBtwSend(question);
  }

  function handleSkillSelect(skillName: string) {
    dbg("prompt", "skill-select fill", { skillName });
    store.inputText = `/${skillName} `;
    requestAnimationFrame(() => {
      autoResize();
      store.textareaEl?.focus();
    });
  }

  function autoResize() {
    if (!store.textareaEl) return;
    store.textareaEl.style.height = "auto";
    const maxHeight = 4 * 24; // ~4 lines
    store.textareaEl.style.height = Math.min(store.textareaEl.scrollHeight, maxHeight) + "px";
  }

  // ── Mode dropdown outside-click + Escape ──
  onMount(() => {
    function onDocClick(e: MouseEvent) {
      if (
        modeDropdownOpen &&
        modeBtnEl &&
        !modeBtnEl.contains(e.target as Node) &&
        modeDropdownEl &&
        !modeDropdownEl.contains(e.target as Node)
      ) {
        modeDropdownOpen = false;
      }
    }
    function onDocKeydown(e: KeyboardEvent) {
      if (modeDropdownOpen && e.key === "Escape") {
        modeDropdownOpen = false;
      }
    }
    document.addEventListener("mousedown", onDocClick, true);
    document.addEventListener("keydown", onDocKeydown);
    return () => {
      document.removeEventListener("mousedown", onDocClick, true);
      document.removeEventListener("keydown", onDocKeydown);
    };
  });

  export function focus() {
    store.textareaEl?.focus();
  }

  export function setValue(text: string) {
    store.inputText = text;
    requestAnimationFrame(() => {
      autoResize();
      store.textareaEl?.focus();
    });
  }

  export function appendText(text: string) {
    store.inputText = store.inputText ? store.inputText + "\n" + text : text;
    requestAnimationFrame(() => {
      autoResize();
      store.textareaEl?.focus();
    });
  }

  export function triggerSend() {
    handleSend();
  }

  export function addFiles(files: FileList | File[]) {
    return file.addFiles(files);
  }

  export function addPathRefs(refs: Array<{ path: string; name: string; isDir: boolean }>) {
    file.addPathRefs(refs);
  }

  export function showToast(message: string, variant: "error" | "info" = "info") {
    file.showToast(message, variant);
  }

  export function getInputSnapshot(): PromptInputSnapshot {
    return store.getSnapshot();
  }

  export function restoreSnapshot(snapshot: PromptInputSnapshot): void {
    store.restoreSnapshot(snapshot);
    resetHistory(histState);
    requestAnimationFrame(() => {
      autoResize();
      store.textareaEl?.focus();
    });
  }

  export function clearAll(): void {
    store.clearAll();
    resetHistory(histState);
    requestAnimationFrame(() => autoResize());
  }

  function hasContent(): boolean {
    return store.hasContent;
  }
</script>

<!-- Web drag handlers — only fire when Tauri dragDropEnabled is false (non-Tauri builds).
     When dragDropEnabled: true, Tauri intercepts OS drag events and Web drag events do not fire. -->
<div
  class="relative mx-auto w-full max-w-5xl px-4 py-0"
  ondragenter={file.handleDragEnter}
  ondragleave={file.handleDragLeave}
  ondragover={file.handleDragOver}
  ondrop={file.handleDrop}
>
  <!-- Drag overlay -->
  {#if file.dragActive}
    <div
      class="absolute inset-0 z-10 flex items-center justify-center rounded-[28px] border-2 border-dashed border-primary/40 bg-primary/6 backdrop-blur-[2px]"
    >
      <span class="text-sm font-medium text-primary/70">{t("prompt_dropFiles")}</span>
    </div>
  {/if}

  <!-- File toast -->
  {#if file.toastMessage}
    <div
      class="absolute -top-10 left-4 right-4 z-20 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs shadow-lg animate-fade-in {file.toastVariant ===
      'error'
        ? 'bg-destructive/90 text-destructive-foreground'
        : 'bg-muted text-foreground'}"
    >
      <svg
        class="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
      </svg>
      <span>{file.toastMessage}</span>
    </div>
  {/if}

  <!-- Attachment & paste block previews -->
  {#if store.pendingAttachments.length > 0 || store.pastedBlocks.length > 0 || store.pendingPathRefs.length > 0}
    <div class="mb-2 flex flex-wrap gap-1.5">
      {#each store.pendingAttachments as att (att.id)}
        <FileAttachment
          name={att.name}
          size={att.size}
          mimeType={att.type}
          isPathRef={!!att.filePath && !att.contentBase64}
          onremove={() => file.removeAttachment(att.id)}
        />
      {/each}
      {#each store.pendingPathRefs as ref (ref.id)}
        <FileAttachment
          name={ref.name}
          size={0}
          mimeType={ref.isDir ? "inode/directory" : "application/octet-stream"}
          isPathRef={true}
          onremove={() => file.removePathRef(ref.id)}
        />
      {/each}
      {#each store.pastedBlocks as block (block.id)}
        {@const isSpreadsheet = block.ext ? isSpreadsheetExt(block.ext) : false}
        <span
          class="inline-flex items-center gap-1.5 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 px-2 py-1 text-xs"
        >
          {#if isSpreadsheet}
            <!-- Table/spreadsheet icon -->
            <svg
              class="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" />
            </svg>
          {:else}
            <!-- Clipboard icon for text -->
            <svg
              class="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path
                d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
              />
            </svg>
          {/if}
          <span class="truncate max-w-[200px]">{block.preview}</span>
          <span class="text-miwarp-status-info dark:text-miwarp-status-info"
            >{formatPasteSize(block.lineCount, block.charCount)}</span
          >
          <button
            onclick={() => file.removePastedBlock(block.id)}
            class="ml-0.5 rounded p-0.5 transition-colors hover:bg-blue-200/50 dark:hover:bg-blue-800/50"
            title={t("prompt_removePaste")}
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <!-- L3: Quick action pills + git branch (above input container) -->
  {#if (slash.slashEnabled && slash.quickActions.length > 0) || gitBranch}
    <div class="flex items-center gap-1 px-2 pb-2">
      {#if slash.slashEnabled && slash.quickActions.length > 0}
        <div class="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {#each slash.quickActions as cmd (cmd.name)}
            <button
              class="shrink-0 rounded-md border border-border/50 px-2 py-0.5 text-[11px]
                bg-background/30 text-muted-foreground/70 hover:text-foreground hover:bg-accent/20
                hover:border-border transition-colors whitespace-nowrap"
              onclick={() => slash.handleQuickAction(cmd)}
              title={cmd.description}
            >
              {t(`quickAction_${cmd.name}` as MessageKey)}
            </button>
          {/each}
          <button
            class="shrink-0 rounded-md border border-border/50 px-2 py-0.5 text-[11px]
              bg-background/30 text-muted-foreground/70 hover:text-foreground hover:bg-accent/20
              hover:border-border transition-colors whitespace-nowrap"
            onclick={slash.openSlashMenuFromButton}
            title={t("quickAction_moreTitle")}
          >
            {t("quickAction_more")}
          </button>
        </div>
      {/if}
      {#if gitBranch}
        <div class="ml-auto shrink-0">
          <span
            class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium {currentBranchColor.bg} {currentBranchColor.text} max-w-[200px]"
            title={gitBranch}
          >
            <svg
              class="w-3 h-3 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span class="truncate">{gitBranch}</span>
          </span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Unified input container -->
  <div
    class="rounded-[28px] border bg-background/72 backdrop-blur-2xl transition-colors shadow-[0_4px_24px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.07)] {btwMode
      ? 'border-miwarp-status-info/80'
      : currentMode.borderCls || 'border-white/10 focus-within:border-white/20'} {pendingPermission
      ? 'motion-attention-pulse'
      : ''}"
  >
    {#if pendingPermission}
      <div
        role="status"
        aria-live="polite"
        class="flex items-center gap-2 px-4 pt-2.5 pb-0.5 text-xs text-miwarp-status-warning"
      >
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{t("prompt_pendingPermission")}</span>
      </div>
    {/if}

    <!-- Textarea -->
    <textarea
      bind:this={store.textareaEl}
      bind:value={store.inputText}
      onkeydown={handleKeydown}
      oninput={handleInput}
      onpaste={file.handlePaste}
      placeholder={effectivePlaceholder}
      rows={1}
      {disabled}
      class="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
      style="min-height: 36px;"
    ></textarea>

    {#if at.atMenuOpen}
      <AtMentionMenu
        entries={at.atResults}
        selectedIndex={at.atSelectedIndex}
        loading={at.atLoading}
        query={at.atQuery}
        anchorEl={store.textareaEl}
        onSelect={at.selectAtEntry}
        onHover={(i) => (at.atSelectedIndex = i)}
        onDismiss={() => at.closeAtMenu("click-outside")}
      />
    {/if}

    {#if slash.slashMenuOpen}
      <SlashMenu
        commands={slash.filteredCommands}
        slashGroups={slash.slashGroups}
        selectedIndex={slash.slashSelectedIndex}
        anchorEl={store.textareaEl}
        triggerEl={slash.slashBtnEl}
        phase={slash.slashPhase}
        {models}
        {currentModel}
        subSelectedIndex={slash.slashSubSelectedIndex}
        hintText={slash.hintText}
        inputDisplay={store.inputText}
        {fastModeState}
        onSelect={(cmd) => slash.selectSlashCommand(cmd, "enter")}
        onHover={(i) => (slash.slashSelectedIndex = i)}
        onSubHover={(i) => (slash.slashSubSelectedIndex = i)}
        onSubSelect={slash.handleSubModelSelect}
        onFastSelect={slash.handleFastModeSelect}
        onBack={slash.goBackToCommands}
        onDismiss={() => slash.closeSlashMenu("click-outside")}
      />
    {/if}

    <!-- Bottom action bar -->
    <div class="flex items-center justify-between px-3 pb-3">
      <!-- Left: agent selector + permission mode -->
      <div class="flex items-center gap-1">
        {#if !hasRun && onAgentChange}
          <AgentSelector value={agent} onchange={(a) => onAgentChange?.(a)} />
        {/if}
        {#if onPermissionModeChange}
          <button
            bind:this={modeBtnEl}
            class="flex items-center gap-1 rounded-full border border-transparent px-1.5 py-0.5 text-[11px] font-medium transition-colors {currentMode.cls} hover:border-border/40 hover:bg-accent/15"
            onclick={toggleModeDropdown}
            title={t("prompt_permissionModeTitle", { mode: currentMode.label() })}
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
              />
            </svg>
            {currentMode.shortLabel()}
            <svg
              class="h-2.5 w-2.5 text-foreground/30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="m6 9 6 6 6-6" /></svg
            >
          </button>
        {:else if !hasRun}
          <div class="w-1"></div>
        {/if}
        <button
          class="flex items-center gap-1 rounded-full border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border/40 hover:bg-accent/15 hover:text-foreground"
          onclick={() => window.dispatchEvent(new CustomEvent("ocv:open-permissions"))}
          title={t("permissions_title")}
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {t("permissions_rules")}
        </button>
        {#if showAuthBadge && !hasRun}
          <AuthSourceBadge
            {authOverview}
            {authSourceLabel}
            {authSourceCategory}
            {apiKeySource}
            {hasRun}
            {authMode}
            {platformCredentials}
            {platformId}
            {onAuthModeChange}
            {onPlatformChange}
            {localProxyStatuses}
          />
        {/if}
        <SkillSelector
          skills={skillItems}
          {agents}
          disabled={disabled || running}
          onSelect={handleSkillSelect}
        />
        {#if hasStash && onRestoreStash}
          <button
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 transition-colors"
            title={t("prompt_stashRestore")}
            onclick={onRestoreStash}
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
            </svg>
            {t("prompt_stashBadge")}
          </button>
        {/if}
      </div>

      <!-- Right: actions -->
      <div class="flex items-center gap-0.5">
        {#if file.showTokenEstimate}
          <span
            class="text-[10px] tabular-nums px-1.5 shrink-0 {file.tokenWarning
              ? 'text-miwarp-status-warning'
              : 'text-muted-foreground/50'}"
            title={contextWindow > 0
              ? t("prompt_tokenPercent", { pct: String(file.tokenPercent) })
              : ""}
          >
            {t("prompt_tokenEstimate", { tokens: String(file.tokenEstimate) })}
            {#if contextWindow > 0}<span class="ml-0.5"
                >{t("prompt_tokenPercent", { pct: String(file.tokenPercent) })}</span
              >{/if}
            {#if file.tokenWarning}<span class="ml-0.5" title={t("prompt_tokenWarning")}>⚠</span
              >{/if}
          </span>
        {/if}
        {#if slash.slashEnabled}
          <button
            bind:this={slash.slashBtnEl}
            class="flex h-7 w-7 items-center justify-center rounded-full
              text-muted-foreground/60 hover:text-foreground hover:bg-accent/15 transition-colors"
            onclick={slash.openSlashMenuFromButton}
            title={t("prompt_slashCommands")}
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M17 3 7 21" />
            </svg>
          </button>
        {/if}
        <input
          bind:this={file.fileInput}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.rs,.svelte,.html,.css,.yaml,.yml,.toml,.xml,.sh,.sql,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.csv,.log,.docx,.xlsx"
          class="hidden"
          onchange={file.handleFileSelect}
        />
        <button
          class="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-accent/15 transition-colors disabled:opacity-30"
          onclick={() => file.fileInput?.click()}
          disabled={store.pendingAttachments.length >= 8}
          title={t("prompt_attachFiles")}
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
            />
          </svg>
        </button>
        {#if IS_MAC}
          <!-- Screenshot capture button (macOS only) -->
          <button
            class="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-accent/15 transition-colors disabled:opacity-30"
            onclick={() => api.captureScreenshot()}
            disabled={store.pendingAttachments.length >= 8}
            title={t("prompt_screenshot")}
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
              />
              <circle cx="12" cy="13" r="3" />
            </svg>
          </button>
        {/if}

        {#if running && onInterrupt}
          {#if file.canSend}
            {#if btwMode}
              <!-- BTW send: blue theme -->
              <button
                class="flex h-7 w-7 items-center justify-center rounded-full bg-miwarp-status-info text-white transition-colors hover:opacity-80"
                onclick={handleBtwSend}
                title={t("promptInput_sendSideQuestion")}
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            {:else}
              <!-- Mid-turn send: allow injecting a message while agent is running -->
              <button
                class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
                onclick={handleSend}
                title={t("prompt_send")}
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            {/if}
          {/if}
          <!-- BTW toggle button (only during running) -->
          {#if onBtwSend}
            <button
              onclick={() => (btwMode = !btwMode)}
              title={t("promptInput_sideQuestion")}
              class="flex h-7 w-7 items-center justify-center rounded-full transition-colors {btwMode
                ? 'text-miwarp-status-info bg-miwarp-status-info/10'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/15'}"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
              </svg>
            </button>
          {/if}
          <button
            class="flex h-7 w-7 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
            onclick={onInterrupt}
            title={t("prompt_stop")}
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        {:else}
          <button
            class="flex h-7 w-7 items-center justify-center rounded-full transition-colors {file.canSend
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'text-muted-foreground/40'}"
            onclick={handleSend}
            disabled={!file.canSend}
            title={t("prompt_send")}
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        {/if}
      </div>
    </div>
  </div>

  {#if modeDropdownOpen}
    <div
      bind:this={modeDropdownEl}
      class="min-w-[220px] w-max rounded-2xl border border-border/35 bg-background/86 backdrop-blur-xl animate-fade-in"
      style={modeDropdownStyle}
    >
      <div class="p-1">
        {#each PERMISSION_MODES as mode}
          <button
            class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs transition-colors hover:bg-accent/20
              {permissionMode === mode.value ? 'bg-accent/20 font-medium' : ''}"
            onclick={() => selectMode(mode.value)}
          >
            {#if permissionMode === mode.value}
              <svg
                class="h-3 w-3 text-primary shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><path d="M20 6 9 17l-5-5" /></svg
              >
            {:else}
              <span class="w-3 shrink-0"></span>
            {/if}
            <span class="shrink-0 {mode.cls}">{mode.label()}</span>
            <span class="flex-1 min-w-0 text-[10px] text-foreground/50 truncate"
              >{mode.description()}</span
            >
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
