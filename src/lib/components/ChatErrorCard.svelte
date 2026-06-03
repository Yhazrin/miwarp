<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { classifyError } from "$lib/stores/types";
  import Icon from "./Icon.svelte";
  import type { LucideIconName } from "$lib/lucide-icon";

  interface Props {
    error: string;
    resultSubtype?: string;
    sessionId?: string;
    phase: string;
    onDismiss: () => void;
    onRetry?: () => void;
    onFork?: () => void;
    onGotoSettings: (path: string) => void;
  }

  let {
    error,
    resultSubtype,
    sessionId,
    phase,
    onDismiss,
    onRetry,
    onFork,
    onGotoSettings,
  }: Props = $props();

  let classified = $derived(classifyError(resultSubtype, error));
  let catIconName = $derived.by((): LucideIconName => {
    switch (classified.category) {
      case "context_limit":
        return "triangle-alert";
      case "auth_issue":
        return "lock";
      case "budget_limit":
        return "target";
      case "server_issue":
        return "globe";
      case "session_timeout":
        return "timer";
      case "tool_issue":
        return "wrench";
      default:
        return "x";
    }
  });
</script>

<div
  class="absolute left-3 right-3 z-10"
  style="bottom: calc(var(--chat-input-dock-offset, 13rem) + 0.5rem)"
>
  <div
    class="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm backdrop-blur-sm animate-fade-in"
  >
    <div class="flex items-start gap-2">
      <Icon name={catIconName} size="sm" class="shrink-0 text-destructive mt-0.5" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[10px] font-medium uppercase tracking-wider text-destructive/70"
            >{t(`error_category_${classified.category}`)}</span
          >
        </div>
        <p class="text-destructive text-xs leading-relaxed break-words">{error}</p>
        <p class="text-destructive/60 text-[10px] mt-1">
          {t(`error_guidance_${classified.category}`)}
        </p>
      </div>
      <button type="button"
        class="shrink-0 text-destructive/50 hover:text-destructive text-xs"
        onclick={onDismiss}>{t("common_dismiss")}</button
      >
    </div>
    <div class="flex items-center gap-2 mt-2 pl-6">
      {#if onRetry && classified.canRetry && phase === "failed" && sessionId}
        <button type="button"
          class="rounded px-2.5 py-1 text-xs bg-destructive/20 hover:bg-destructive/30 text-destructive transition-colors"
          onclick={onRetry}>{t("common_retry")}</button
        >
      {/if}
      {#if onFork && classified.canFork && sessionId}
        <button type="button"
          class="rounded px-2.5 py-1 text-xs bg-[hsl(var(--miwarp-status-info)/0.2)] hover:bg-[hsl(var(--miwarp-status-info)/0.3)] text-miwarp-status-info transition-colors"
          onclick={onFork}>{t("statusbar_fork")}</button
        >
      {/if}
      {#if classified.settingsPath}
        <button type="button"
          class="rounded px-2.5 py-1 text-xs bg-accent hover:bg-accent/80 text-foreground transition-colors"
          onclick={() => onGotoSettings(classified.settingsPath!)}>{t("error_openSettings")}</button
        >
      {/if}
    </div>
  </div>
</div>
