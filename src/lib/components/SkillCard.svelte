<script lang="ts">
  import type { Skill } from "$lib/types/skill";
  import { scale } from "svelte/transition";
  import { t } from "$lib/i18n/index.svelte";
  import { SKILL_CATEGORIES } from "$lib/types/skill";
  import { dbg } from "$lib/utils/debug";
  import SkillPreviewDialog from "./SkillPreviewDialog.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    skill: Skill;
    onSelect?: (skill: Skill) => void;
    onEdit?: (skill: Skill) => void;
    onDelete?: (skill: Skill) => void;
    compact?: boolean;
  }

  let { skill, onSelect, onEdit, onDelete, compact = false }: Props = $props();

  let showMenu = $state(false);
  let menuEl: HTMLDivElement | undefined = $state();
  let showPreview = $state(false);
  let previewArgs = $state("");

  const categoryInfo = $derived(
    SKILL_CATEGORIES.find((c) => c.value === skill.category) ||
      SKILL_CATEGORIES.find((c) => c.value === "custom") ||
      SKILL_CATEGORIES[0],
  );

  function handleSelect() {
    dbg("skill-card", "select", { name: skill.name });
    onSelect?.(skill);
  }

  function handleEdit() {
    showMenu = false;
    onEdit?.(skill);
  }

  function handleDelete() {
    showMenu = false;
    onDelete?.(skill);
  }

  function toggleMenu(e: Event) {
    e.stopPropagation();
    showMenu = !showMenu;
  }

  function handlePreview(e: Event) {
    e.stopPropagation();
    showPreview = true;
  }

  function handleConfirm(skill: Skill, _args: string) {
    showPreview = false;
    onSelect?.(skill);
  }

  function _formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
</script>

<div
  class="group relative rounded-lg border bg-card transition-all duration-200
    hover:border-primary/50 hover:shadow-md
    {compact ? 'p-3' : 'p-4'}"
>
  <!-- Header -->
  <div class="flex items-start justify-between gap-3">
    <!-- Icon and name -->
    <button class="flex items-center gap-2 text-left flex-1 min-w-0" onclick={handleSelect}>
      <span class="text-xl shrink-0">{skill.icon || "✨"}</span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-medium text-foreground truncate">/{skill.name}</span>
          {#if skill.isBuiltIn}
            <span
              class="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
            >
              Built-in
            </span>
          {/if}
        </div>
        {#if !compact}
          <p class="text-sm text-muted-foreground line-clamp-2 mt-0.5">
            {skill.description}
          </p>
        {/if}
      </div>
    </button>

    <!-- Menu button (for custom skills) -->
    {#if !skill.isBuiltIn}
      <div bind:this={menuEl} class="relative shrink-0">
        <button
          class="opacity-0 group-hover:opacity-100 rounded-md p-1 hover:bg-accent transition-all"
          onclick={toggleMenu}
          aria-label={t("skillCard_options")}
        >
          <svg class="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="6" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="18" r="1.5" />
          </svg>
        </button>

        {#if showMenu}
          <div
            transition:scale={{ start: 0.95, duration: 100 }}
            class="absolute right-0 top-full mt-1 z-10 w-32 rounded-lg border bg-popover shadow-lg"
          >
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
              onclick={handleEdit}
            >
              <svg
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              onclick={handleDelete}
            >
              <svg
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  {#if !compact}
    <div class="mt-3 flex items-center justify-between">
      <!-- Category badge -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">{categoryInfo.icon}</span>
        <span class="text-xs text-muted-foreground">{categoryInfo.label}</span>
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-2">
        <button
          class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium
            bg-secondary/50 hover:bg-secondary text-secondary-foreground transition-colors
            opacity-0 group-hover:opacity-100"
          onclick={handlePreview}
          title="Preview skill execution"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Preview
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium
            bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
          onclick={handleSelect}
        >
          <Icon name="play" size="sm" />
          Execute
        </button>
      </div>
    </div>

    <!-- Tags -->
    {#if skill.tags && skill.tags.length > 0}
      <div class="mt-2 flex flex-wrap gap-1.5">
        {#each skill.tags.slice(0, 5) as tag}
          <span class="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
            {tag}
          </span>
        {/each}
        {#if skill.tags.length > 5}
          <span class="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
            +{skill.tags.length - 5}
          </span>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<!-- Preview Dialog -->
<SkillPreviewDialog
  bind:open={showPreview}
  {skill}
  args={previewArgs}
  onConfirm={handleConfirm}
  onCancel={() => (showPreview = false)}
/>
