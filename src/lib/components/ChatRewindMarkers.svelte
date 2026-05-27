<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { RewindMarker } from "$lib/utils/rewind";

  interface Props {
    markers: RewindMarker[];
  }

  let { markers }: Props = $props();
</script>

{#each markers as marker, mi (marker.id)}
  <div class="w-full py-3" id={mi === markers.length - 1 ? "rewind-marker-latest" : undefined}>
    <div class="chat-content-width">
      <div class="flex items-center gap-3">
        <div class="h-px flex-1 bg-[hsl(var(--miwarp-status-info)/0.2)]"></div>
        <div class="flex items-center gap-2 text-xs text-[hsl(var(--miwarp-status-info)/0.8)] font-medium">
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <span
            >{t("rewind_separatorLabel", {
              count: String(marker.filesReverted.length),
            })}</span
          >
        </div>
        <div class="h-px flex-1 bg-[hsl(var(--miwarp-status-info)/0.2)]"></div>
      </div>
      <div class="mt-1 ml-8 text-[11px] text-muted-foreground/60 truncate">
        &ldquo;{marker.targetContent}&rdquo;
      </div>
      {#if marker.filesReverted.length > 0}
        <details class="mt-1 ml-8">
          <summary class="cursor-pointer text-[10px] text-[hsl(var(--miwarp-status-info)/0.5)] hover:text-[hsl(var(--miwarp-status-info)/0.8)]">
            {t("rewind_separatorFiles", {
              count: String(marker.filesReverted.length),
            })}
          </summary>
          <div class="mt-1 rounded bg-muted/30 px-2 py-1">
            {#each marker.filesReverted as file}
              <div class="truncate font-mono text-[10px] text-muted-foreground">
                {file}
              </div>
            {/each}
          </div>
        </details>
      {/if}
    </div>
  </div>
{/each}
