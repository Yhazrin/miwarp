<script lang="ts">
  import type { ProjectFolder } from "$lib/utils/sidebar-groups";
  import { t } from "$lib/i18n/index.svelte";

  type Variant = "open-folder-row" | "compact-picker";

  let {
    variant,
    folders = [],
    projectCwd = "",
    pickerOpen = $bindable(false),
    cwdLabel = (cwd: string) => cwd,
    onSelectFolder,
    onPickFolder,
    buttonClass = "",
  }: {
    variant: Variant;
    folders?: ProjectFolder[];
    projectCwd?: string;
    pickerOpen?: boolean;
    cwdLabel?: (cwd: string) => string;
    onSelectFolder?: (cwd: string) => void;
    onPickFolder: () => void;
    /** Extra classes for the open-folder-row variant */
    buttonClass?: string;
  } = $props();
</script>

{#if variant === "compact-picker"}
  <div class="relative shrink-0 border-b border-sidebar-border">
    <button
      type="button"
      class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors hover:bg-sidebar-accent/50"
      onclick={() => (pickerOpen = !pickerOpen)}
    >
      <svg
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path
          d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
        /></svg
      >
      <span class="min-w-0 truncate text-sidebar-foreground"
        >{projectCwd ? cwdLabel(projectCwd) : t("sidebar_selectProjectBrowse")}</span
      >
      <svg
        class="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform {pickerOpen
          ? 'rotate-180'
          : ''}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
      >
    </button>
    {#if pickerOpen}
      <div class="border-b border-sidebar-border bg-sidebar">
        {#each folders as folder (folder.folderKey)}
          <button
            type="button"
            class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors
              {folder.cwd === projectCwd
              ? 'bg-sidebar-accent text-sidebar-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
            onclick={() => {
              onSelectFolder?.(folder.cwd);
              pickerOpen = false;
            }}
          >
            <svg
              class="h-3 w-3 shrink-0 text-muted-foreground/70"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              /></svg
            >
            <span class="min-w-0 truncate">{cwdLabel(folder.cwd)}</span>
          </button>
        {/each}
        <button
          type="button"
          class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          onclick={() => {
            onPickFolder();
            pickerOpen = false;
          }}
        >
          <svg
            class="h-3 w-3 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg
          >
          <span>{t("project_openFolder")}</span>
        </button>
      </div>
    {/if}
  </div>
{:else}
  <button
    type="button"
    class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors {buttonClass}"
    onclick={() => onPickFolder()}
  >
    <svg
      class="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg
    >
    <span>{t("project_openFolder")}</span>
  </button>
{/if}
