<!--
  Skill Widget Renderer
  Unified rendering entry for Skill Widgets (progress, form, list, confirm)
  Inspired by Claude Cowork's widget system design
-->
<script lang="ts">
  import type { WidgetSpec } from "$lib/services/skill-executor";
  import ProgressWidget from "./widgets/ProgressWidget.svelte";
  import FormWidget from "./widgets/FormWidget.svelte";
  import ListWidget from "./widgets/ListWidget.svelte";
  import ConfirmWidget from "./widgets/ConfirmWidget.svelte";

  let {
    widget,
    onAction,
  }: {
    widget: WidgetSpec;
    onAction?: (data: any) => void;
  } = $props();
</script>

{#if widget.type === "progress"}
  <ProgressWidget data={widget.data} />
{:else if widget.type === "form"}
  <FormWidget data={widget.data} {onAction} />
{:else if widget.type === "list"}
  <ListWidget data={widget.data} />
{:else if widget.type === "confirm"}
  <ConfirmWidget data={widget.data} {onAction} />
{:else}
  <div class="text-sm text-muted-foreground">
    Unknown widget type: {widget.type}
  </div>
{/if}