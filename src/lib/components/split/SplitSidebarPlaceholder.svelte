<!--
  SplitSidebarPlaceholder — shown in the right sidebar slot while split mode
  is active. Static, no fetches, no subscriptions — the whole point of
  suspending the right sidebar is to keep heavy data loaders idle while
  multiple panes are competing for the foreground.
-->
<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { exitSplitWorkspace } from "$lib/split/split-workspace-lifecycle";
</script>

<div class="flex h-full items-center justify-center px-6 text-center">
  <div class="flex w-full max-w-xs flex-col items-center gap-3">
    <Icon name="layout" size="lg" class="text-muted-foreground/40" />
    <p class="text-xs text-muted-foreground">
      {t("split_mode_sidebarSuspended")}
    </p>
    <p class="text-[11px] leading-relaxed text-muted-foreground/70">
      {t("split_mode_sidebarSuspendedHint")}
    </p>
    <button
      type="button"
      class="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:border-border hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      onclick={() => void exitSplitWorkspace({ restoreRun: true })}
    >
      <Icon name="x" size="xs" />
      {t("split_mode_exit")}
    </button>
  </div>
</div>
