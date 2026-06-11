<!--
  SplitSidebarPlaceholder — shown in the right sidebar slot while split mode
  is active. Static, no fetches, no subscriptions — the whole point of
  suspending the right sidebar is to keep heavy data loaders idle while
  multiple panes are competing for the foreground.
-->
<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
</script>

<div class="flex h-full items-center justify-center px-6 text-center">
  <div class="space-y-2 max-w-xs">
    <Icon name="layout" size="lg" class="mx-auto text-muted-foreground/40" />
    <p class="text-xs text-muted-foreground">
      {t("split_mode_sidebarSuspended")}
    </p>
  </div>
</div>
