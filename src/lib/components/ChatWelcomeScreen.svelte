<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { APP_LOGO_URL } from "$lib/utils/brand-assets";
  import { relativeTime } from "$lib/utils/format";
  import AuthSourceBadge from "./AuthSourceBadge.svelte";
  import type { Snippet } from "svelte";
  import type { AuthOverview, PlatformCredential } from "$lib/types";

  interface Props {
    lastContinuableRun?: { id: string; last_activity_at?: string; started_at: string } | null;
    onContinueSession: (runId: string) => void;
    onQuickAnalyze: () => void;
    onQuickFix: () => void;
    onQuickDaily: () => void;
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
  }: Props = $props();
</script>

<div class="flex h-full items-center justify-center">
  <div class="flex flex-col items-center max-w-lg w-full px-4 animate-slide-up">
    <!-- Logo + title -->
    <img src={APP_LOGO_URL} alt="MiWarp" class="mx-auto mb-3 h-8 w-8 rounded-lg" />
    <h2 class="text-base font-medium text-foreground mb-1">
      {t("chat_welcomeTitle")}
    </h2>
    <p class="text-xs text-muted-foreground mb-5">{t("chat_welcomeSubtitle")}</p>

    <!-- Quick actions -->
    <div class="w-full max-w-sm space-y-2">
      {#if lastContinuableRun}
        <button
          class="w-full flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-2.5 text-sm text-foreground hover:bg-muted/50 hover:border-border transition-all duration-150 text-left"
          onclick={() => onContinueSession(lastContinuableRun!.id)}
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
        onclick={onQuickAnalyze}
      >
        <svg
          class="h-4 w-4 shrink-0 text-[hsl(var(--miwarp-status-info)/0.7)]"
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
        onclick={onQuickFix}
      >
        <svg
          class="h-4 w-4 shrink-0 text-[hsl(var(--miwarp-status-warning)/0.7)]"
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
        onclick={onQuickDaily}
      >
        <svg
          class="h-4 w-4 shrink-0 text-[hsl(var(--miwarp-status-success)/0.7)]"
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
        onclick={onGotoSchedule}
      >
        <svg
          class="h-4 w-4 shrink-0 text-[hsl(var(--miwarp-accent-violet)/0.7)]"
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
    </div>

    {@render initHint()}

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
      <span class="text-muted-foreground/30">·</span>
      {@render heroMeta()}
    </div>
  </div>
</div>
