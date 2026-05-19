<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { getToolColor } from "$lib/utils/tool-colors";

  interface Props {
    toolNames: string[];
    activeFilter: string | null;
    onFilterChange: (filter: string | null) => void;
  }

  let { toolNames, activeFilter, onFilterChange }: Props = $props();
</script>

{#if toolNames.length >= 2}
  <div class="chat-content-width py-2" data-export-exclude>
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        class="rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors {!activeFilter
          ? 'bg-foreground/10 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
        onclick={() => onFilterChange(null)}>{t("chat_filterAll")}</button
      >
      {#each toolNames as name}
        {@const style = getToolColor(name)}
        <button
          class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors {activeFilter ===
          name
            ? style.bg + ' ' + style.text
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
          onclick={() => onFilterChange(activeFilter === name ? null : name)}
        >
          <svg
            class="h-2.5 w-2.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d={style.icon} />
          </svg>
          {name}
        </button>
      {/each}
    </div>
  </div>
{/if}
