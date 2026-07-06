<!--
  PluginsSidebarBody — section nav for `/plugins`. Lazy-loaded.
-->
<script lang="ts">
  import type { PluginSection } from "$lib/utils/plugin-sections";

  interface Props {
    pluginActiveSection: string;
    pluginSections: PluginSection[];
    onPluginSectionChange: (sectionId: string) => void;
  }

  let {
    pluginActiveSection = "",
    pluginSections = [],
    onPluginSectionChange = () => {},
  }: Props = $props();
</script>

<div class="flex-1 overflow-y-auto py-2">
  {#each pluginSections as section}
    {@const isActive = pluginActiveSection === section.id}
    <button
      type="button"
      class="flex w-full items-center gap-2 py-2 px-3 text-xs font-medium transition-colors
            {isActive
        ? 'bg-sidebar-accent text-sidebar-foreground'
        : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
      onclick={() => onPluginSectionChange(section.id)}
    >
      {#if section.icon === "overview"}
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><rect width="7" height="7" x="3" y="3" rx="1" /><rect
            width="7"
            height="7"
            x="14"
            y="3"
            rx="1"
          /><rect width="7" height="7" x="14" y="14" rx="1" /><rect
            width="7"
            height="7"
            x="3"
            y="14"
            rx="1"
          /></svg
        >
      {:else if section.icon === "sparkles"}
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path
            d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"
          /></svg
        >
      {:else if section.icon === "sources"}
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path
            d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
          /><path d="M8 7h8" /><path d="M8 11h8" /></svg
        >
      {:else if section.icon === "server"}
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect
            width="20"
            height="8"
            x="2"
            y="14"
            rx="2"
            ry="2"
          /><line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" /></svg
        >
      {:else if section.icon === "webhook"}
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path
            d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"
          /><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /><path
            d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8H12"
          /></svg
        >
      {:else if section.icon === "package"}
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="m7.5 4.27 9 5.15" /><path
            d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
          /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg
        >
      {:else if section.icon === "agents"}
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path
            d="M2 14h2"
          /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg
        >
      {/if}
      <span class="min-w-0 truncate">{section.label()}</span>
    </button>
  {/each}
</div>
