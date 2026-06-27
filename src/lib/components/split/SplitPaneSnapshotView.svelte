<!--
  SplitPaneSnapshotView — read-only inactive pane body with replayed timeline.
-->
<script lang="ts">
  import type { PaneSnapshotWithRaw } from "$lib/split";
  import SplitPaneTimelineView from "./SplitPaneTimelineView.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let { snapshot }: { snapshot: PaneSnapshotWithRaw } = $props();

  const runName = $derived(snapshot.run?.name ?? snapshot.run?.id?.slice(0, 12) ?? "—");
  const status = $derived(snapshot.run?.status ?? "pending");
</script>

<div class="flex h-full min-h-0 flex-col">
  <div
    class="shrink-0 flex items-center justify-between gap-2 border-b border-border/30 px-3 py-1.5 text-[10px] text-muted-foreground"
  >
    <span class="truncate font-medium text-foreground/80" title={runName}>{runName}</span>
    <span class="shrink-0 uppercase tracking-wide">{status}</span>
  </div>
  <div class="relative flex-1 min-h-0">
    <SplitPaneTimelineView timeline={snapshot.timeline} renderLimit={200} />
    <div
      class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-background via-background/90 to-transparent py-3 text-[11px] text-muted-foreground"
    >
      <Icon name="mouse-pointer-click" size="xs" />
      <span>{t("split_mode_readOnlyHint")}</span>
    </div>
  </div>
</div>
