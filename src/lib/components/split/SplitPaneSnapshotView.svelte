<!--
  SplitPaneSnapshotView — read-only view for an inactive pane.

  Shows the captured run metadata + a hint to activate the pane. The full
  timeline replay for inactive panes is deferred to v1.1 (see
  docs/architecture/split-workspace-v1.0.8.md §16 "不在本 PR 范围内" —
  "大 markdown / code block 延迟渲染" and "inactive pane 不显示实时事件").
  The snapshot already carries raw BusEvents on PaneSnapshotWithRaw; a
  future view layer can replay them via sessionStore reducers.
-->
<script lang="ts">
  import type { PaneSnapshotWithRaw } from "$lib/split";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let { snapshot }: { snapshot: PaneSnapshotWithRaw } = $props();

  const runName = $derived(snapshot.run?.name ?? snapshot.run?.id?.slice(0, 12) ?? "—");
  const status = $derived(snapshot.run?.status ?? "pending");
  const agent = $derived(snapshot.run?.agent ?? "");
  const eventCount = $derived(snapshot.rawBusEvents?.length ?? 0);
  const startedAt = $derived(snapshot.run?.started_at ?? null);
</script>

<div class="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
  <div class="max-w-sm space-y-4">
    <div class="space-y-1">
      <p class="text-sm font-semibold text-foreground truncate" title={runName}>
        {runName}
      </p>
      <p class="text-[11px] text-muted-foreground">
        {status}
        {#if agent}
          · {agent}{/if}
        {#if startedAt}
          · {new Date(startedAt).toLocaleDateString()}
        {/if}
      </p>
    </div>
    <div class="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-left">
      <p class="text-[11px] font-medium text-muted-foreground">
        {t("split_mode_emptyPane")}
      </p>
      <p class="mt-1 text-[10px] text-muted-foreground/70">
        {eventCount} events cached · fetched {new Date(snapshot.fetchedAt).toLocaleTimeString()}
      </p>
    </div>
    <div class="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
      <Icon name="mouse-pointer-click" size="xs" />
      <span>{t("split_mode_readOnlyHint")}</span>
    </div>
  </div>
</div>
