<script lang="ts">
  /**
   * v1.0.6 follow-up: layout shell shared by all `SettingsField*` variants.
   * Renders label + description + optional override badge + children (the
   * actual control) on the right. Pure layout — no state.
   */
  import SettingsOverrideBadge from "./SettingsOverrideBadge.svelte";
  import SettingsSavedIndicator from "./SettingsSavedIndicator.svelte";

  let {
    label,
    description = "",
    overrideBadge = "",
    savedIndicator = false,
    align = "between",
    children,
  }: {
    label?: string;
    description?: string;
    overrideBadge?: string;
    savedIndicator?: boolean;
    align?: "between" | "start";
    children?: import("svelte").Snippet;
  } = $props();
</script>

<div class="flex flex-col gap-1">
  {#if savedIndicator}
    <SettingsSavedIndicator />
  {/if}
  <div
    class="flex {align === 'between' ? 'items-center justify-between' : 'items-start gap-3'} gap-4 py-1.5"
  >
    {#if label || description || overrideBadge}
      <div class="flex items-start gap-2 min-w-0 flex-1">
        <div class="min-w-0 flex-1">
          {#if label}
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-foreground">{label}</span>
              {#if overrideBadge}
                <SettingsOverrideBadge label={overrideBadge} />
              {/if}
            </div>
          {/if}
          {#if description}
            <p class="text-xs text-muted-foreground mt-0.5">{description}</p>
          {/if}
        </div>
      </div>
    {/if}
    {#if children}
      <div class="shrink-0">
        {@render children()}
      </div>
    {/if}
  </div>
</div>
