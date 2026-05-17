<script lang="ts">
  import type { ProjectFolder } from "$lib/utils/sidebar-groups";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/icons/Icon.svelte";

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
      <Icon name="folder" size={14} class="shrink-0 text-muted-foreground/70" />
      <span class="min-w-0 truncate text-sidebar-foreground"
        >{projectCwd ? cwdLabel(projectCwd) : t("sidebar_selectProjectBrowse")}</span
      >
      <Icon
        name="chevronDown"
        size={12}
        class="ml-auto shrink-0 text-muted-foreground/50 transition-transform {pickerOpen
          ? 'rotate-180'
          : ''}"
      />
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
            <Icon name="folder" size={12} class="shrink-0 text-muted-foreground/70" />
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
          <Icon name="plus" size={12} class="shrink-0" />
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
    <Icon name="plus" size={14} class="shrink-0" />
    <span>{t("project_openFolder")}</span>
  </button>
{/if}
