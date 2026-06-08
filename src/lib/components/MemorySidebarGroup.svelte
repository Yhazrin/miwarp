<script lang="ts">
  /**
   * v1.0.6 / 5.6: Memory sidebar group component.
   * Renders memory files grouped by scope (project folders + global),
   * with expand/collapse and file selection.
   */
  import type { MemoryFileCandidate } from "$lib/types";
  import { filterVisibleCandidates } from "$lib/utils/memory-helpers";
  import Spinner from "./Spinner.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let {
    candidates = [],
    selectedFile = "",
    loading = false,
    expanded = $bindable({}),
    onSelectFile,
  }: {
    candidates: MemoryFileCandidate[];
    selectedFile: string;
    loading?: boolean;
    expanded?: Record<string, boolean>;
    onSelectFile?: (file: MemoryFileCandidate) => void;
  } = $props();

  // Partition by scope
  const projectFiles = $derived(candidates.filter((c) => c.scope === "project" || c.scope === "memory"));
  const globalFiles = $derived(candidates.filter((c) => c.scope === "global"));

  function toggleScope(scope: string) {
    expanded = { ...expanded, [scope]: !expanded[scope] };
  }

  function fileIconClass(file: MemoryFileCandidate): string {
    if (file.scope === "memory") return "text-miwarp-status-warning";
    if (file.exists) return "text-miwarp-status-info";
    return "text-muted-foreground/40";
  }
</script>

{#if loading}
  <div class="flex items-center justify-center py-6">
    <Spinner size="sm" />
  </div>
{:else if projectFiles.length > 0}
  {#each filterVisibleCandidates(projectFiles, true, selectedFile) as file (file.path)}
    <button
      type="button"
      class="flex w-full items-center gap-1.5 py-1 pl-4 pr-3 text-xs transition-colors
        {selectedFile === file.path
          ? 'bg-sidebar-accent text-sidebar-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
      onclick={() => onSelectFile?.(file)}
      title={file.path}
    >
      <svg
        class="h-3 w-3 shrink-0 {fileIconClass(file)}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path
          d="M14 2v4a2 2 0 0 0 2 2h4"
        /></svg
      >
      <span class="min-w-0 truncate">{file.label}</span>
      {#if !file.exists}
        <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">{t("memory_new")}</span>
      {/if}
    </button>
  {/each}
{:else}
  <p class="px-2 py-3 text-xs text-muted-foreground">
    {t("memory_noProjectFiles")}
  </p>
{/if}

{#if globalFiles.length > 0}
  <div class="mb-0.5">
    <button
      type="button"
      class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50"
      onclick={() => toggleScope("global")}
    >
      <svg
        class="h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform duration-150 {expanded['global']
          ? 'rotate-90'
          : ''}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg
      >
      <svg
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path
          d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
        /></svg
      >
      <span class="truncate">{t("memory_tabGlobal")}</span>
    </button>
    {#if expanded["global"]}
      <div class="pl-3">
        {#each filterVisibleCandidates(globalFiles, true, selectedFile) as file (file.path)}
          <button
            type="button"
            class="flex w-full items-center gap-1.5 py-1 pl-4 pr-3 text-xs transition-colors
              {selectedFile === file.path
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
            onclick={() => onSelectFile?.(file)}
            title={file.path}
          >
            <svg
              class="h-3 w-3 shrink-0 {file.exists ? 'text-miwarp-status-info' : 'text-muted-foreground/40'}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path
                d="M14 2v4a2 2 0 0 0 2 2h4"
              /></svg
            >
            <span class="min-w-0 truncate">{file.label}</span>
            {#if !file.exists}
              <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">{t("memory_new")}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
