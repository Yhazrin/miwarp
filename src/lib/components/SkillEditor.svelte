<script lang="ts">
  import type { Skill, SkillMetadata, SkillCategory } from "$lib/types/skill";
  import { t } from "$lib/i18n/index.svelte";
  import { SKILL_CATEGORIES, DEFAULT_SKILL_ICON } from "$lib/types/skill";
  import { renderMarkdown } from "$lib/utils/markdown";
  import { dbg, dbgWarn } from "$lib/utils/debug";

  interface Props {
    skill?: Skill | null;
    onSave?: (metadata: SkillMetadata, content: string) => void;
    onCancel?: () => void;
  }

  let { skill = null, onSave, onCancel }: Props = $props();

  // Form state
  let name = $state("");
  let description = $state("");
  let category = $state<SkillCategory>("custom");
  let icon = $state(DEFAULT_SKILL_ICON);
  let author = $state("");
  let content = $state("");

  // Sync form fields when skill prop changes
  $effect(() => {
    if (skill) {
      name = skill.name || "";
      description = skill.description || "";
      category = skill.category || "custom";
      icon = skill.icon || DEFAULT_SKILL_ICON;
      author = skill.author || "";
      content = skill.content || "";
    }
  });

  // Validation
  let errors = $state<string[]>([]);
  let nameError = $state("");

  // Tab state
  let activeTab = $state<"metadata" | "content" | "preview">("metadata");

  // Compute content with frontmatter
  const fullContent = $derived(
    `---\nname: ${name}\ndescription: ${description}\ncategory: ${category}\n${icon !== DEFAULT_SKILL_ICON ? `icon: ${icon}\n` : ""}${author ? `author: ${author}\n` : ""}---\n\n${content}`,
  );

  function validate(): boolean {
    errors = [];
    nameError = "";

    if (!name.trim()) {
      nameError = "Name is required";
      errors.push(nameError);
    } else if (!/^[a-z0-9-]+$/.test(name)) {
      nameError = "Name must be lowercase letters, numbers, and hyphens only";
      errors.push(nameError);
    }

    if (!description.trim()) {
      errors.push("Description is required");
    }

    if (!content.trim()) {
      errors.push("Content is required");
    }

    return errors.length === 0;
  }

  function handleSave() {
    if (!validate()) {
      dbgWarn("skill-editor", "validation failed", { errors });
      return;
    }

    const metadata: SkillMetadata = {
      name: name.trim(),
      description: description.trim(),
      category,
      icon: icon !== DEFAULT_SKILL_ICON ? icon : undefined,
      author: author.trim() || undefined,
    };

    dbg("skill-editor", "save", { name: metadata.name });
    onSave?.(metadata, fullContent);
  }

  function handleCancel() {
    onCancel?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      handleCancel();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  }

  const iconOptions = ["✨", "⚡", "🔧", "🤖", "🧠", "📁", "🔗", "🚀", "📝", "🎯", "💡", "🔒"];
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-full flex-col bg-background">
  <!-- Header -->
  <div class="flex items-center justify-between border-b px-4 py-3">
    <div>
      <h2 class="text-lg font-semibold">
        {skill ? "Edit Skill" : "Create Skill"}
      </h2>
      <p class="text-sm text-muted-foreground">
        {skill ? `Editing /${skill.name}` : "Define a new skill"}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
        onclick={handleCancel}
      >
        Cancel
      </button>
      <button
        class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        onclick={handleSave}
      >
        Save Skill
      </button>
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex border-b">
    <button
      class="px-4 py-2 text-sm font-medium transition-colors relative
        {activeTab === 'metadata' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (activeTab = "metadata")}
    >
      Metadata
      {#if activeTab === "metadata"}
        <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></div>
      {/if}
    </button>
    <button
      class="px-4 py-2 text-sm font-medium transition-colors relative
        {activeTab === 'content' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (activeTab = "content")}
    >
      Content
      {#if activeTab === "content"}
        <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></div>
      {/if}
    </button>
    <button
      class="px-4 py-2 text-sm font-medium transition-colors relative
        {activeTab === 'preview' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (activeTab = "preview")}
    >
      Preview
      {#if activeTab === "preview"}
        <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></div>
      {/if}
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-auto p-4">
    {#if activeTab === "metadata"}
      <div class="space-y-6 max-w-xl">
        <!-- Name -->
        <div class="space-y-2">
          <label for="name" class="text-sm font-medium">{t("skillEditor_name")}</label>
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground">/</span>
            <input
              id="name"
              type="text"
              bind:value={name}
              placeholder={t("skillEditor_namePlaceholder")}
              class="flex-1 rounded-md border bg-background px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/50
                {nameError ? 'border-destructive' : 'border-input'}"
            />
          </div>
          {#if nameError}
            <p class="text-xs text-destructive">{nameError}</p>
          {/if}
          <p class="text-xs text-muted-foreground">{t("skillEditor_nameHelp")}</p>
        </div>

        <!-- Description -->
        <div class="space-y-2">
          <label for="description" class="text-sm font-medium">{t("skillEditor_description")}</label
          >
          <textarea
            id="description"
            bind:value={description}
            placeholder={t("skillEditor_descPlaceholder")}
            rows={3}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/50
              resize-none border-input"
          ></textarea>
        </div>

        <!-- Category -->
        <div class="space-y-2">
          <span id="skill-category-label" class="text-sm font-medium"
            >{t("skillEditor_category")}</span
          >
          <div class="grid grid-cols-2 gap-2" aria-labelledby="skill-category-label">
            {#each SKILL_CATEGORIES as cat (cat.value)}
              <button
                class="flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors
                  {category === cat.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-input hover:bg-accent'}"
                onclick={() => (category = cat.value)}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            {/each}
          </div>
        </div>

        <!-- Icon -->
        <div class="space-y-2">
          <span id="skill-icon-label" class="text-sm font-medium">{t("skillEditor_icon")}</span>
          <div class="flex flex-wrap gap-2" aria-labelledby="skill-icon-label">
            {#each iconOptions as iconOption (iconOption)}
              <button
                class="flex h-10 w-10 items-center justify-center rounded-md border text-lg transition-colors
                  {icon === iconOption
                  ? 'border-primary bg-primary/5'
                  : 'border-input hover:bg-accent'}"
                onclick={() => (icon = iconOption)}
              >
                {iconOption}
              </button>
            {/each}
          </div>
        </div>

        <!-- Author -->
        <div class="space-y-2">
          <label for="author" class="text-sm font-medium">{t("skillEditor_author")}</label>
          <input
            id="author"
            type="text"
            bind:value={author}
            placeholder={t("skillEditor_authorPlaceholder")}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/50 border-input"
          />
        </div>

        <!-- Errors -->
        {#if errors.length > 0}
          <div class="rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p class="text-sm font-medium text-destructive">{t("skillEditor_fixErrors")}</p>
            <ul class="mt-1 list-inside list-disc text-sm text-destructive/80">
              {#each errors as error, i (i)}
                <li>{error}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {:else if activeTab === "content"}
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <p class="text-sm text-muted-foreground">{t("skillEditor_markdownHint")}</p>
          <div class="text-xs text-muted-foreground">
            {t("skillEditor_charCount", { count: String(content.length) })}
          </div>
        </div>

        <textarea
          bind:value={content}
          placeholder="# My Skill

Describe what this skill does...

## Usage

Explain how to use this skill...

## Examples

Provide some examples..."
          class="h-[calc(100vh-300px)] w-full rounded-md border bg-background px-4 py-3 font-mono text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/50
            resize-none border-input"
        ></textarea>
      </div>
    {:else if activeTab === "preview"}
      <div class="rounded-lg border bg-card p-6">
        <div class="prose prose-sm max-w-none">
          <div class="flex items-center gap-3 mb-6 pb-4 border-b">
            <span class="text-3xl">{icon}</span>
            <div>
              <h1 class="text-2xl font-bold">/{name}</h1>
              <p class="text-muted-foreground">{description}</p>
            </div>
          </div>

          <div class="leading-[1.7]">
            {@html renderMarkdown(content)}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Footer hint -->
  <div class="border-t px-4 py-2 text-xs text-muted-foreground">
    {t('skillEditor_saveHint', { shortcut: '' })}
    <kbd class="rounded bg-secondary px-1.5 py-0.5 font-mono">Ctrl+S</kbd>
  </div>
</div>

<style>
  :global(code) {
    background: var(--secondary);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.875em;
  }
</style>
