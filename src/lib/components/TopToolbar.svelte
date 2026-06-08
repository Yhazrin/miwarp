<script lang="ts">
  /**
   * v1.0.6 / 5.1: Top toolbar with collapsible layout.
   *
   * Collapsed: 4 core icons centered.
   * Expanded:  core stays centered; left/right groups flank with dividers.
   *
   *  ┌─────────────────────────────────────────────┐
   *  │  [files] [memory] [history]  ┃  [+] [📂] [🤖] [⚡]  ┃  [✓] [⏰] [📦] [⚙]  [▼]  │
   *  └─────────────────────────────────────────────┘
   *                 left           ┃       core       ┃       right       toggle
   */
  import { goto } from "$app/navigation";
  import { EVT_NEW_SESSION, EVT_TOGGLE_PROGRESS_PANEL } from "$lib/utils/bus-events";
  import {
    CORE_ICONS,
    TOOLBAR_GROUPS,
    type ToolbarIconDef,
    type ToolbarIconId,
  } from "$lib/config/toolbar-icons";
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

  function handleClick(id: ToolbarIconId, href: string | null) {
    if (id === "new-session") {
      window.dispatchEvent(new CustomEvent(EVT_NEW_SESSION));
      return;
    }
    if (id === "progress") {
      window.dispatchEvent(new CustomEvent(EVT_TOGGLE_PROGRESS_PANEL));
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

  function renderIcon(def: ToolbarIconDef) {
    return def;
  }
</script>

<div class="mi-topbar flex flex-col gap-1.5">
  {#if collapsed}
    <!-- Collapsed: 4 core icons centered + toggle on the right -->
    <div class="flex items-center justify-center gap-1">
      {#each CORE_ICONS as icon (icon.id)}
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
        class="mi-topbar-btn ml-2"
        title={lk("toolbar_expand")}
        aria-label={lk("toolbar_expand")}
        aria-expanded={false}
        onclick={toggle}
      >
        <span class="inline-flex transition-transform duration-150">
          <Icon name="chevron-down" size="sm" />
        </span>
      </button>
    </div>
  {:else}
    <!-- Expanded: left ┃ core ┃ right ┃ toggle -->
    <div class="flex items-center gap-1">
      <!-- Left group -->
      {#each TOOLBAR_GROUPS.left as icon (icon.id)}
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

      <!-- Divider -->
      <div class="mx-0.5 h-4 w-px shrink-0 bg-border/50" aria-hidden="true"></div>

      <!-- Core group (stays in center position) -->
      {#each CORE_ICONS as icon (icon.id)}
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

      <!-- Divider -->
      <div class="mx-0.5 h-4 w-px shrink-0 bg-border/50" aria-hidden="true"></div>

      <!-- Right group -->
      {#each TOOLBAR_GROUPS.right as icon (icon.id)}
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

      <!-- Toggle (collapse) -->
      <button
        type="button"
        class="mi-topbar-btn ml-auto"
        title={lk("toolbar_collapse")}
        aria-label={lk("toolbar_collapse")}
        aria-expanded={true}
        onclick={toggle}
      >
        <span class="inline-flex rotate-180 transition-transform duration-150">
          <Icon name="chevron-down" size="sm" />
        </span>
      </button>
    </div>
  {/if}

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
    transition:
      background-color 150ms ease,
      color 150ms ease;
  }
  :global(.mi-topbar-btn:hover) {
    background-color: hsl(var(--sidebar-accent) / 0.6);
    color: hsl(var(--sidebar-foreground));
  }
  :global(.mi-topbar-capsule-row) {
    container-type: inline-size;
  }
</style>
