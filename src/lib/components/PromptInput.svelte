<script lang="ts">
  import { goto } from "$app/navigation";
  import { slide } from "svelte/transition";
  import { untrack } from "svelte";
  import { getTransport } from "$lib/transport";
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
  import FileAttachment from "./FileAttachment.svelte";
  import SlashMenu from "./SlashMenu.svelte";
  import AtMentionMenu from "./AtMentionMenu.svelte";
  import {
    filterSlashCommands,
    mergeWithVirtual,
    parseVirtualAction,
    getCommandInteraction,
    getArgumentHint,
    shouldBackFromSubView,
    isSubViewInputValid,
    getQuickActions,
    classifyCloseReason,
    groupSlashCommands,
    VIRTUAL_COMMANDS,
  } from "$lib/utils/slash-commands";
  import type { SlashCommandGroups } from "$lib/utils/slash-commands";
  import type { MessageKey } from "$lib/i18n/types";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import { shouldShowContextDetails } from "$lib/utils/process-visibility";
  import { IS_MAC } from "$lib/utils/platform";
  import { t } from "$lib/i18n/index.svelte";
  import { showToast } from "$lib/stores/toast-store.svelte";
  import { formatPasteSize } from "$lib/utils/format";
  import {
    BINARY_ATTACHMENT_TYPES,
    MAX_ATTACHMENTS,
    MAX_PASTE_BLOCKS,
    PDF_MAX_BINARY_SIZE,
    PDF_MAX_PATH_SIZE,
    isTextFile,
    isPdf,
    isConvertibleFile,
    isConvertibleByExt,
    isSpreadsheetExt,
    getFileExtension,
    classifyByMime,
    getFileSizeLimit,
    getSizeLimitByMime,
  } from "$lib/utils/file-types";
  import { convertFile } from "$lib/utils/file-convert";
  import { uuid } from "$lib/utils/uuid";
  import type { ClipboardFileInfo } from "$lib/api";
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
  import { misencodedNavigationDirection, moveTextareaCaret } from "$lib/utils/prompt-text";
  import Icon from "$lib/components/Icon.svelte";
  import PermissionModePicker from "$lib/components/PermissionModePicker.svelte";

  const PRIVATE_USE_KEYBOARD_MIN = 0xf700;
  const PRIVATE_USE_KEYBOARD_MAX = 0xf8ff;

  function isPrivateUseKeyboardChar(ch: string): boolean {
    if (!ch) return false;
    const cp = ch.codePointAt(0)!;
    return cp >= PRIVATE_USE_KEYBOARD_MIN && cp <= PRIVATE_USE_KEYBOARD_MAX;
  }

  function isStrippedKeyboardChar(ch: string): boolean {
    if (ch === "\n" || ch === "\t") return false;
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20) return true;
    if (cp >= 0x7f && cp <= 0x9f) return true;
    if (cp >= PRIVATE_USE_KEYBOARD_MIN && cp <= PRIVATE_USE_KEYBOARD_MAX) return true;
    return false;
  }

  function formatCodePoints(text: string): string[] {
    const out: string[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      out.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
    }
    return out;
  }

  function hasAnsiArrowEscape(text: string): boolean {
    // eslint-disable-next-line no-control-regex
    return /\x1b\[[ABCD]/.test(text);
  }

  function hasKeyboardControlChars(text: string): boolean {
    if (hasAnsiArrowEscape(text)) return true;
    for (const ch of text) {
      if (isStrippedKeyboardChar(ch)) return true;
    }
    return false;
  }

  function mapIndexAfterStrip(raw: string, index: number): number {
    let cleanPos = 0;
    let i = 0;
    while (i < raw.length && i < index) {
      if (
        raw.charCodeAt(i) === 0x1b &&
        i + 2 < raw.length &&
        raw[i + 1] === "[" &&
        "ABCD".includes(raw[i + 2])
      ) {
        i += 3;
        continue;
      }
      const cp = raw.codePointAt(i)!;
      const chLen = cp > 0xffff ? 2 : 1;
      const ch = raw.slice(i, i + chLen);
      if (!isStrippedKeyboardChar(ch)) cleanPos += chLen;
      i += chLen;
    }
    return cleanPos;
  }

  function stripKeyboardControlChars(text: string): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
      if (
        text.charCodeAt(i) === 0x1b &&
        i + 2 < text.length &&
        text[i + 1] === "[" &&
        "ABCD".includes(text[i + 2])
      ) {
        i += 3;
        continue;
      }
      const cp = text.codePointAt(i)!;
      const chLen = cp > 0xffff ? 2 : 1;
      const ch = text.slice(i, i + chLen);
      if (!isStrippedKeyboardChar(ch)) out += ch;
      i += chLen;
    }
    return out;
  }

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
    // v1.0.9: when true, a send is in flight; the prompt must not accept another send.
    busy = false,
    onSend,
    onAgentChange,
    onInterrupt,
    onModelSwitch,
    onPermissionModeChange,
    showPermissionModeButton = true,
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
    processVisibility = "developer" as ProcessVisibility,
    inputStore,
    placeholder = "",
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
    /**
     * v1.0.9: returning a Promise lets the parent (use-send-message) signal
     * accepted vs. failed. The PromptInput retains the draft until the
     * Promise resolves; on rejection the draft is restored.
     */
    onSend: (text: string, attachments: Attachment[]) => Promise<void> | void;
    /** v1.0.9: when true, the input rejects another send (double-submit guard). */
    busy?: boolean;
    onAgentChange?: (agent: string) => void;
    onInterrupt?: () => void;
    onModelSwitch?: (model: string) => void;
    onPermissionModeChange?: (mode: string) => void;
    /** When false, hide the permission mode picker (e.g. pages without permission API). */
    showPermissionModeButton?: boolean;
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
    showAuthBadge?: boolean;
    pendingPermission?: boolean;
    hasStash?: boolean;
    onBtwSend?: (question: string) => void;
    onRestoreStash?: () => void;
    onShortcutHelp?: () => void;
    userHistory?: string[];
    runId?: string;
    onValueChange?: (value: string) => void;
    contextWindow?: number;
    processVisibility?: ProcessVisibility;
    inputStore?: PromptInputStore;
    placeholder?: string;
  } = $props();

  // ── Store ──
  const store = $derived(inputStore ?? new PromptInputStore());

  // Sync permissionMode prop → store
  $effect(() => {
    store.permissionMode = permissionMode;
  });

  // ── IME composition guard ──
  // Track whether the user is in the middle of IME composition (e.g. Chinese
  // pinyin). During composition, suppress auto-resize and capsule collapse to
  // prevent layout shifts that would commit the partial composition and break
  // the IME popup.
  let isComposing = $state(false);

  // ── BTW mode (side question) ──
  let btwMode = $state(false);

  /** Single-line capsule strip vs stacked multi-line composer. */
  let capsuleExpanded = $state(false);
  /** Delayed layout flag — lags behind `capsuleExpanded` by one CSS-transition
   *  duration so the flex-direction flip (row↔column, which is discrete and
   *  cannot be animated) happens AFTER the height + border-radius morph has
   *  settled.  This makes the capsule→rectangle expansion feel like a single
   *  unified animation instead of a two-stage "grow then rearrange". */
  let layoutExpanded = $state(false);
  let _layoutTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Current textarea height in px. Bound inline on the single unified
   * <textarea> below so the CSS `transition-[height]` animates the resize
   * instead of jumping. Updated by `autoResize()` after measuring scrollHeight.
   * Seeded to a single-line capsule value so the initial render doesn't
   * flicker.
   */
  let textareaHeightPx = $state(24);
  const CAPSULE_LINE_HEIGHT_PX = 24;
  /** Hysteresis thresholds: expand at a higher value, collapse at a lower one.
   *  This prevents the capsule ↔ expanded flip-flop loop when the measured
   *  scrollHeight oscillates near the boundary during CSS transitions. */
  const CAPSULE_EXPAND_THRESHOLD_PX = 34;
  const CAPSULE_COLLAPSE_THRESHOLD_PX = 28;
  /** Minimum time between consecutive state flips. After a capsule↔multi-line
   *  change we hold the new state for this long so the next autoResize
   *  measures against the *settled* width and padding (otherwise the width
   *  difference between the two states can keep contentH straddling the
   *  hysteresis band and cause a flip-flop). 300ms > 260ms CSS transition
   *  to cover the full visual settle. */
  const STATE_SETTLE_MS = 300;
  /** Timestamp of the last accepted state change, used by the settle window. */
  let _lastStateChangeMs = 0;
  const useCapsuleStrip = $derived(!layoutExpanded && !pendingPermission);

  // ── v1.0.x cycle diagnostics ─────────────────────────────────────────
  // Set `__CYCLE_DEBUG = true` to enable verbose logging. The log line is
  // mirrored to the Rust stdout via the `log_debug_event` Tauri command
  // (so the orchestrating Claude session can tail it) AND echoed to the
  // browser DevTools console (for human inspection). Filter the tauri dev
  // output with `grep '\[prompt-db\]'` to follow along. **Disable before
  // committing** — this fires on every keypress and rAF tick.
  const __CYCLE_DEBUG = false;
  let __dbFrame = 0;
  function __dbg(tag: string, data: Record<string, unknown>) {
    if (!__CYCLE_DEBUG) return;
    const frame = ++__dbFrame;
    const t = performance.now().toFixed(1);
    const line = `#${frame} t=${t}ms ${JSON.stringify(data)}`;
    // eslint-disable-next-line no-console
    console.log(`[prompt-db] ${tag} ${line}`);
    // Fire-and-forget forward to Rust stdout. We don't await — the Svelte
    // reactive call stack shouldn't block on IPC for diagnostic-only
    // telemetry. The Rust side uses `log::info!` which is non-blocking.
    void getTransport()
      .invoke("log_debug_event", { tag, payload: line })
      .catch(() => {
        // swallow — the IPC pipe is best-effort; the browser console still
        // has the line.
      });
  }

  $effect(() => {
    // Track `useCapsuleStrip` so the textarea re-measures when we flip
    // capsule ↔ multi-line. But untrack the side-effect call itself —
    // `autoResize` writes back to `capsuleExpanded` and `textareaHeightPx`,
    // which Svelte would otherwise flag as "effect writes to its own dep"
    // and warn, and in pathological cases the rAF round-trip could re-trigger
    // the effect each frame.
    const _layout = useCapsuleStrip;
    void _layout;
    __dbg("effect:useCapsuleStrip", {
      capsuleExpanded,
      pendingPermission,
      useCapsuleStrip,
      text: store.inputText.length,
    });
    untrack(() => {
      if (!isComposing) scheduleAutoResize();
    });
  });

  // ── v1.0.9: collapse the multi-line composer back to a capsule when the
  //  textarea is blanked (after send, after a virtual slash command, etc.).
  //  The capsule → multi-line transition is driven by autoResize via input
  //  events; the reverse is normally triggered by the same code path, but
  //  programmatic clears (handleSend, /btw, /model) don't fire input events,
  //  so we watch the text length here as a safety net. We compare prev/cur
  //  to avoid collapsing on initial mount or while the user is typing.
  //  Note: we deliberately do NOT gate on `!isComposing` — IME composition
  //  ending with an empty buffer (e.g. user backspaces through preedit) should
  //  still collapse the capsule, and blocking it here caused a stuck-expanded
  //  state when Send fired while an IME was open.
  let _prevInputLen = 0;
  $effect(() => {
    const len = store.inputText.length;
    const wasNonEmpty = _prevInputLen > 0;
    const isEmpty = len === 0;
    _prevInputLen = len;
    if (wasNonEmpty && isEmpty && capsuleExpanded && !pendingPermission) {
      untrack(() => {
        resetCapsuleLayout();
      });
    }
  });

  /**
   * Force the multi-line composer back to the single-line capsule shape.
   *
   * Called whenever the textarea is programmatically cleared (send, virtual
   * slash commands, /btw) — `input` events don't fire in those paths so the
   * text-watcher above can race. Centralising the reset here also ensures the
   * collapse happens *synchronously* with the clear, not on the next reactive
   * tick, so the user sees the capsule shrink right as the text disappears.
   */
  function resetCapsuleLayout() {
    if (!capsuleExpanded && !pendingPermission) return;
    capsuleExpanded = false;
    // Cancel any pending layout-delay timer and snap layout to collapsed
    // immediately — the user expects the pill shape right away on send/clear.
    if (_layoutTimer) { clearTimeout(_layoutTimer); _layoutTimer = null; }
    layoutExpanded = false;
    scheduleAutoResize();
  }

  // Auto-close BTW mode when agent stops running
  $effect(() => {
    if (!running) btwMode = false;
  });

  let effectivePlaceholder = $derived(
    btwMode
      ? t("promptInput_sideQuestionPlaceholder")
      : pendingPermission
        ? t("prompt_pendingPermission")
        : hasRun
          ? t("prompt_hasRunPlaceholder")
          : placeholder || t("prompt_newPlaceholder"),
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
      if (document.visibilityState !== "visible") return;
      branchPoller.refresh(cwd).then((b) => {
        gitBranch = b;
      });
    }, 10_000);
    return () => clearInterval(interval);
  });

  // ── Branch color (7 rainbow colors based on name hash) ──
  const BRANCH_COLORS = [
    { bg: "bg-miwarp-status-error/15", text: "text-miwarp-status-error" },
    { bg: "bg-miwarp-status-warning/15", text: "text-miwarp-status-warning" },
    { bg: "bg-miwarp-status-success/15", text: "text-miwarp-status-success" },
    { bg: "bg-miwarp-status-info/15", text: "text-miwarp-status-info" },
    { bg: "bg-miwarp-accent-primary/15", text: "text-miwarp-accent-primary" },
    { bg: "bg-miwarp-accent-violet/15", text: "text-miwarp-accent-violet" },
    { bg: "bg-miwarp-accent-blue/15", text: "text-miwarp-accent-blue" },
  ];

  function branchColor(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    return BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length];
  }

  let currentBranchColor = $derived(branchColor(gitBranch));

  // Store-provided reactive state (store.inputText, store.pendingAttachments, store.pastedBlocks, store.pendingPathRefs, store.textareaEl)

  let fileInput: HTMLInputElement | undefined = $state();
  let lastEscTime = 0;
  let histState: HistoryState = createHistoryState();

  $effect(() => {
    if (checkAndReset(histState, userHistory.length, runId)) {
      dbg("prompt-history", "reset", { runId, len: userHistory.length });
    }
  });

  /** Chunked ArrayBuffer→base64 (32KB chunks — safe for large files, avoids stack overflow). */
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
      binary += String.fromCharCode.apply(null, slice as unknown as number[]);
    }
    return btoa(binary);
  }

  // ── Slash menu state ──
  let slashMenuOpen = $state(false);
  let slashSelectedIndex = $state(0);
  let slashPhase: "commands" | "sub-model" | "sub-fast" = $state("commands");
  let slashSubSelectedIndex = $state(0);
  let activeSlashCmd: CliCommand | null = $state(null);

  // v1.0.6 / 3.10 (A3): slash menu is keyed off agent alone. The previous
  // `useStreamSession` guard meant the menu stayed dark until the user
  // started a session, even though CLI commands are static + global.
  let slashEnabled = $derived(agent === "claude");
  let slashBtnEl: HTMLButtonElement | undefined = $state();
  let savedInputForSlash = $state("");

  let allCommands = $derived(mergeWithVirtual(cliCommands ?? []));
  let quickActions = $derived(getQuickActions(allCommands));
  let skillNameSet = $derived(new Set(availableSkills));

  let slashQuery = $derived.by(() => {
    if (!slashMenuOpen || slashPhase !== "commands") return null;
    // v1.0.6 / 4.4: accept the Chinese pause mark (、) as an alias for
    // `/` so Chinese users can use the same muscle memory.
    const m = store.inputText.match(/^[/、]([a-zA-Z0-9_-]*)$/);
    return m?.[1] ?? "";
  });

  let filteredCommands = $derived.by(() => {
    if (slashQuery === null) return [];
    return filterSlashCommands(allCommands, slashQuery);
  });

  let slashGroups = $derived.by((): SlashCommandGroups | null => {
    if (slashQuery !== "") return null; // non-empty query or menu closed → flat mode
    if (filteredCommands.length === 0) return null;
    return groupSlashCommands(filteredCommands, skillNameSet);
  });

  let effectiveCommands = $derived(slashGroups ? slashGroups.flatOrder : filteredCommands);

  let hintText = $derived.by(() => {
    if (slashPhase !== "commands" || effectiveCommands.length === 0) return "";
    const idx = Math.min(slashSelectedIndex, effectiveCommands.length - 1);
    return getArgumentHint(effectiveCommands[idx]);
  });

  $effect(() => {
    if (slashMenuOpen)
      dbg("slash", slashGroups ? "grouped" : "flat", { count: effectiveCommands.length });
  });

  // ── @-mention state ──
  let atMenuOpen = $state(false);
  let atQuery = $state("");
  let atResults = $state<DirEntry[]>([]);
  let atSelectedIndex = $state(0);
  let atLoading = $state(false);
  /** Position in store.inputText where the `@` trigger starts. */
  let atStartPos = $state(-1);
  let atDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function closeAtMenu(reason: string) {
    if (!atMenuOpen) return;
    dbg("at-mention", `close:${reason}`);
    atMenuOpen = false;
    atQuery = "";
    atResults = [];
    atSelectedIndex = 0;
    atStartPos = -1;
    atLoading = false;
    if (atDebounceTimer) {
      clearTimeout(atDebounceTimer);
      atDebounceTimer = null;
    }
  }

  function openAtMenu(pos: number) {
    // Audit #6: disable @ completion in remote mode (local listDirectory not applicable)
    if (isRemote) return;
    if (slashMenuOpen) closeSlashMenu("at-open");
    atMenuOpen = true;
    atStartPos = pos;
    atQuery = "";
    atResults = [];
    atSelectedIndex = 0;
    dbg("at-mention", "open", { pos });
  }

  function resolveAtPath(query: string): string {
    // Resolve relative query against cwd to get absolute path for listDirectory
    if (!query) return cwd;
    if (query.startsWith("/")) return query;
    const base = cwd.endsWith("/") ? cwd : cwd + "/";
    return base + query;
  }

  async function fetchAtResults(query: string) {
    atLoading = true;
    try {
      // Split into directory path + filename prefix
      const lastSlash = query.lastIndexOf("/");
      let dirQuery: string;
      let prefix: string;
      if (lastSlash >= 0) {
        dirQuery = query.slice(0, lastSlash + 1);
        prefix = query.slice(lastSlash + 1).toLowerCase();
      } else {
        dirQuery = "";
        prefix = query.toLowerCase();
      }
      const absPath = resolveAtPath(dirQuery);
      dbg("at-mention", "fetch", { absPath, prefix });
      const listing = await api.listDirectory(absPath, true);
      // Filter by prefix and limit to 10
      const filtered = listing.entries
        .filter((e) => e.name.toLowerCase().startsWith(prefix))
        .slice(0, 10);
      atResults = filtered;
      atSelectedIndex = 0;
    } catch (e) {
      dbg("at-mention", "fetch error", e);
      atResults = [];
    } finally {
      atLoading = false;
    }
  }

  function handleAtInput(cursorPos: number) {
    // Scan backwards from cursor for nearest @ preceded by whitespace or at position 0
    let atPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = store.inputText[i];
      if (ch === "@") {
        // Valid if at start or preceded by whitespace
        if (i === 0 || /\s/.test(store.inputText[i - 1])) {
          atPos = i;
        }
        break;
      }
      if (/\s/.test(ch)) break; // whitespace before finding @ means no active @-mention
    }

    if (atPos >= 0) {
      const query = store.inputText.slice(atPos + 1, cursorPos);
      if (!atMenuOpen) openAtMenu(atPos);
      atQuery = query;

      // Debounce directory listing
      if (atDebounceTimer) clearTimeout(atDebounceTimer);
      atDebounceTimer = setTimeout(() => {
        fetchAtResults(query);
      }, 150);
    } else if (atMenuOpen) {
      closeAtMenu("no-at");
    }
  }

  function selectAtEntry(entry: DirEntry) {
    if (atStartPos < 0 || !store.textareaEl) return;
    const cursorPos = store.textareaEl.selectionStart ?? store.inputText.length;
    const prefix = store.inputText.slice(0, atStartPos + 1); // keeps the @
    const suffix = store.inputText.slice(cursorPos);

    // Build the path relative to what was already typed
    const lastSlash = atQuery.lastIndexOf("/");
    const dirPrefix = lastSlash >= 0 ? atQuery.slice(0, lastSlash + 1) : "";
    const relativePath = dirPrefix + entry.name;

    if (entry.is_dir) {
      // Append / and keep menu open for deeper navigation
      store.inputText = prefix + relativePath + "/" + suffix;
      requestAnimationFrame(() => {
        if (store.textareaEl) {
          const newPos = atStartPos + 1 + relativePath.length + 1;
          store.textareaEl.selectionStart = store.textareaEl.selectionEnd = newPos;
          store.textareaEl.focus();
        }
        // Trigger new fetch for subdirectory contents
        handleAtInput(atStartPos + 1 + relativePath.length + 1);
      });
    } else {
      // Insert file path and close menu
      store.inputText = prefix + relativePath + suffix;
      closeAtMenu("select");
      requestAnimationFrame(() => {
        if (store.textareaEl) {
          const newPos = atStartPos + 1 + relativePath.length;
          store.textareaEl.selectionStart = store.textareaEl.selectionEnd = newPos;
          store.textareaEl.focus();
        }
      });
    }
    dbg("at-mention", "select", { name: entry.name, isDir: entry.is_dir });
  }

  // Force close when conditions no longer met
  $effect(() => {
    if (!slashEnabled && slashMenuOpen) {
      closeSlashMenu("disabled");
    }
  });

  /** Restore saved input text and clear the saved value to prevent stale restores. */
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
          handleSend();
        } else {
          // Tab: fill only, don't execute
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
          slashSubSelectedIndex = fastModeState === "on" ? 1 : 0;
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
    closeSlashMenu("sub-select"); // clears savedInputForSlash
    store.inputText = restoreText; // restore user draft
    if (store.textareaEl) store.textareaEl.style.height = "auto";
    onModelSwitch?.(model.value);
  }

  function handleFastModeSelect(mode: "on" | "off") {
    dbg("slash", "fast-select", { mode });
    const restoreText = savedInputForSlash;
    closeSlashMenu("sub-select");
    store.inputText = restoreText;
    if (store.textareaEl) store.textareaEl.style.height = "auto";
    onFastModeSwitch?.(mode);
  }

  function moveCursorToEnd() {
    requestAnimationFrame(() => {
      if (store.textareaEl) {
        store.textareaEl.selectionStart = store.textareaEl.selectionEnd = store.inputText.length;
        store.textareaEl.focus();
      }
    });
  }

  /** Open slash menu from the L2 button or "More..." pill. */
  function openSlashMenuFromButton() {
    if (!slashEnabled) return;
    if (slashMenuOpen) {
      closeSlashMenu("button-toggle");
      return;
    }
    if (atMenuOpen) closeAtMenu("slash-button");

    savedInputForSlash = store.inputText;
    store.inputText = "/";
    slashMenuOpen = true;
    slashPhase = "commands";
    slashSelectedIndex = 0;
    moveCursorToEnd();
    dbg("slash", "open:button", { saved: savedInputForSlash.length });
  }

  /** Handle L3 quick-action pill click. Three branches: enum, free-text, immediate. */
  function handleQuickAction(cmd: CliCommand) {
    if (!slashEnabled) return;
    dbg("slash", "quick-action", { name: cmd.name });
    const interaction = getCommandInteraction(cmd);

    if (interaction === "enum") {
      // e.g., model/fast: close other menus → save input → open sub-view
      if (atMenuOpen) closeAtMenu("quick-action");
      savedInputForSlash = store.inputText;
      store.inputText = `/${cmd.name} `;
      activeSlashCmd = cmd;
      if (cmd.name === "fast") {
        slashPhase = "sub-fast";
        slashSubSelectedIndex = fastModeState === "on" ? 1 : 0;
      } else {
        slashPhase = "sub-model";
        slashSubSelectedIndex = 0;
      }
      slashMenuOpen = true;
      moveCursorToEnd();
      return;
    }

    if (interaction === "free-text") {
      // Fill "/cmd " and focus — don't send, don't clear draft
      if (atMenuOpen) closeAtMenu("quick-action");
      store.inputText = `/${cmd.name} `;
      moveCursorToEnd();
      return;
    }

    // immediate: execute directly without touching store.inputText/store.pastedBlocks/attachments
    const vDef = VIRTUAL_COMMANDS.find((v) => v.name === cmd.name);
    if (vDef) {
      if (typeof vDef["_action"] === "string" && onVirtualCommand) {
        onVirtualCommand(vDef["_action"] as string, "");
        return;
      }
      if (typeof vDef["_navigate"] === "string") {
        goto(vDef["_navigate"] as string);
        return;
      }
    }
    // Regular CLI command: send "/cmd" directly without draft/attachments
    onSend(`/${cmd.name}`, []);
  }

  function handleBeforeInput(e: InputEvent) {
    if (e.isComposing) return;
    const data = e.data;
    if (data == null || data === "") return;

    const codePoints = formatCodePoints(data);
    const privateUse = codePoints.filter((cp) => {
      const n = Number.parseInt(cp.slice(2), 16);
      return n >= PRIVATE_USE_KEYBOARD_MIN && n <= PRIVATE_USE_KEYBOARD_MAX;
    });
    if (privateUse.length > 0) {
      dbgWarn("prompt", "beforeinput-private-use", {
        inputType: e.inputType,
        codePoints: privateUse,
      });
    }

    if (hasKeyboardControlChars(data)) {
      e.preventDefault();
      dbgWarn("prompt", "beforeinput-blocked", {
        inputType: e.inputType,
        codePoints,
      });
    }
  }

  function handleInput(e: Event | undefined = undefined) {
    const composing = (e as InputEvent | undefined)?.isComposing === true;
    if (!composing) {
      const raw = store.inputText;
      if (hasKeyboardControlChars(raw)) {
        dbgWarn("prompt", "input-keyboard-control-detected", {
          codePoints: formatCodePoints(raw),
          length: raw.length,
        });
      }
      const cleaned = stripKeyboardControlChars(raw);
      if (cleaned !== raw) {
        const el = store.textareaEl;
        const start = el?.selectionStart ?? cleaned.length;
        const end = el?.selectionEnd ?? start;
        store.inputText = cleaned;
        if (el) {
          el.selectionStart = mapIndexAfterStrip(raw, start);
          el.selectionEnd = mapIndexAfterStrip(raw, end);
        }
        dbgWarn("prompt", "input-sanitized", {
          rawCodePoints: formatCodePoints(raw),
          cleanedLength: cleaned.length,
          rawLength: raw.length,
        });
        autoResize();
        onValueChange?.(store.inputText);
        return;
      }
    }

    autoResize();
    onValueChange?.(store.inputText);

    // Exit history mode if user edits the recalled text
    if (histState.index >= 0 && store.inputText !== userHistory[histState.index]) {
      dbg("prompt-history", "exit: user edited", { index: histState.index });
      resetHistory(histState);
    }

    // @-mention detection: runs BEFORE slashEnabled guard so it works pre-session
    const cursorPos = store.textareaEl?.selectionStart ?? store.inputText.length;
    handleAtInput(cursorPos);

    if (!slashEnabled) {
      dbg("slash", "disabled", {
        agent,
        useStreamSession,
        sessionAlive,
        canResume,
        inputText: store.inputText,
      });
      return;
    }

    if (slashPhase === "sub-model" || slashPhase === "sub-fast") {
      // Close sub-view if input no longer matches /activeCmdName
      if (activeSlashCmd && !isSubViewInputValid(store.inputText, activeSlashCmd.name)) {
        closeSlashMenu("sub-invalid-input");
      }
      return;
    }

    // Commands phase
    const match = store.inputText.match(/^\/([a-zA-Z0-9_-]*)$/);
    if (match) {
      slashSelectedIndex = 0;
      if (!slashMenuOpen) {
        dbg("slash", "open", { query: match[1] });
        slashMenuOpen = true;
        slashPhase = "commands";
      }
    } else if (slashMenuOpen) {
      closeSlashMenu("no-match");
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
      store.inputText = stripKeyboardControlChars(userHistory[histState.index]);
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
    // No scheduleAutoResize call here — the rAF above is for cursor positioning
    // and autoResize is the side-effect we need only once per frame.
  }

  function handleKeydown(e: KeyboardEvent) {
    // Skip during IME composition (e.g., Chinese input confirming with Enter)
    if (e.isComposing || e.keyCode === 229) return;

    if (e.key.length === 1 && isPrivateUseKeyboardChar(e.key)) {
      e.preventDefault();
      dbgWarn("prompt", "keydown-private-use-blocked", {
        codePoint: `U+${e.key.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
        keyCode: e.keyCode,
      });
      return;
    }

    // WebView/Tauri quirk: Arrow keys may arrive as C0 controls (e.g. U+001D) and get inserted.
    const misNav = misencodedNavigationDirection(e);
    if (misNav && store.textareaEl) {
      e.preventDefault();
      moveTextareaCaret(store.textareaEl, misNav);
      return;
    }
    if (e.key.length === 1 && hasKeyboardControlChars(e.key)) {
      e.preventDefault();
      dbgWarn("prompt", "keydown-control-blocked", {
        codePoint: `U+${e.key.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
        keyCode: e.keyCode,
      });
      return;
    }

    // ── @-mention menu ──
    if (atMenuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAtMenu("escape");
        return;
      }
      if (atResults.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          atSelectedIndex = Math.min(atSelectedIndex + 1, atResults.length - 1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          atSelectedIndex = Math.max(atSelectedIndex - 1, 0);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectAtEntry(atResults[atSelectedIndex]);
          return;
        }
      }
      // Let other keys through for typing
    }

    // ── Sub-model phase ──
    if (slashMenuOpen && slashPhase === "sub-model") {
      if (e.key === "Escape") {
        e.preventDefault();
        goBackToCommands();
        return;
      }
      if (e.key === "Backspace") {
        if (
          shouldBackFromSubView(
            store.inputText,
            store.textareaEl?.selectionStart ?? 0,
            activeSlashCmd?.name,
          )
        ) {
          e.preventDefault();
          goBackToCommands();
          return;
        }
        // else: normal backspace (let it through)
        return;
      }
      if (models.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          slashSubSelectedIndex = Math.min(slashSubSelectedIndex + 1, models.length - 1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          slashSubSelectedIndex = Math.max(slashSubSelectedIndex - 1, 0);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          handleSubModelSelect(models[slashSubSelectedIndex]);
          return;
        }
      }
      // Let other keys through for typing in sub-view
      return;
    }

    // ── Sub-fast phase ──
    if (slashMenuOpen && slashPhase === "sub-fast") {
      if (e.key === "Escape") {
        e.preventDefault();
        goBackToCommands();
        return;
      }
      if (e.key === "Backspace") {
        if (
          shouldBackFromSubView(
            store.inputText,
            store.textareaEl?.selectionStart ?? 0,
            activeSlashCmd?.name,
          )
        ) {
          e.preventDefault();
          goBackToCommands();
          return;
        }
        return;
      }
      const FAST_OPTIONS = 2;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slashSubSelectedIndex = Math.min(slashSubSelectedIndex + 1, FAST_OPTIONS - 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slashSubSelectedIndex = Math.max(slashSubSelectedIndex - 1, 0);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleFastModeSelect(slashSubSelectedIndex === 0 ? "off" : "on");
        return;
      }
      return;
    }

    // ── Commands phase ──
    if (slashMenuOpen && slashPhase === "commands") {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlashMenu("escape");
        return;
      }
      if (effectiveCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          slashSelectedIndex = Math.min(slashSelectedIndex + 1, effectiveCommands.length - 1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          slashSelectedIndex = Math.max(slashSelectedIndex - 1, 0);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          selectSlashCommand(effectiveCommands[slashSelectedIndex], "enter");
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          selectSlashCommand(effectiveCommands[slashSelectedIndex], "tab");
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
        { atMenuOpen, slashMenuOpen, modeDropdownOpen: false },
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

  /** Wrap path in backtick fence that won't conflict with path content. */
  function wrapPathInBackticks(p: string): string {
    let maxRun = 0;
    let currentRun = 0;
    for (const ch of p) {
      if (ch === "`") {
        currentRun++;
        maxRun = Math.max(maxRun, currentRun);
      } else {
        currentRun = 0;
      }
    }
    const fence = "`".repeat(maxRun + 1);
    const needsPadding = p.startsWith("`") || p.endsWith("`");
    return needsPadding ? `${fence} ${p} ${fence}` : `${fence}${p}${fence}`;
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

    // Separate regular (binary) and path-reference attachments
    const regularAtts = store.pendingAttachments.filter((a) => a.contentBase64);
    const pathRefAtts = store.pendingAttachments.filter((a) => a.filePath && !a.contentBase64);

    // Combine paste blocks + typed text + path-reference file paths
    const parts: string[] = store.pastedBlocks.map((b) => b.text);
    if (pathRefAtts.length > 0) {
      const refs = pathRefAtts.map((a) => `[PDF: ${a.filePath}]`).join("\n");
      parts.push(refs);
    }
    // store.pendingPathRefs (directories, large files from drag-drop)
    if (store.pendingPathRefs.length > 0) {
      parts.push(store.pendingPathRefs.map((r) => wrapPathInBackticks(r.path)).join("\n"));
    }

    if (typed) parts.push(typed);
    const text = parts.join("\n\n");
    if (!text || disabled) return;

    // Double-submit protection: the SendCoordinator owns the single-flight
    // slot. If a submit is already in flight for this run, swallow the
    // duplicate click. The button is also disabled via `busy`, but
    // keyboard Enter can race the disabled state.
    if (busy) {
      dbg("prompt", "send.suppressed.busy");
      return;
    }

    dbg("prompt", "send", {
      len: text.length,
      pasteBlocks: store.pastedBlocks.length,
      attachments: regularAtts.length,
      pathRefs: pathRefAtts.length,
      dragPathRefs: store.pendingPathRefs.length,
      agent,
    });

    void import("$lib/services/sound-feedback-service")
      .then((m) => m.unlockSoundEngine())
      .catch((e) => console.debug("[sound] unlock failed:", e));

    const attachments: Attachment[] = regularAtts.map((a) => ({
      name: a.name,
      type: a.type,
      size: a.size,
      contentBase64: a.contentBase64!,
    }));

    // v1.0.9: clear visually for instant feedback, but capture a draft
    // snapshot so the SendCoordinator can restore it on failure. The
    // parent MUST await onSend; if it resolves the draft is discarded,
    // if it rejects the draft is restored.
    const draftSnapshot: PromptInputSnapshot = {
      text,
      attachments: [...store.pendingAttachments],
      pastedBlocks: [...store.pastedBlocks],
      pathRefs: [...store.pendingPathRefs],
    };

    store.inputText = "";
    store.pendingAttachments = [];
    store.pastedBlocks = [];
    store.pendingPathRefs = [];
    resetHistory(histState);
    if (store.textareaEl) store.textareaEl.style.height = "auto";
    // Collapse the composer back to the capsule synchronously with the text
    // clear so the animation plays as part of the same frame the textarea
    // empties — relying on the inputText-watcher $effect alone races with
    // IME composition and pendingPermission state.
    resetCapsuleLayout();

    Promise.resolve()
      .then(() => onSend(text, attachments))
      .then(
        () => {
          // accepted: keep the cleared state
        },
        (e) => {
          // failed: restore the draft so the user can retry
          dbgWarn("prompt", "send.failed.restore", { error: e });
          store.restoreSnapshot(draftSnapshot);
        },
      );
  }

  function handleBtwSend() {
    const question = store.inputText.trim();
    if (!question || !onBtwSend) return;
    dbg("prompt", "btwSend", { len: question.length });
    store.inputText = "";
    if (store.textareaEl) store.textareaEl.style.height = "auto";
    resetCapsuleLayout();
    onBtwSend(question);
  }

  async function processFiles(files: FileList | File[]) {
    let binaryRemaining = MAX_ATTACHMENTS - store.pendingAttachments.length;
    let textRemaining = MAX_PASTE_BLOCKS - store.pastedBlocks.length;
    const rejected: string[] = [];

    for (const file of Array.from(files)) {
      // MIME normalization: force application/pdf when detected by extension
      // (backend silently skips attachments with unrecognized MIME types)
      const detectedPdf = !isPdf(file.type) && getFileExtension(file.name) === "pdf";
      const effectivePdf = isPdf(file.type) || detectedPdf;

      // PDF >20MB ≤100MB: save to temp, use path-reference (CLI handles via pdftoppm)
      if (effectivePdf && file.size > PDF_MAX_BINARY_SIZE) {
        if (file.size > PDF_MAX_PATH_SIZE) {
          showToast(t("prompt_fileTooLarge", { limit: "100", name: file.name }), "error");
          continue;
        }
        if (binaryRemaining <= 0) {
          showToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }), "error");
          break;
        }
        binaryRemaining--;
        try {
          const buffer = await file.arrayBuffer();
          const base64 = arrayBufferToBase64(buffer);
          const tempPath = await api.saveTempAttachment(file.name, base64);
          store.pendingAttachments = [
            ...store.pendingAttachments,
            {
              id: uuid().slice(0, 8),
              name: file.name,
              type: "application/pdf",
              size: file.size,
              filePath: tempPath,
            },
          ];
          dbg("prompt", "pdf-temp-path-ref", { name: file.name, size: file.size, path: tempPath });
        } catch (e) {
          binaryRemaining++;
          dbgWarn("prompt", "pdf-temp-save-failed", { name: file.name, error: e });
          showToast(t("prompt_fileTooLarge", { limit: "20", name: file.name }), "error");
        }
        continue;
      }

      // 1) Size check — per type (images: no limit, PDF: 20MB, text: 10MB)
      const sizeLimit = getFileSizeLimit(file);
      if (file.size > sizeLimit) {
        const limitMB = sizeLimit / (1024 * 1024);
        showToast(t("prompt_fileTooLarge", { limit: String(limitMB), name: file.name }), "error");
        continue;
      }

      // 2) Binary attachment: images + PDF (≤20MB)
      if (BINARY_ATTACHMENT_TYPES.includes(file.type) || detectedPdf) {
        if (binaryRemaining <= 0) {
          showToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }), "error");
          break;
        }
        binaryRemaining--;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1] ?? "";
          store.pendingAttachments = [
            ...store.pendingAttachments,
            {
              id: uuid().slice(0, 8),
              name: file.name || `attachment.${file.type.split("/")[1] || "bin"}`,
              type: detectedPdf ? "application/pdf" : file.type,
              size: file.size,
              contentBase64: base64,
            },
          ];
          dbg("prompt", "add-binary-file", { name: file.name, type: file.type, size: file.size });
        };
        reader.readAsDataURL(file);
        continue;
      }
      // 3) Text file → pastedBlock
      if (isTextFile(file)) {
        if (textRemaining <= 0) {
          showToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }), "error");
          break;
        }
        textRemaining--; // Pre-decrement before async read to prevent race
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          const lines = text.split("\n");
          const lineCount = lines.length;
          const charCount = text.length;
          const ext = getFileExtension(file.name);
          const preview = file.name || `file.${ext}`;

          store.pastedBlocks = [
            ...store.pastedBlocks,
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount,
              preview,
              ext,
            },
          ];
          dbg("prompt", "add-text-file", {
            name: file.name,
            lines: lineCount,
            chars: charCount,
          });
        };
        reader.readAsText(file);
        continue;
      }
      // 3.5) Convertible → await conversion, then add as pastedBlock
      if (isConvertibleFile(file)) {
        if (textRemaining <= 0) {
          showToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }), "error");
          break;
        }
        textRemaining--;
        try {
          const { text } = await convertFile(file);
          const lineCount = text.split("\n").length;
          store.pastedBlocks = [
            ...store.pastedBlocks,
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount: text.length,
              preview: file.name,
              ext: getFileExtension(file.name),
            },
          ];
          dbg("prompt", "converted-file", { name: file.name, lines: lineCount });
        } catch (e) {
          textRemaining++; // Roll back quota on failure
          showToast(t("prompt_conversionFailed", { name: file.name }), "error");
          dbgWarn("prompt", "conversion-failed", { name: file.name, error: e });
        }
        continue;
      }
      // 4) Unsupported
      rejected.push(getFileExtension(file.name) || file.type || "unknown");
    }
    if (rejected.length > 0) {
      showToast(t("prompt_unsupportedFile", { ext: rejected[0] }), "error");
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;
    processFiles(files);
    input.value = "";
  }

  function removeAttachment(id: string) {
    store.pendingAttachments = store.pendingAttachments.filter((a) => a.id !== id);
  }

  function handlePaste(e: ClipboardEvent) {
    // Step 1: Check for clipboard binary files (images, PDF) BEFORE text
    const items = e.clipboardData?.items;
    if (items) {
      const binaryItems: DataTransferItem[] = [];
      for (let i = 0; i < items.length; i++) {
        if (BINARY_ATTACHMENT_TYPES.includes(items[i].type)) {
          binaryItems.push(items[i]);
        } else if (items[i].kind === "file") {
          // Extension fallback: browser may give wrong/empty MIME for PDF
          const file = items[i].getAsFile();
          if (file && getFileExtension(file.name) === "pdf") {
            binaryItems.push(items[i]);
          }
        }
      }
      if (binaryItems.length > 0) {
        e.preventDefault();
        const filesToProcess: File[] = [];
        for (const item of binaryItems) {
          const file = item.getAsFile();
          if (file) filesToProcess.push(file);
        }
        if (filesToProcess.length > 0) processFiles(filesToProcess);
        return;
      }
    }

    // Step 2: Text paste handling
    let text = e.clipboardData?.getData("text/plain");
    if (text) {
      const clean = stripKeyboardControlChars(text);
      if (clean !== text) {
        e.preventDefault();
        text = clean;
        if (!text) return;
        const el = store.textareaEl;
        const start = el?.selectionStart ?? store.inputText.length;
        const end = el?.selectionEnd ?? start;
        const before = store.inputText.slice(0, start);
        const after = store.inputText.slice(end);
        const textLen = text.length;
        store.inputText = before + text + after;
        requestAnimationFrame(() => {
          if (!store.textareaEl) return;
          const pos = start + textLen;
          store.textareaEl.selectionStart = store.textareaEl.selectionEnd = pos;
          autoResize();
        });
        onValueChange?.(store.inputText);
        return;
      }
    }

    if (!text) {
      // Empty text — likely Finder file paste (macOS puts file URLs, not text)
      e.preventDefault();
      tryNativeClipboardPaste();
      return;
    }

    const lines = text.split("\n");
    const lineCount = lines.length;
    const charCount = text.length;

    if (lineCount < 5 && charCount < 500) {
      // Short text — could be Finder filename or normal short text
      // Don't preventDefault → let browser insert text normally
      const snapshot = store.inputText;
      const cursorPos = store.textareaEl?.selectionStart ?? store.inputText.length;
      // Async check: if native clipboard has files, roll back the inserted text
      tryNativeClipboardPaste(snapshot, cursorPos);
      return;
    }

    // Long text → intercept, compress into chip
    e.preventDefault();
    if (store.pastedBlocks.length >= MAX_PASTE_BLOCKS) {
      showToast(t("prompt_maxPasteBlocks", { count: String(MAX_PASTE_BLOCKS) }), "error");
      return;
    }

    const firstLine = lines[0].trim();
    const preview = firstLine.length > 40 ? firstLine.slice(0, 40) + "..." : firstLine;

    store.pastedBlocks = [
      ...store.pastedBlocks,
      {
        id: uuid().slice(0, 8),
        text,
        lineCount,
        charCount,
        preview,
      },
    ];

    dbg("prompt", "paste-compressed", { lineCount, charCount, blocks: store.pastedBlocks.length });
  }

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);
  }

  async function tryNativeClipboardPaste(
    snapshot: string | undefined = undefined,
    cursorPos: number | undefined = undefined,
  ) {
    try {
      const files = await withTimeout(api.getClipboardFiles(), 250);
      if (files.length === 0) return; // No files — text already inserted (or empty paste)

      dbg("prompt", "native-clipboard-files", { count: files.length });

      // Roll back browser-inserted text if we have a snapshot
      if (snapshot !== undefined) {
        store.inputText = snapshot;
        if (store.textareaEl && cursorPos !== undefined) {
          requestAnimationFrame(() => {
            store.textareaEl!.selectionStart = store.textareaEl!.selectionEnd = cursorPos;
          });
        }
      }
      await processClipboardPaths(files);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Only show toast when user explicitly pasted files (no text in clipboard)
      if (snapshot === undefined && msg.includes("not yet supported")) {
        showToast(t("prompt_clipboardUnsupported"), "error");
      }
      dbg("prompt", "native clipboard failed/timeout", e);
    }
  }

  async function processClipboardPaths(files: ClipboardFileInfo[]) {
    let binaryRemaining = MAX_ATTACHMENTS - store.pendingAttachments.length;
    let textRemaining = MAX_PASTE_BLOCKS - store.pastedBlocks.length;
    const rejected: string[] = [];

    for (const file of files) {
      // MIME normalization: force application/pdf for extension-detected PDFs
      // (backend silently skips attachments with unrecognized MIME types)
      const clipboardPdf =
        file.mime_type !== "application/pdf" && getFileExtension(file.name).toLowerCase() === "pdf";
      const effectiveMime = clipboardPdf ? "application/pdf" : file.mime_type;

      // PDF path-reference: >20MB ≤100MB → store path only, CLI handles via pdftoppm
      if (isPdf(effectiveMime) && file.size > PDF_MAX_BINARY_SIZE) {
        if (file.size > PDF_MAX_PATH_SIZE) {
          showToast(t("prompt_fileTooLarge", { limit: "100", name: file.name }), "error");
          continue;
        }
        if (binaryRemaining <= 0) {
          showToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }), "error");
          break;
        }
        binaryRemaining--;
        store.pendingAttachments = [
          ...store.pendingAttachments,
          {
            id: uuid().slice(0, 8),
            name: file.name,
            type: effectiveMime,
            size: file.size,
            filePath: file.path,
          },
        ];
        dbg("prompt", "clipboard-pdf-path-ref", {
          name: file.name,
          size: file.size,
          path: file.path,
        });
        continue;
      }

      const sizeLimit = getSizeLimitByMime(effectiveMime);
      if (file.size > sizeLimit) {
        const limitMB = sizeLimit / (1024 * 1024);
        showToast(t("prompt_fileTooLarge", { limit: String(limitMB), name: file.name }), "error");
        continue;
      }
      const cls = classifyByMime(effectiveMime);

      if (cls === "binary") {
        if (binaryRemaining <= 0) {
          showToast(t("prompt_maxAttachments", { count: String(MAX_ATTACHMENTS) }), "error");
          break;
        }
        binaryRemaining--;
        try {
          const content = await api.readClipboardFile(file.path, false);
          store.pendingAttachments = [
            ...store.pendingAttachments,
            {
              id: uuid().slice(0, 8),
              name: file.name,
              type: effectiveMime,
              size: file.size,
              contentBase64: content.content_base64,
            },
          ];
          dbg("prompt", "clipboard-binary", { name: file.name, type: effectiveMime });
        } catch (e) {
          dbg("prompt", "clipboard-read-error", { name: file.name, error: e });
        }
      } else if (cls === "text") {
        if (textRemaining <= 0) {
          showToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }), "error");
          break;
        }
        textRemaining--;
        try {
          const content = await api.readClipboardFile(file.path, true);
          const text = content.content_text ?? "";
          const lineCount = text.split("\n").length;
          store.pastedBlocks = [
            ...store.pastedBlocks,
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount: text.length,
              preview: file.name,
              ext: getFileExtension(file.name),
            },
          ];
          dbg("prompt", "clipboard-text", { name: file.name, lines: lineCount });
        } catch (e) {
          dbg("prompt", "clipboard-read-error", { name: file.name, error: e });
        }
      } else if (cls === "convertible" || isConvertibleByExt(getFileExtension(file.name))) {
        if (textRemaining <= 0) {
          showToast(t("prompt_maxTextFiles", { count: String(MAX_PASTE_BLOCKS) }), "error");
          break;
        }
        textRemaining--;
        try {
          const content = await api.readClipboardFile(file.path, false);
          const binary = atob(content.content_base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new File([bytes], file.name, { type: file.mime_type });
          const { text } = await convertFile(blob);
          const lineCount = text.split("\n").length;
          store.pastedBlocks = [
            ...store.pastedBlocks,
            {
              id: uuid().slice(0, 8),
              text,
              lineCount,
              charCount: text.length,
              preview: file.name,
              ext: getFileExtension(file.name),
            },
          ];
          dbg("prompt", "clipboard-converted", { name: file.name, lines: lineCount });
        } catch (e) {
          textRemaining++;
          showToast(t("prompt_conversionFailed", { name: file.name }), "error");
          dbgWarn("prompt", "clipboard-convert-error", { name: file.name, error: e });
        }
      } else {
        rejected.push(getFileExtension(file.name) || "unknown");
      }
    }
    if (rejected.length > 0) {
      showToast(t("prompt_unsupportedFile", { ext: rejected[0] }), "error");
    }
  }

  function removePastedBlock(id: string) {
    store.pastedBlocks = store.pastedBlocks.filter((b) => b.id !== id);
  }

  // v1.0.6 / B2: pendingResize coalesces every autoResize request that
  // lands inside the same animation frame. Multiple `rAF(autoResize)` calls
  // (8 spots in this file) used to schedule N callbacks; we now schedule 1.
  let _pendingResize = false;
  function scheduleAutoResize(): void {
    if (_pendingResize) return;
    _pendingResize = true;
    requestAnimationFrame(() => {
      _pendingResize = false;
      autoResize();
    });
  }

  function autoResize() {
    if (!store.textareaEl || isComposing) return;
    const el = store.textareaEl;
    const maxHeight = 4 * 24; // ~4 lines
    const hasNewline = store.inputText.includes("\n");
    const prevCapsuleExpanded = capsuleExpanded;
    const prevHeight = textareaHeightPx;

    // Temporarily expand the textarea to measure true content height.
    // In capsule mode the textarea has overflow-y:hidden + explicit
    // style:height (24px); reading scrollHeight on such a constrained
    // element can return the CSS height rather than the natural content
    // height.  Setting height to a large value forces the browser to lay
    // out the full content, then we read scrollHeight and restore — all
    // synchronous, browser never paints the intermediate state.
    const savedH = el.style.height;
    el.style.height = "9999px";
    const scrollH = el.scrollHeight;
    el.style.height = savedH;

    // Compute the **content** height (text only, no padding/border) so the
    // threshold check is independent of which layout state we're in. The
    // capsule mode has `py-0` (~0px vertical padding) and multi-line has
    // `pt-1 pb-2` (~12px) — using raw `scrollH` would over-estimate content
    // height in multi-line mode and keep the box stuck at 2 lines even when
    // the user has deleted down to a single line. The "stuck at 2 lines after
    // delete" bug was exactly that.
    const cs = getComputedStyle(el);
    const padTop = parseFloat(cs.paddingTop || "0");
    const padBot = parseFloat(cs.paddingBottom || "0");
    const borderTop = parseFloat(cs.borderTopWidth || "0");
    const borderBot = parseFloat(cs.borderBottomWidth || "0");
    const verticalChrome = padTop + padBot + borderTop + borderBot;
    const contentH = Math.max(0, scrollH - verticalChrome);

    // Hysteresis: when currently collapsed, only expand once content height
    // exceeds the higher threshold; when currently expanded, only collapse
    // once it drops below the lower threshold. The gap between the two
    // thresholds creates a dead zone that prevents the flip-flop
    // oscillation during CSS transitions.
    const threshold = capsuleExpanded ? CAPSULE_COLLAPSE_THRESHOLD_PX : CAPSULE_EXPAND_THRESHOLD_PX;
    const shouldExpand = pendingPermission || hasNewline || contentH > threshold;
    const nextHeight = shouldExpand ? Math.min(contentH, maxHeight) : CAPSULE_LINE_HEIGHT_PX;

    const expandedChanged = capsuleExpanded !== shouldExpand;
    const heightChanged = textareaHeightPx !== nextHeight;

    // ── v1.0.x settle window ───────────────────────────────────────────
    // The textarea's *width* differs between states (capsule narrows it to
    // make room for side toolbars, multi-line widens it to `w-full`).
    // When the user has text that wraps at the capsule width but not at the
    // multi-line width, the measured contentH oscillates across the
    // hysteresis band on every flip — even with padding subtracted and
    // hysteresis in place, the *width* delta alone causes the flip-flop.
    //
    // Fix: after a state change, hold the new state for ~300ms (slightly
    // longer than the 260ms CSS transition) so the next autoResize runs
    // against the *settled* width/padding values. Height still updates
    // every call so the visual transition isn't delayed.
    const sinceLastChange = performance.now() - _lastStateChangeMs;
    const inSettleWindow = sinceLastChange < STATE_SETTLE_MS;

    __dbg("autoResize", {
      prevCapsuleExpanded,
      capsuleExpanded,
      nextCapsuleExpanded: shouldExpand,
      changed: expandedChanged,
      inSettleWindow,
      sinceLastChange: Math.round(sinceLastChange),
      "text.len": store.inputText.length,
      hasNewline,
      pendingPermission,
      scrollH,
      padTop,
      padBot,
      borderTop,
      borderBot,
      verticalChrome,
      contentH,
      threshold,
      nextHeight,
      prevHeight,
      heightChanged,
    });

    if (heightChanged) {
      textareaHeightPx = nextHeight;
    }
    if (expandedChanged && !inSettleWindow) {
      _lastStateChangeMs = performance.now();
      capsuleExpanded = shouldExpand;
      // Delay the layout flip (flex-direction row↔column) until the CSS
      // height + border-radius transition has finished, so the morph
      // feels like one unified animation rather than "grow then rearrange".
      if (_layoutTimer) clearTimeout(_layoutTimer);
      _layoutTimer = setTimeout(() => {
        layoutExpanded = shouldExpand;
        _layoutTimer = null;
      }, 260); // matches the CSS transition duration
    }
    el.style.overflowY = shouldExpand ? "auto" : "hidden";
  }

  // ── Drag-drop state ──
  let dragCounter = $state(0);
  let dragActive = $derived(dragCounter > 0);

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragCounter++;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter--;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    processFiles(files);
  }

  let canSend = $derived(
    !disabled &&
      !busy &&
      (!!store.inputText.trim() ||
        store.pastedBlocks.length > 0 ||
        store.pendingAttachments.some((a) => a.filePath) ||
        store.pendingPathRefs.length > 0),
  );

  // ── Token estimation (chars/4 heuristic, CJK-aware) ──
  function estimateTokens(text: string): number {
    let chars = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      chars += code >= 0x4e00 && code <= 0x9fff ? 2 : 1;
    }
    return Math.ceil(chars / 4);
  }
  let tokenEstimate = $state(0);
  let tokenDebounce: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const allText = [store.inputText, ...store.pastedBlocks.map((b) => b.text)].join("\n");
    if (tokenDebounce) clearTimeout(tokenDebounce);
    tokenDebounce = setTimeout(() => {
      tokenEstimate = allText ? estimateTokens(allText) : 0;
    }, 300);
    return () => {
      if (tokenDebounce) {
        clearTimeout(tokenDebounce);
        tokenDebounce = null;
      }
    };
  });
  const tokenPercent = $derived(
    contextWindow > 0 && tokenEstimate > 0 ? Math.round((tokenEstimate / contextWindow) * 100) : 0,
  );
  const tokenWarning = $derived(tokenPercent > 80);
  const showTokenEstimate = $derived(tokenEstimate > 0);
  const showTokenEstimateUi = $derived(
    showTokenEstimate && shouldShowContextDetails(processVisibility),
  );

  export function focus() {
    store.textareaEl?.focus();
  }

  export function setValue(text: string) {
    store.inputText = stripKeyboardControlChars(text);
    requestAnimationFrame(() => {
      autoResize();
      store.textareaEl?.focus();
    });
  }

  export function appendText(text: string) {
    const clean = stripKeyboardControlChars(text);
    store.inputText = store.inputText ? store.inputText + "\n" + clean : clean;
    requestAnimationFrame(() => {
      autoResize();
      store.textareaEl?.focus();
    });
  }

  export function triggerSend() {
    handleSend();
  }

  export function addFiles(files: FileList | File[]) {
    return processFiles(files);
  }

  export function addPathRefs(refs: Array<{ path: string; name: string; isDir: boolean }>) {
    const newRefs = refs.map((ref) => ({
      id: uuid().slice(0, 8),
      name: ref.name,
      path: ref.path,
      isDir: ref.isDir,
    }));
    store.pendingPathRefs = [...store.pendingPathRefs, ...newRefs];
    dbg("prompt", "add-path-refs", { count: refs.length });
  }

  function removePathRef(id: string) {
    store.pendingPathRefs = store.pendingPathRefs.filter((r) => r.id !== id);
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

  /** v1.0.9: clear the input + attachment state. Used by the
   *  SendCoordinator onAccepted hook to drop the draft only after the
   *  transport has accepted the submit. */
  export function clearInput(): void {
    store.clearAll();
    resetHistory(histState);
    requestAnimationFrame(() => {
      autoResize();
      store.textareaEl?.focus();
    });
  }

  export function clearAll(): void {
    store.clearAll();
    resetHistory(histState);
    scheduleAutoResize();
  }

  function hasContent(): boolean {
    return store.hasContent;
  }
</script>

<!-- Web drag handlers — only fire when Tauri dragDropEnabled is false (non-Tauri builds).
     When dragDropEnabled: true, Tauri intercepts OS drag events and Web drag events do not fire. -->
<div
  class="relative mx-auto w-full px-4 py-0 {useCapsuleStrip ? 'max-w-4xl' : 'max-w-5xl'}"
  ondragenter={handleDragEnter}
  ondragleave={handleDragLeave}
  ondragover={handleDragOver}
  ondrop={handleDrop}
  role="region"
  aria-label="File drop zone"
>
  <!-- Drag overlay -->
  {#if dragActive}
    <div
      class="absolute inset-0 z-10 flex items-center justify-center rounded-full border-2 border-dashed border-primary/40 bg-primary/6 backdrop-blur-[2px]"
    >
      <span class="text-sm font-medium text-primary/70">{t("prompt_dropFiles")}</span>
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
          onremove={() => removeAttachment(att.id)}
        />
      {/each}
      {#each store.pendingPathRefs as ref (ref.id)}
        <FileAttachment
          name={ref.name}
          size={0}
          mimeType={ref.isDir ? "inode/directory" : "application/octet-stream"}
          isPathRef={true}
          onremove={() => removePathRef(ref.id)}
        />
      {/each}
      {#each store.pastedBlocks as block (block.id)}
        {@const isSpreadsheet = block.ext ? isSpreadsheetExt(block.ext) : false}
        <span
          class="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--miwarp-status-info)/0.3)] bg-[hsl(var(--miwarp-status-info)/0.05)] text-miwarp-status-info px-2 py-1 text-xs"
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
            type="button"
            onclick={() => removePastedBlock(block.id)}
            class="ml-0.5 rounded p-0.5 transition-colors hover:bg-[hsl(var(--miwarp-status-info)/0.15)]"
            title={t("prompt_removePaste")}
            aria-label={t("prompt_removePaste")}
          >
            <Icon name="x" size="xs" />
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <!-- L3: Quick action pills + git branch (above input container) -->
  {#if (slashEnabled && quickActions.length > 0) || gitBranch}
    <div class="flex items-center gap-1 px-2 pb-2">
      {#if slashEnabled && quickActions.length > 0}
        <div class="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {#each quickActions as cmd (cmd.name)}
            <button
              type="button"
              class="prompt-input-chip shrink-0 rounded-md border border-border/50 px-2 py-0.5 text-[11px]
                bg-background/60 backdrop-blur-sm text-muted-foreground/70
                hover:text-foreground hover:bg-background/80 hover:border-border/50
                active:bg-background/50 active:scale-[0.97]
                transition-all whitespace-nowrap"
              onclick={() => handleQuickAction(cmd)}
              title={cmd.description}
            >
              {t(`quickAction_${cmd.name}` as MessageKey)}
            </button>
          {/each}
          <button
            type="button"
            class="prompt-input-chip shrink-0 rounded-md border border-border/50 px-2 py-0.5 text-[11px]
              bg-background/60 backdrop-blur-sm text-muted-foreground/70
              hover:text-foreground hover:bg-background/80 hover:border-border/50
              active:bg-background/50 active:scale-[0.97]
              transition-all whitespace-nowrap"
            onclick={openSlashMenuFromButton}
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
            <Icon name="git-branch" size="xs" class="shrink-0" />
            <span class="truncate">{gitBranch}</span>
          </span>
        </div>
      {/if}
    </div>
  {/if}

  {#snippet promptToolbarLeft(compact: boolean)}
    {#if !hasRun && onAgentChange}
      <AgentSelector value={agent} onchange={(a) => onAgentChange?.(a)} />
    {/if}
    {#if showPermissionModeButton && onPermissionModeChange}
      <PermissionModePicker
        {permissionMode}
        onchange={onPermissionModeChange}
        variant="input"
        placement="above"
      />
    {:else if !hasRun}
      <div class="w-1"></div>
    {/if}
    {#if fastModeState === "on" || fastModeState === "ultracode"}
      <button
        type="button"
        class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider
          bg-[hsl(var(--miwarp-status-info)/0.15)] text-miwarp-status-info
          hover:bg-[hsl(var(--miwarp-status-info)/0.25)] transition-colors
          motion-running-pulse"
        title={t("prompt_fastModeActive")}
        onclick={() => onFastModeSwitch?.("off")}
      >
        <Icon name="zap" size="xs" class="shrink-0" />
        {#if !compact}
          <span>fast</span>
        {/if}
      </button>
    {/if}
    {#if showAuthBadge && !hasRun && !compact}
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
    {#if hasStash && onRestoreStash}
      <button
        type="button"
        class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[hsl(var(--miwarp-accent-violet)/0.15)] text-miwarp-accent-violet hover:bg-[hsl(var(--miwarp-accent-violet)/0.25)] transition-colors"
        title={t("prompt_stashRestore")}
        onclick={onRestoreStash}
      >
        <Icon name="refresh-cw" size="xs" />
        {#if !compact}
          {t("prompt_stashBadge")}
        {/if}
      </button>
    {/if}
  {/snippet}

  {#snippet promptSendButton(btw = false)}
    {@const sendSizeClass = useCapsuleStrip ? "h-7 w-7" : "h-8 w-8"}
    {@const sendIconSize = useCapsuleStrip ? "sm" : "md"}
    {@const sendLookClass = canSend
      ? btw
        ? "bg-miwarp-status-info text-miwarp-accent-on-accent hover:opacity-90"
        : "bg-primary text-primary-foreground hover:bg-primary/90"
      : "bg-primary text-primary-foreground opacity-45 cursor-not-allowed"}
    <button
      type="button"
      class="flex shrink-0 items-center justify-center rounded-full transition-[opacity,background-color] duration-200 {sendSizeClass} {sendLookClass}"
      onclick={btw ? handleBtwSend : handleSend}
      disabled={!canSend}
      data-busy={busy ? "true" : "false"}
      title={btw ? t("promptInput_sendSideQuestion") : t("prompt_send")}
      aria-label={btw ? t("promptInput_sendSideQuestion") : t("prompt_send")}
    >
      <Icon name="arrow-right" size={sendIconSize} />
    </button>
  {/snippet}

  {#snippet promptToolbarRight(compact: boolean)}
    {#if showTokenEstimateUi && !compact}
      <span
        class="text-[10px] tabular-nums px-1.5 shrink-0 {tokenWarning
          ? 'text-miwarp-status-warning'
          : 'text-muted-foreground/50'}"
        title={contextWindow > 0 ? t("prompt_tokenPercent", { pct: String(tokenPercent) }) : ""}
      >
        {t("prompt_tokenEstimate", { tokens: String(tokenEstimate) })}
        {#if contextWindow > 0}<span class="ml-0.5"
            >{t("prompt_tokenPercent", { pct: String(tokenPercent) })}</span
          >{/if}
        {#if tokenWarning}<Icon
            name="triangle-alert"
            size="xs"
            class="ml-0.5 inline text-miwarp-status-warning"
          />{/if}
      </span>
    {/if}
    {#if slashEnabled}
      <button
        type="button"
        bind:this={slashBtnEl}
        class="flex h-7 w-7 items-center justify-center rounded-full
          text-muted-foreground/60 hover:text-foreground hover:bg-accent/15 transition-colors"
        onclick={openSlashMenuFromButton}
        title={t("prompt_slashCommands")}
        aria-label={t("prompt_slashCommands")}
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
      bind:this={fileInput}
      type="file"
      multiple
      accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.rs,.svelte,.html,.css,.yaml,.yml,.toml,.xml,.sh,.sql,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.csv,.log,.docx,.xlsx"
      class="hidden"
      onchange={handleFileSelect}
    />
    <button
      type="button"
      class="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-accent/15 transition-colors disabled:opacity-30"
      onclick={() => fileInput?.click()}
      disabled={store.pendingAttachments.length >= 8}
      title={t("prompt_attachFiles")}
      aria-label={t("prompt_attachFiles")}
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
    {#if IS_MAC && !compact}
      <button
        type="button"
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
      {#if canSend}
        {@render promptSendButton(btwMode)}
      {/if}
      {#if onBtwSend}
        <button
          type="button"
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
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
        onclick={onInterrupt}
        title={t("prompt_stop")}
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    {:else}
      {@render promptSendButton(false)}
    {/if}
  {/snippet}

  <!-- Unified input container -->
  <div
    class="prompt-input-shell overflow-hidden border border-primary bg-background/72 backdrop-blur-2xl transition-[border-radius,border-color,background-color,box-shadow] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] {useCapsuleStrip
      ? 'rounded-full'
      : 'rounded-[1.75rem]'} {btwMode
      ? 'border-miwarp-status-info/80'
      : ''} {fastModeState === 'on' && !btwMode
      ? 'border-miwarp-status-info/40 shadow-[0_0_12px_-2px_hsl(var(--miwarp-status-info)/0.25)]'
      : ''} {pendingPermission ? 'motion-attention-pulse' : ''}"
  >
    {#if pendingPermission}
      <div
        role="status"
        aria-live="polite"
        class="flex items-center gap-2 px-5 pt-3 pb-0.5 text-xs text-miwarp-status-warning"
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

    <!-- Unified input row: same textarea + same shell across capsule and
         multi-line states. The visual difference comes from `flex-direction`
         (row vs column) and which toolbar children are rendered. Because the
         textarea is a single DOM element, CSS transitions on its `height`
         and the parent's `border-radius` actually animate — no DOM swap, no
         choppy cross-element transition. Toolbars enter/leave via
         `transition:slide` so the left/right compact → bottom full swap feels
         continuous instead of jumping.
         Note: `flex-direction` itself is a discrete CSS property that
         cannot be smoothly transitioned — we deliberately do NOT list it in
         the transition property whitelist. The visual smoothness comes
         from animating the textarea's height + padding + the toolbar slide
         together, while the flex direction flips as a coordinated snap on
         the same frame. -->
    <!-- ── Unified input container (Option A: absolute side toolbars) ──
         The two-mode "capsule vs multi-line" layout was suffering a
         flip-flop loop because the side toolbars in capsule mode
         (`max-w-[42%]` + `shrink-0`) squeezed the textarea's flex space,
         collapsing the wrap from 1 line in multi-line to 10+ lines in
         capsule for the same text. The contentH then alternated between
         <28 and >34, tripping the hysteresis on every settle expiry.

         Fix: in capsule mode the side toolbars are taken out of the flex
         flow with `position: absolute` and the textarea reserves fixed
         left/right padding to clear them. The textarea now keeps the same
         width in both modes → text wraps identically → contentH is
         stable → hysteresis behaves as designed. -->
    <div
      class="relative flex w-full transition-[min-height,padding] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] will-change-[min-height,padding] {useCapsuleStrip
        ? 'flex-row min-h-[42px] items-center py-1'
        : 'flex-col px-1 pt-2 pb-1'}"
    >
      {#if useCapsuleStrip}
        <!-- In capsule, BOTH toolbars (left: agent selector + permission mode,
             right: send) are stacked on the RIGHT side via `absolute right-0`.
             This frees the left edge of the textarea so the placeholder
             (and the first character of typed text) sits at the natural
             left of the pill — matching user expectation. The toolbars
             stay accessible above the textarea thanks to `z-10`. -->
        <div
          transition:slide={{ duration: 260, axis: "x" }}
          class="no-drag pointer-events-auto absolute right-0 top-0 z-10 flex h-full max-w-[55%] items-center gap-0.5 overflow-visible pl-1.5 pr-2.5"
        >
          {@render promptToolbarLeft(true)}
          {@render promptToolbarRight(true)}
        </div>
      {/if}

      <textarea
        bind:this={store.textareaEl}
        bind:value={store.inputText}
        onkeydown={handleKeydown}
        onbeforeinput={handleBeforeInput}
        oninput={handleInput}
        onpaste={handlePaste}
        oncompositionstart={() => (isComposing = true)}
        oncompositionend={() => (isComposing = false)}
        placeholder={effectivePlaceholder}
        rows={1}
        {disabled}
        aria-label={t("prompt_chatInput")}
        class="no-drag min-w-0 w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 transition-[height,min-height,padding] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] will-change-[height,padding] focus:outline-none disabled:opacity-50 {useCapsuleStrip
          ? 'overflow-x-auto overflow-y-hidden min-h-[24px] py-0 pl-3 pr-[150px] leading-6'
          : 'w-full overflow-y-auto px-4 pt-1 pb-2'}"
        style:height={`${textareaHeightPx}px`}
      ></textarea>

      {#if useCapsuleStrip}
        <!-- right toolbar merged into left toolbar above (single absolute
             right-0 container) -->
      {:else}
        <div
          transition:slide={{ duration: 260, axis: "y" }}
          class="flex w-full items-center justify-between px-3 pb-2.5 pt-0.5"
        >
          <div class="no-drag relative z-10 flex min-w-0 items-center gap-1 pointer-events-auto">
            {@render promptToolbarLeft(false)}
          </div>
          <div class="flex shrink-0 items-center gap-0.5">
            {@render promptToolbarRight(false)}
          </div>
        </div>
      {/if}
    </div>

    {#if atMenuOpen}
      <AtMentionMenu
        entries={atResults}
        selectedIndex={atSelectedIndex}
        loading={atLoading}
        query={atQuery}
        anchorEl={store.textareaEl}
        onSelect={selectAtEntry}
        onHover={(i) => (atSelectedIndex = i)}
        onDismiss={() => closeAtMenu("click-outside")}
      />
    {/if}

    {#if slashMenuOpen}
      <SlashMenu
        commands={filteredCommands}
        {slashGroups}
        selectedIndex={slashSelectedIndex}
        anchorEl={store.textareaEl}
        triggerEl={slashBtnEl}
        phase={slashPhase}
        {models}
        {currentModel}
        subSelectedIndex={slashSubSelectedIndex}
        {hintText}
        inputDisplay={store.inputText}
        {fastModeState}
        // v1.0.6 / 3.10 (A3): tell the menu if it should show the
        // "session_init 未到达" banner — i.e. dynamic commands from CLI
        // haven't arrived yet, so the menu is virtual-only.
        showBuiltInOnlyBanner={!cliCommands || cliCommands.length === 0}
        onSelect={(cmd) => selectSlashCommand(cmd, "enter")}
        onHover={(i) => (slashSelectedIndex = i)}
        onSubHover={(i) => (slashSubSelectedIndex = i)}
        onSubSelect={handleSubModelSelect}
        onFastSelect={handleFastModeSelect}
        onBack={goBackToCommands}
        onDismiss={() => closeSlashMenu("click-outside")}
      />
    {/if}
  </div>
</div>
