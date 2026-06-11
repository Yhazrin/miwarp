<!--
  SplitPaneHeader — top chrome strip for one pane.

  Shows: status dot, run title (truncated), close button, and an "active"
  badge when this pane is the writable one. Click anywhere on the header
  to activate the pane (except the close button which stops propagation).
-->
<script lang="ts">
  import type { PaneState } from "$lib/split";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let { pane, onClose }: { pane: PaneState; onClose: () => void } = $props();

  const title = $derived.by(() => {
    const snap = pane.cachedSnapshot;
    if (snap?.run?.name) return snap.run.name;
    if (pane.cachedSnapshot === null && pane.loadState === "loading")
      return t("split_mode_loadingPane");
    return pane.runId.slice(0, 12);
  });
  const status = $derived(pane.cachedSnapshot?.run?.status ?? "pending");
  const isActive = $derived(pane.runtimeState === "active");

  function dotColor(): string {
    switch (status) {
      case "running":
      case "waiting_input":
      case "waiting_approval":
        return "hsl(var(--miwarp-status-info))";
      case "completed":
        return "hsl(var(--miwarp-status-success))";
      case "error":
      case "failed":
        return "hsl(var(--miwarp-status-error))";
      case "stopped":
        return "hsl(var(--muted-foreground))";
      default:
        return "hsl(var(--muted-foreground))";
    }
  }

  const dotAnimated = $derived(
    status === "running" || status === "waiting_input" || status === "waiting_approval",
  );
</script>

<div
  class="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-1.5 transition-colors"
  class:bg-primary={isActive}
  style:background-color={isActive ? "hsl(var(--primary) / 0.08)" : "hsl(var(--muted) / 0.3)"}
  role="presentation"
>
  <span
    class="inline-block h-[6px] w-[6px] rounded-full shrink-0 {dotAnimated
      ? 'animate-slow-pulse'
      : ''}"
    style:background-color={dotColor()}
    title={status}
    aria-hidden="true"
  ></span>
  <span class="truncate text-xs font-medium flex-1 min-w-0" {title}>
    {title}
  </span>
  {#if isActive}
    <span class="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-primary">
      {t("split_mode_activeBadge")}
    </span>
  {:else}
    <span class="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {t("split_mode_inactiveBadge")}
    </span>
  {/if}
  <button
    type="button"
    class="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    aria-label={t("split_mode_closePane")}
    title={t("split_mode_closePaneTooltip")}
    onclick={(e) => {
      e.stopPropagation();
      onClose();
    }}
  >
    <Icon name="x" size="xs" />
  </button>
</div>
