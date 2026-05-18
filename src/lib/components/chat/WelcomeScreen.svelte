<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { relativeTime } from "$lib/utils/format";
  import { dbg } from "$lib/utils/debug";
  import AuthSourceBadge from "$lib/components/AuthSourceBadge.svelte";
  import type { TaskRun, AuthOverview, RemoteHost } from "$lib/types";

  interface Props {
    welcomeQuickActionsReady: boolean;
    lastContinuableRun: TaskRun | null;
    showInitHint: boolean;
    authOverview: AuthOverview | null;
    authSourceLabel: string;
    authSourceCategory: string;
    apiKeySource: string;
    authMode: string;
    platformCredentials: any[];
    platformId: string;
    localProxyStatuses: Record<string, { running: boolean; needsAuth: boolean }>;
    cliVersionInfo: {
      installed?: string;
      channel?: string;
      stable?: string;
      latest?: string;
    } | null;
    channelLatest: string | undefined;
    remoteHosts: RemoteHost[];
    remoteHostName: string | null;
    targetDropdownOpen: boolean;
    onSendMessage: (text: string, attachments: any[]) => void;
    onFillPrompt: (text: string) => void;
    onGoto: (path: string) => void;
    onDismissInitHint: () => void;
    onAuthModeChange: (mode: string) => void;
    onPlatformChange: (platformId: string) => void;
    onTargetChange: (hostName: string | null) => void;
    onTargetDropdownToggle: () => void;
    onTargetDropdownClose: () => void;
  }

  let {
    welcomeQuickActionsReady,
    lastContinuableRun,
    showInitHint,
    authOverview,
    authSourceLabel,
    authSourceCategory,
    apiKeySource,
    authMode,
    platformCredentials,
    platformId,
    localProxyStatuses,
    cliVersionInfo,
    channelLatest,
    remoteHosts,
    remoteHostName,
    targetDropdownOpen,
    onSendMessage,
    onFillPrompt,
    onGoto,
    onDismissInitHint,
    onAuthModeChange,
    onPlatformChange,
    onTargetChange,
    onTargetDropdownToggle,
    onTargetDropdownClose,
  }: Props = $props();

  function handleTargetSelect(name: string | null) {
    onTargetChange(name);
    dbg("chat", "target changed", name ?? "local");
  }
</script>

{#snippet initHintCard()}
  {#if showInitHint}
    <div class="mt-3 flex items-center gap-2 text-[11px] text-amber-400/80">
      <svg
        class="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 9v4" /><path d="M12 17h.01" />
        <path d="M3.6 15.4 10.2 4a2 2 0 0 1 3.6 0l6.6 11.4a2 2 0 0 1-1.8 3H5.4a2 2 0 0 1-1.8-3Z" />
      </svg>
      <span>
        Run
        <button
          class="font-mono text-amber-300 hover:text-amber-200 underline underline-offset-2 transition-colors"
          onclick={() => onSendMessage("/init", [])}>{t("chat_initHintAction")}</button
        >
        to create CLAUDE.md
      </span>
      <button
        class="ml-auto text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
        onclick={onDismissInitHint}
        title={t("chat_initHintDismiss")}
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
    </div>
  {/if}
{/snippet}

{#snippet heroMetaItems()}
  {@const hasUpdate = !!(
    cliVersionInfo?.installed &&
    channelLatest &&
    cliVersionInfo.installed !== channelLatest
  )}
  {#if cliVersionInfo?.installed}
    <button
      class="tabular-nums hover:text-muted-foreground transition-colors"
      onclick={() => onGoto("/release-notes")}
    >
      {t("chat_cliVersion").replace("{version}", cliVersionInfo.installed)}
    </button>
    {#if hasUpdate}
      <span class="text-primary/70">&middot;</span>
      <button
        class="text-primary/70 hover:text-primary transition-colors"
        onclick={() => onGoto("/release-notes")}
        title={t("chat_cliUpdateAvailable").replace("{version}", channelLatest!)}
      >
        {t("chat_cliUpdateAvailable").replace("{version}", channelLatest!)}
      </button>
    {/if}
  {/if}
  {#if remoteHosts.length > 0}
    {#if cliVersionInfo?.installed}
      <span class="text-muted-foreground">&middot;</span>
    {/if}
    <div class="relative inline-flex items-center">
      {#if targetDropdownOpen}
        <div
          class="fixed inset-0 z-40"
          data-no-drag
          data-clickable
          role="presentation"
          onclick={onTargetDropdownClose}
        ></div>
      {/if}
      <button
        type="button"
        class="inline-flex items-center gap-1 cursor-pointer text-xs {remoteHostName
          ? 'text-blue-400/70 hover:text-blue-400'
          : 'text-muted-foreground hover:text-foreground'} transition-colors"
        onclick={onTargetDropdownToggle}
      >
        <svg
          class="h-3 w-3 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect width="20" height="14" x="2" y="3" rx="2" /><line
            x1="8"
            y1="21"
            x2="16"
            y2="21"
          /><line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <span>{remoteHostName || t("chat_local")}</span>
        <svg
          class="h-2.5 w-2.5 opacity-60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"><path d="m6 9 6 6 6-6" /></svg
        >
      </button>
      {#if targetDropdownOpen}
        <div
          class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded-md border border-border bg-popover py-1 shadow-md z-50"
        >
          <button
            class="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs {!remoteHostName
              ? 'text-foreground font-medium'
              : 'text-foreground/70 hover:bg-accent'} transition-colors"
            onclick={() => handleTargetSelect(null)}
          >
            {t("chat_local")}
          </button>
          {#each remoteHosts as host (host.name)}
            <button
              class="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs {remoteHostName ===
              host.name
                ? 'text-foreground font-medium'
                : 'text-foreground/70 hover:bg-accent'} transition-colors"
              onclick={() => handleTargetSelect(host.name)}
            >
              {host.name} ({host.user}@{host.host})
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="flex h-full items-center justify-center">
  <div class="flex flex-col items-center max-w-lg w-full px-4 animate-slide-up">
    <!-- Logo + title -->
    <img src="/light.png" alt="MiWarp" class="mx-auto mb-3 h-8 w-8 rounded-lg" />
    <h2 class="text-base font-medium text-foreground mb-1">{t("chat_welcomeTitle")}</h2>
    <p class="text-xs text-muted-foreground mb-5">{t("chat_welcomeSubtitle")}</p>

    <!-- Quick actions (gate on listRuns -- avoids layout jump when "Continue" inserts) -->
    <div class="w-full max-w-sm space-y-2" aria-busy={!welcomeQuickActionsReady}>
      {#if !welcomeQuickActionsReady}
        <span class="sr-only">{t("chat_welcomeQuickActionsLoading")}</span>
        <div class="space-y-2" aria-hidden="true">
          {#each [1, 2, 3, 4, 5] as _}
            <div
              class="h-11 w-full rounded-lg bg-muted/40 animate-pulse border border-border/20"
            ></div>
          {/each}
        </div>
      {:else}
        {#if lastContinuableRun}
          <button
            class="w-full flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-2.5 text-sm text-foreground hover:bg-muted/50 hover:border-border transition-all duration-150 text-left"
            onclick={() => onGoto(`/chat?run=${lastContinuableRun!.id}&resume=continue`)}
          >
            <svg
              class="h-4 w-4 shrink-0 text-primary/70"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg
            >
            <span class="truncate">{t("chat_continueLastSession")}</span>
            <span class="ml-auto text-[11px] text-muted-foreground/60 shrink-0"
              >{relativeTime(
                lastContinuableRun.last_activity_at || lastContinuableRun.started_at,
              )}</span
            >
          </button>
        {/if}
        <button
          class="w-full flex items-center gap-3 rounded-lg border border-border/40 px-3.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/30 hover:border-border/60 hover:text-foreground transition-all duration-150 text-left"
          onclick={() => onSendMessage(t("chat_quickAnalyzePrompt"), [])}
        >
          <svg
            class="h-4 w-4 shrink-0 text-blue-400/70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M21 12a9 9 0 1 1-6.219-8.56" /><circle cx="12" cy="12" r="1" /></svg
          >
          <span>{t("chat_quickAnalyze")}</span>
        </button>
        <button
          class="w-full flex items-center gap-3 rounded-lg border border-border/40 px-3.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/30 hover:border-border/60 hover:text-foreground transition-all duration-150 text-left"
          onclick={() => onFillPrompt(t("chat_quickFixPrompt"))}
        >
          <svg
            class="h-4 w-4 shrink-0 text-amber-400/70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            /></svg
          >
          <span>{t("chat_quickFix")}</span>
        </button>
        <button
          class="w-full flex items-center gap-3 rounded-lg border border-border/40 px-3.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/30 hover:border-border/60 hover:text-foreground transition-all duration-150 text-left"
          onclick={() => onSendMessage(t("chat_quickDailyPrompt"), [])}
        >
          <svg
            class="h-4 w-4 shrink-0 text-green-400/70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline
              points="14 2 14 8 20 8"
            /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg
          >
          <span>{t("chat_quickDaily")}</span>
        </button>
        <button
          class="w-full flex items-center gap-3 rounded-lg border border-border/40 px-3.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/30 hover:border-border/60 hover:text-foreground transition-all duration-150 text-left"
          onclick={() => onGoto("/scheduled-tasks")}
        >
          <svg
            class="h-4 w-4 shrink-0 text-violet-400/70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg
          >
          <span>{t("chat_quickSchedule")}</span>
        </button>
      {/if}
    </div>

    {@render initHintCard()}

    <!-- Footer meta -->
    <div class="mt-5 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/30">
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
      <span class="text-muted-foreground/30">&middot;</span>
      {@render heroMetaItems()}
    </div>
  </div>
</div>
