<script lang="ts">
  import { onMount } from "svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { skillStore } from "$lib/stores/skill-store.svelte";
  import { SKILL_CATEGORIES } from "$lib/types/skill";
  import type { Skill, SkillCategory, SkillMetadata } from "$lib/types/skill";
  import SkillCard from "$lib/components/SkillCard.svelte";
  import SkillEditor from "$lib/components/SkillEditor.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { t } from "$lib/i18n/index.svelte";

  // Local state
  let searchQuery = $state("");
  let selectedCategory = $state<SkillCategory | null>(null);
  let showDeleteConfirm = $state(false);
  let skillToDelete = $state<Skill | null>(null);
  let activeTab = $state<"browse" | "history">("browse");

  // Computed
  const filteredSkills = $derived(() => {
    let skills = skillStore.skills;

    if (selectedCategory) {
      skills = skills.filter((s) => s.category === selectedCategory);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      skills = skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return skills;
  });

  onMount(async () => {
    dbg("skills-page", "mount");
    try {
      await skillStore.loadSkills();
    } catch (e) {
      dbgWarn("skills-page", "loadSkills failed", e);
    }
  });

  function handleSkillSelect(skill: Skill) {
    dbg("skills-page", "selectSkill", { name: skill.name });
    // Execute the skill
    skillStore.executeSkill(skill.name);
  }

  function handleEditSkill(skill: Skill) {
    skillStore.openEditEditor(skill);
  }

  function handleDeleteSkill(skill: Skill) {
    skillToDelete = skill;
    showDeleteConfirm = true;
  }

  async function confirmDelete() {
    if (skillToDelete) {
      await skillStore.deleteSkill(skillToDelete.id);
      showDeleteConfirm = false;
      skillToDelete = null;
    }
  }

  function cancelDelete() {
    showDeleteConfirm = false;
    skillToDelete = null;
  }

  async function handleSaveSkill(metadata: SkillMetadata, content: string) {
    if (skillStore.editingSkill) {
      await skillStore.updateSkill(skillStore.editingSkill.id, metadata, content);
    } else {
      await skillStore.createSkill(metadata, content);
    }
  }

  function handleCancelEdit() {
    skillStore.closeEditor();
  }

  function formatExecutionTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "completed":
        return "text-green-500";
      case "failed":
        return "text-red-500";
      case "running":
        return "text-blue-500";
      case "cancelled":
        return "text-muted-foreground";
      default:
        return "text-muted-foreground";
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- Header -->
  <div class="flex items-center justify-between border-b px-4 py-3">
    <div>
      <h1 class="text-xl font-semibold">{t("skills_title")}</h1>
      <p class="text-sm text-muted-foreground">
        {skillStore.skills.length} skills available
      </p>
    </div>
    <button
      class="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      onclick={() => skillStore.openCreateEditor()}
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Create Skill
    </button>
  </div>

  <!-- Search and filters -->
  <div class="border-b px-4 py-3">
    <div class="flex items-center gap-4">
      <!-- Search -->
      <div class="relative flex-1 max-w-md">
        <svg
          class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          bind:value={searchQuery}
          placeholder={t("skills_searchPlaceholder")}
          class="h-9 w-full rounded-md border bg-background pl-10 pr-4 text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/50 border-input"
        />
      </div>

      <!-- Category filter -->
      <div class="flex items-center gap-1">
        <button
          class="rounded-md px-2 py-1 text-xs font-medium transition-colors
            {selectedCategory === null
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent'}"
          onclick={() => (selectedCategory = null)}
        >
          All
        </button>
        {#each SKILL_CATEGORIES as cat (cat.value)}
          <button
            class="rounded-md px-2 py-1 text-xs font-medium transition-colors
              {selectedCategory === cat.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent'}"
            onclick={() => (selectedCategory = cat.value)}
          >
            {cat.icon}
            {cat.label}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex border-b px-4">
    <button
      class="px-4 py-2 text-sm font-medium transition-colors relative
        {activeTab === 'browse' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (activeTab = "browse")}
    >
      Browse
      {#if activeTab === "browse"}
        <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></div>
      {/if}
    </button>
    <button
      class="px-4 py-2 text-sm font-medium transition-colors relative
        {activeTab === 'history' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (activeTab = "history")}
    >
      History
      <span class="ml-1 text-xs text-muted-foreground">({skillStore.executions.length})</span>
      {#if activeTab === "history"}
        <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></div>
      {/if}
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-auto p-4">
    {#if activeTab === "browse"}
      {#if skillStore.loading}
        <div class="flex h-40 items-center justify-center">
          <div
            class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
          ></div>
        </div>
      {:else if filteredSkills().length === 0}
        <div class="flex h-40 flex-col items-center justify-center gap-2 text-center">
          <svg
            class="h-12 w-12 text-muted-foreground/50"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
            />
          </svg>
          <p class="text-sm text-muted-foreground">
            {searchQuery ? "No skills match your search" : "No skills yet"}
          </p>
          {#if !searchQuery}
            <button
              class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              onclick={() => skillStore.openCreateEditor()}
            >
              Create your first skill
            </button>
          {/if}
        </div>
      {:else}
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {#each filteredSkills() as skill (skill.id)}
            <SkillCard
              {skill}
              onSelect={handleSkillSelect}
              onEdit={handleEditSkill}
              onDelete={handleDeleteSkill}
            />
          {/each}
        </div>
      {/if}
    {:else if activeTab === "history"}
      {#if skillStore.executions.length === 0}
        <div class="flex h-40 flex-col items-center justify-center gap-2 text-center">
          <svg
            class="h-12 w-12 text-muted-foreground/50"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <p class="text-sm text-muted-foreground">{t("skills_noHistory")}</p>
        </div>
      {:else}
        <div class="space-y-3">
          {#each skillStore.recentExecutions as execution (execution.id)}
            <div class="rounded-lg border bg-card p-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <span class="text-lg">/{execution.skillName}</span>
                  <span class="text-sm text-muted-foreground">
                    {execution.args ? `"${execution.args}"` : ""}
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <span class={`text-sm font-medium ${getStatusColor(execution.status)}`}>
                    {execution.status}
                  </span>
                  <span class="text-xs text-muted-foreground">
                    {formatExecutionTime(execution.startedAt)}
                  </span>
                </div>
              </div>
              {#if execution.error}
                <p class="mt-2 text-xs text-destructive">{execution.error}</p>
              {:else if execution.result}
                <p class="mt-2 text-xs text-muted-foreground line-clamp-2">
                  {execution.result.substring(0, 100)}...
                </p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Error display -->
  {#if skillStore.error}
    <div class="border-t border-destructive/50 bg-destructive/10 px-4 py-2">
      <p class="text-sm text-destructive">{skillStore.error}</p>
    </div>
  {/if}
</div>

<!-- Editor Modal -->
{#if skillStore.showEditor}
  <Modal onClose={() => skillStore.closeEditor()}>
    <div class="w-[800px] max-w-[90vw] h-[80vh]">
      <SkillEditor
        skill={skillStore.editingSkill}
        onSave={handleSaveSkill}
        onCancel={handleCancelEdit}
      />
    </div>
  </Modal>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteConfirm && skillToDelete}
  <Modal onClose={cancelDelete}>
    <div class="w-[400px] p-6">
      <div class="flex items-center gap-3 mb-4">
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <svg
            class="h-5 w-5 text-destructive"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
            />
          </svg>
        </div>
        <div>
          <h3 class="text-lg font-semibold">{t("skills_deleteTitle")}</h3>
          <p class="text-sm text-muted-foreground">{t("skills_cannotUndo")}</p>
        </div>
      </div>

      <p class="mb-6 text-sm">
        Are you sure you want to delete <span class="font-medium">/{skillToDelete.name}</span>? This
        will permanently remove the skill and cannot be recovered.
      </p>

      <div class="flex justify-end gap-3">
        <button
          class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
          onclick={cancelDelete}
        >
          Cancel
        </button>
        <button
          class="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 transition-colors"
          onclick={confirmDelete}
        >
          Delete
        </button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .line-clamp-2 {
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
