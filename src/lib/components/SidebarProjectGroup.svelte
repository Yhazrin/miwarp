<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ProjectFolder } from "$lib/utils/sidebar-groups";
  import { t } from "$lib/i18n/index.svelte";
  import { slide } from "svelte/transition";
  import Icon from "$lib/components/Icon.svelte";

  interface Props {
    folder: ProjectFolder;
    label: string;
    expanded?: boolean;
    showCount?: boolean;
    showRemove?: boolean;
    onToggle?: () => void;
    onRemove?: () => void;
    onNewChat?: () => void;
    children?: Snippet;
  }

  let {
    folder,
    label,
    expanded = false,
    showCount = true,
    showRemove = false,
    onToggle,
    onRemove,
    onNewChat,
    children,
  }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle?.();
    }
  }
</script>

<div class="group/folder mb-1">
  <!-- Folder header -->
  <div
    class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/30 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    role="button"
    tabindex="0"
    onclick={() => onToggle?.()}
    onkeydown={handleKeydown}
    title={folder.isUncategorized ? label : folder.cwd}
    aria-expanded={expanded}
    aria-label={label}
  >
    <!-- Chevron -->
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

    <!-- Folder / Inbox icon -->
    {#if folder.isUncategorized}
      <svg
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path
          d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
        />
      </svg>
    {:else}
      <Icon name="folder" size="sm" class="shrink-0 text-muted-foreground/70" />
    {/if}

    <!-- Label -->
    <span class="truncate">{label}</span>

    <!-- Count badge -->
    {#if showCount && folder.conversationCount > 0}
      <span
        class="shrink-0 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-muted/60 px-1 text-[10px] font-normal text-muted-foreground/60 {showRemove
          ? ''
          : 'ml-auto'}"
      >
        {folder.conversationCount}
      </span>
    {/if}

    <!-- Remove button -->
    {#if showRemove && onRemove}
      <button type="button"
        class="ml-auto shrink-0 flex h-4 w-4 items-center justify-center rounded opacity-0 text-muted-foreground hover:text-destructive hover:opacity-100 focus-visible:opacity-100 group-hover/folder:opacity-100 transition-opacity"
        aria-label={t("sidebar_removeProject")}
        onclick={(e) => {
          e.stopPropagation();
          onRemove?.();
        }}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            onRemove?.();
          }
        }}
      >
        <Icon name="x" size="xs" />
      </button>
    {/if}
  </div>

  <!-- Expanded children -->
  {#if expanded}
    <div class="pl-3" transition:slide={{ duration: 200 }}>
      {#if onNewChat}
        <button type="button"
          class="flex w-full items-center gap-1.5 px-2.5 py-0.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-sidebar-accent/20 rounded-md transition-colors"
          onclick={(e) => {
            e.stopPropagation();
            onNewChat?.();
          }}
        >
          <Icon name="plus" size="xs" class="shrink-0" />
          <span>{t("sidebar_newChat")}</span>
        </button>
      {/if}
      {@render children?.()}
    </div>
  {/if}
</div>
