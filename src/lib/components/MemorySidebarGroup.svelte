<script lang="ts">
  import type { MemoryFileCandidate } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";

  let {
    label,
    files = [],
    selectedPath = "",
    expanded = false,
    tone = "project",
    onToggle,
    onSelect,
  }: {
    label: string;
    files?: MemoryFileCandidate[];
    selectedPath?: string;
    expanded?: boolean;
    tone?: "project" | "memory" | "global";
    onToggle?: () => void;
    onSelect?: (file: MemoryFileCandidate) => void;
  } = $props();

  const primaryFile = $derived(
    files.find((file) => file.path === selectedPath) ??
      files.find((file) => file.exists) ??
      files[0] ??
      null,
  );
  const newCount = $derived(files.filter((file) => !file.exists).length);
  const selectedInGroup = $derived(files.some((file) => file.path === selectedPath));

  const toneClass = $derived(
    tone === "memory"
      ? "text-amber-400"
      : tone === "global"
        ? "text-emerald-400"
        : "text-blue-400",
  );
  const toneDotClass = $derived(
    tone === "memory" ? "bg-amber-400" : tone === "global" ? "bg-emerald-400" : "bg-blue-400",
  );

  function selectPrimary() {
    if (primaryFile) onSelect?.(primaryFile);
  }
</script>

{#if files.length > 0}
  <div class="mb-0.5">
    <button
      class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors
        {selectedInGroup
        ? 'bg-sidebar-accent/35 text-sidebar-foreground'
        : 'text-sidebar-foreground hover:bg-sidebar-accent/45'}"
      onclick={onToggle}
      aria-expanded={expanded}
      title={label}
    >
      <svg
        class="h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform duration-150 {expanded
          ? 'rotate-90'
          : ''}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
      <svg
        class="h-3.5 w-3.5 shrink-0 {toneClass}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {#if tone === "global"}
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        {:else if tone === "memory"}
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
        {:else}
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        {/if}
      </svg>
      <span class="min-w-0 flex-1 truncate text-left">{label}</span>
      <span
        class="shrink-0 rounded bg-sidebar-accent/50 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
        >{files.length}</span
      >
      {#if newCount > 0}
        <span class="shrink-0 text-[10px] text-muted-foreground/70">{t("memory_new")}</span>
      {/if}
    </button>

    {#if expanded}
      <div class="pl-3">
        {#each files as file (file.path)}
          <button
            class="flex w-full items-center gap-1.5 rounded-md py-1 pl-4 pr-3 text-xs transition-colors
              {selectedPath === file.path
              ? 'bg-sidebar-accent text-sidebar-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
            onclick={() => onSelect?.(file)}
            title={file.path}
          >
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full {file.exists
                ? toneDotClass
                : 'bg-muted-foreground/35'}"
            ></span>
            <span class="min-w-0 flex-1 truncate text-left">{file.label}</span>
            {#if !file.exists}
              <span class="shrink-0 text-[10px] text-muted-foreground">{t("memory_new")}</span>
            {/if}
          </button>
        {/each}
      </div>
    {:else if primaryFile}
      <button
        class="flex w-full items-center gap-1.5 rounded-md py-1 pl-8 pr-3 text-[11px] transition-colors
          {selectedPath === primaryFile.path
          ? 'bg-sidebar-accent/70 text-sidebar-foreground'
          : 'text-muted-foreground/75 hover:bg-sidebar-accent/35 hover:text-sidebar-foreground'}"
        onclick={selectPrimary}
        title={primaryFile.path}
      >
        <span class="min-w-0 flex-1 truncate text-left">{primaryFile.label}</span>
        {#if !primaryFile.exists}
          <span class="shrink-0 text-[10px] text-muted-foreground">{t("memory_new")}</span>
        {/if}
      </button>
    {/if}
  </div>
{/if}
