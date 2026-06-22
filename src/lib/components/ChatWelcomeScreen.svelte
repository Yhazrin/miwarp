<script lang="ts">
  /**
   * v1.0.6 follow-up: holds the per-new-session `creationMode` picker
   * (worktree on/off) — moved here from the Settings page. Defaults to
   * "single" so the user's workspace branch is shared unless they
   * explicitly opt into an isolated worktree for the new session.
   */
  import { t } from "$lib/i18n/index.svelte";
  import { APP_LOGO_URL } from "$lib/utils/brand-assets";
  import { relativeTime } from "$lib/utils/format";
  import AuthSourceBadge from "./AuthSourceBadge.svelte";
  import type { Snippet } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { AuthOverview, PlatformCredential } from "$lib/types";
  import type { WorkspaceOption } from "$lib/stores/workspaces-store.svelte";
  import RuntimePicker from "$lib/components/runtime/RuntimePicker.svelte";
  import type { ResolvedRuntime, SupportedRuntimeId } from "$lib/runtime";

  type CreationMode = "single" | "worktree";

  interface Props {
    lastContinuableRun?: { id: string; last_activity_at?: string; started_at: string } | null;
    onContinueSession: (runId: string) => void;
    onQuickAnalyze: (creationMode: CreationMode, runtimeId: SupportedRuntimeId) => void;
    onQuickFix: () => void;
    onQuickDaily: (creationMode: CreationMode, runtimeId: SupportedRuntimeId) => void;
    onGotoSchedule: () => void;
    initHint: Snippet;
    heroMeta: Snippet;
    authOverview: AuthOverview | null;
    authSourceLabel: string;
    authSourceCategory: string;
    apiKeySource: string;
    authMode: string;
    platformCredentials: PlatformCredential[];
    platformId: string;
    onAuthModeChange: (mode: string) => void;
    onPlatformChange: (id: string) => void;
    localProxyStatuses: Record<string, { running: boolean; needsAuth: boolean }>;
    availableWorkspaces?: WorkspaceOption[];
    selectedCwd?: string;
    onCwdChange?: (cwd: string) => void;
    onAddWorkspace?: () => void;
    runtimes?: ResolvedRuntime[];
    runtimesLoading?: boolean;
    selectedRuntime?: SupportedRuntimeId;
    onRuntimeChange?: (runtimeId: SupportedRuntimeId) => void;
    onManageRuntimes?: () => void;
  }

  let {
    lastContinuableRun,
    onContinueSession,
    onQuickAnalyze,
    onQuickFix,
    onQuickDaily,
    onGotoSchedule,
    initHint,
    heroMeta,
    authOverview,
    authSourceLabel,
    authSourceCategory,
    apiKeySource,
    authMode,
    platformCredentials,
    platformId,
    onAuthModeChange,
    onPlatformChange,
    localProxyStatuses,
    availableWorkspaces = [],
    selectedCwd = "",
    onCwdChange = (_cwd: string) => {},
    onAddWorkspace = () => {},
    runtimes = [],
    runtimesLoading = false,
    selectedRuntime = "claude",
    onRuntimeChange = (_id: SupportedRuntimeId) => {},
    onManageRuntimes,
  }: Props = $props();

  // v1.0.6 follow-up: per-new-session worktree mode picker. Lives in
  // the welcome card (was previously a global default in Settings);
  // resets to "single" each time the welcome screen remounts.
  let creationMode = $state<CreationMode>("single");
  const worktreeEnabled = $derived(creationMode === "worktree");

  function toggleWorktree() {
    creationMode = worktreeEnabled ? "single" : "worktree";
  }

  // v1.0.6 follow-up: workspace picker on the welcome card. Defaults to
  // the cwd passed in from the parent (sidebar "new session" sets it via
  // ?folder=); user can switch to any other sidebar project before clicking
  // a quick action. Closes on selection / outside-click / Escape.
  let pickerOpen = $state(false);
  const currentWorkspace = $derived(availableWorkspaces.find((w) => w.cwd === selectedCwd) ?? null);
  const showPicker = $derived(availableWorkspaces.length > 0);
  const selectedRuntimeEntry = $derived(runtimes.find((runtime) => runtime.id === selectedRuntime));
  const runtimeReady = $derived(selectedRuntimeEntry?.selectable === true && !runtimesLoading);

  function pickWorkspace(cwd: string) {
    pickerOpen = false;
    if (cwd !== selectedCwd) onCwdChange(cwd);
  }
</script>

<svelte:window
  onclick={(e) => {
    if (!pickerOpen) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("[data-workspace-picker]")) return;
    pickerOpen = false;
  }}
  onkeydown={(e) => {
    if (pickerOpen && e.key === "Escape") pickerOpen = false;
  }}
/>

<div class="flex h-full items-center justify-center">
  <div class="flex flex-col items-center max-w-lg w-full px-4 animate-slide-up">
    <!-- Logo + title -->
    <img src={APP_LOGO_URL} alt="MiWarp" class="mx-auto mb-4 h-9 w-9 rounded-xl shadow-sm" />
    <h2 class="text-lg font-semibold text-foreground mb-1 tracking-tight">
      {t("chat_welcomeTitle")}
    </h2>
    <p class="text-xs text-muted-foreground mb-6 text-center">
      {t("chat_welcomeSubtitle")}
    </p>

    <div class="w-full max-w-sm space-y-3">
      <!-- Workspace picker — shows the cwd the new session will run in.
           Defaults to the sidebar's choice (?folder=); user can switch
           to any other project from the dropdown. -->
      {#if showPicker}
        <div class="relative" data-workspace-picker>
          <button
            type="button"
            class="group/wp flex w-full items-center gap-2 rounded-lg border border-border/40 bg-background/50 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/40 hover:border-border/70"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            onclick={() => (pickerOpen = !pickerOpen)}
          >
            <Icon name="folder" size="xs" class="text-muted-foreground shrink-0" />
            <span class="text-muted-foreground/80 shrink-0">Workspace</span>
            <span class="truncate font-medium text-foreground/90 flex-1">
              {currentWorkspace?.label ?? t("sidebar_uncategorized")}
            </span>
            <svg
              class="h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform {pickerOpen
                ? 'rotate-180'
                : ''}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {#if pickerOpen}
            <div
              class="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border/60 bg-popover shadow-lg"
              role="listbox"
            >
              {#each availableWorkspaces as ws (ws.cwd || "__uncategorized__")}
                {@const active = ws.cwd === selectedCwd}
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 {active
                    ? 'bg-muted/40 text-foreground font-medium'
                    : 'text-foreground/85'}"
                  onclick={() => pickWorkspace(ws.cwd)}
                >
                  <Icon
                    name={ws.isUncategorized ? "folder-open" : "folder"}
                    size="xs"
                    class="shrink-0 {active ? 'text-primary' : 'text-muted-foreground/70'}"
                  />
                  <span class="truncate flex-1">{ws.label}</span>
                  {#if active}
                    <svg
                      class="h-3 w-3 shrink-0 text-primary"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  {/if}
                </button>
              {/each}
              <div class="my-1 h-px bg-border/40" aria-hidden="true"></div>
              <button
                type="button"
                class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground/80 transition-colors hover:bg-muted/50 hover:text-foreground"
                onclick={() => {
                  pickerOpen = false;
                  onAddWorkspace();
                }}
              >
                <svg
                  class="h-3 w-3 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span class="truncate">{t("chat_addWorkspace") || "添加工作区…"}</span>
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <RuntimePicker
        {runtimes}
        selected={selectedRuntime}
        loading={runtimesLoading}
        onchange={onRuntimeChange}
        {onManageRuntimes}
      />

      <!-- Continue last session (featured, only when a prior run exists) -->
      {#if lastContinuableRun}
        <button
          type="button"
          class="group/continue w-full flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/8 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-primary/12 hover:border-primary/50 transition-all duration-150 text-left"
          onclick={() => onContinueSession(lastContinuableRun!.id)}
        >
          <div
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              ><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg
            >
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate">{t("chat_continueLastSession")}</div>
          </div>
          <span class="text-[11px] text-muted-foreground/70 tabular-nums shrink-0">
            {relativeTime(lastContinuableRun.last_activity_at || lastContinuableRun.started_at)}
          </span>
        </button>
      {/if}

      <!-- Primary CTA: Quick Analyze (full width, prominent) -->
      <button
        type="button"
        class="group/primary w-full flex items-center gap-3.5 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/12 to-primary/4 px-4 py-3.5 text-left shadow-sm transition-all duration-200 enabled:hover:from-primary/18 enabled:hover:to-primary/8 enabled:hover:border-primary/45 enabled:hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
        onclick={() => onQuickAnalyze(creationMode, selectedRuntime)}
        disabled={!runtimeReady}
      >
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
        >
          <svg
            class="h-4.5 w-4.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            ><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg
          >
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-foreground">{t("chat_quickAnalyze")}</div>
          <div class="text-[11px] text-muted-foreground/80 leading-snug mt-0.5">
            {t("chat_quickAnalyzeHint")}
          </div>
        </div>
        <svg
          class="h-4 w-4 text-primary/60 group-hover/primary:text-primary group-hover/primary:translate-x-0.5 transition-all shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg
        >
      </button>

      <!-- 2x2 grid: 3 quick actions + worktree toggle -->
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="group/qa flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5 text-sm font-medium text-foreground/90 hover:bg-muted/40 hover:border-border/70 transition-all duration-150 text-left"
          onclick={onQuickFix}
        >
          <div
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--miwarp-status-warning)/0.12)] text-[hsl(var(--miwarp-status-warning))]"
          >
            <Icon name="wrench" size="sm" />
          </div>
          <span class="truncate">{t("chat_quickFix")}</span>
        </button>
        <button
          type="button"
          class="group/qa flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5 text-sm font-medium text-foreground/90 transition-all duration-150 text-left enabled:hover:bg-muted/40 enabled:hover:border-border/70 disabled:cursor-not-allowed disabled:opacity-50"
          onclick={() => onQuickDaily(creationMode, selectedRuntime)}
          disabled={!runtimeReady}
        >
          <div
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--miwarp-status-success)/0.12)] text-[hsl(var(--miwarp-status-success))]"
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline
                points="14 2 14 8 20 8"
              /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg
            >
          </div>
          <span class="truncate">{t("chat_quickDaily")}</span>
        </button>
        <button
          type="button"
          class="group/qa flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5 text-sm font-medium text-foreground/90 hover:bg-muted/40 hover:border-border/70 transition-all duration-150 text-left"
          onclick={onGotoSchedule}
        >
          <div
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--miwarp-accent-violet)/0.12)] text-[hsl(var(--miwarp-accent-violet))]"
          >
            <Icon name="clock" size="sm" />
          </div>
          <span class="truncate">{t("chat_quickSchedule")}</span>
        </button>

        <!-- Worktree toggle card — clicking anywhere flips the state.
             Toggle is rendered as a small switch on the right so the
             action-vs-setting distinction is visually clear. -->
        <button
          type="button"
          onclick={toggleWorktree}
          aria-pressed={worktreeEnabled}
          aria-label={t("chat_newSessionWorktreeLabel")}
          class="group/wt flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-medium text-left transition-all duration-150
            {worktreeEnabled
            ? 'border-primary/40 bg-primary/8 text-foreground shadow-sm'
            : 'border-border/40 bg-background/40 text-foreground/90 hover:bg-muted/40 hover:border-border/70'}"
        >
          <div
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors
              {worktreeEnabled
              ? 'bg-primary/15 text-primary'
              : 'bg-muted/60 text-muted-foreground'}"
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </div>
          <span class="truncate flex-1">{t("chat_newSessionWorktreeLabel")}</span>
          <span
            class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors
              {worktreeEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}"
            aria-hidden="true"
          >
            <span
              class="inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform
                {worktreeEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}"
            ></span>
          </span>
        </button>
      </div>
    </div>

    {@render initHint()}

    <!-- Footer meta (bumped contrast from 30% → 60% so the CLI/auth info
         is actually readable in the dim theme). -->
    <div class="mt-6 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/60">
      <AuthSourceBadge
        {authOverview}
        {authSourceLabel}
        {authSourceCategory}
        {apiKeySource}
        hasRun={false}
        {authMode}
        {platformCredentials}
        {platformId}
        {onAuthModeChange}
        {onPlatformChange}
        {localProxyStatuses}
        variant="hero"
      />
      <span class="text-muted-foreground/40">·</span>
      {@render heroMeta()}
    </div>
  </div>
</div>
