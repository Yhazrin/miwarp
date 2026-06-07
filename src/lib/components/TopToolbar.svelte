<script lang="ts">
  /**
   * v1.0.6 / 5.1: top toolbar with collapsible row 1 (5→11 icons) and
   * a context capsule on row 2. State is persisted via the parent
   * (which calls the localStorage adapter `ocv:topbar.collapsed`).
   */
  import { goto } from "$app/navigation";
  import { COLLAPSED_VISIBLE_COUNT, TOOLBAR_ICONS, type ToolbarIconId } from "$lib/config/toolbar-icons";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";

  let {
    collapsed = $bindable(false),
    contextCapsule = null,
  }: {
    collapsed?: boolean;
    contextCapsule?: import("svelte").Snippet | null;
  } = $props();

  const visible = $derived(
    collapsed ? TOOLBAR_ICONS.slice(0, COLLAPSED_VISIBLE_COUNT) : TOOLBAR_ICONS,
  );

  function handleClick(id: ToolbarIconId, href: string | null) {
    if (id === "new-session") {
      window.dispatchEvent(new CustomEvent("ocv:new-session"));
      return;
    }
    if (id === "progress") {
      window.dispatchEvent(new CustomEvent("ocv:toggle-progress-panel"));
      return;
    }
    if (href) void goto(href);
  }

  function toggle() {
    collapsed = !collapsed;
  }

  function lk(key: string): string {
    return t(key as MessageKey);
  }
</script>

<div class="mi-topbar flex flex-col gap-1.5">
  <div class="flex flex-wrap items-center gap-1">
    {#each visible as icon (icon.id)}
      <button
        type="button"
        class="mi-topbar-btn"
        title={lk(icon.labelKey)}
        aria-label={lk(icon.labelKey)}
        onclick={() => handleClick(icon.id, icon.href)}
      >
        <Icon name={icon.icon} size="sm" />
      </button>
    {/each}
    <button
      type="button"
      class="mi-topbar-btn ml-auto"
      title={collapsed ? lk("toolbar_expand") : lk("toolbar_collapse")}
      aria-label={collapsed ? lk("toolbar_expand") : lk("toolbar_collapse")}
      aria-expanded={!collapsed}
      onclick={toggle}
    >
      <span class="inline-flex transition-transform duration-150" class:rotate-180={!collapsed}>
        <Icon name="chevron-down" size="sm" />
      </span>
    </button>
  </div>
  {#if contextCapsule}
    <div class="mi-topbar-capsule-row w-full">
      {@render contextCapsule()}
    </div>
  {/if}
</div>

<style>
  :global(.mi-topbar-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 9999px;
    color: hsl(var(--sidebar-foreground) / 0.85);
    transition: background-color 150ms ease, color 150ms ease;
  }
  :global(.mi-topbar-btn:hover) {
    background-color: hsl(var(--sidebar-accent) / 0.6);
    color: hsl(var(--sidebar-foreground));
  }
  :global(.mi-topbar-capsule-row) {
    container-type: inline-size;
  }
</style>
