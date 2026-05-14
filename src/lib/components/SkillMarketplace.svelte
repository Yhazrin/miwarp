<script lang="ts">
  /**
   * Skill Marketplace Component
   *
   * 技能市场浏览和安装组件
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MarketplaceSkill, MarketplaceCategory } from "$lib/types/marketplace";
  import { SKILL_CATEGORIES } from "$lib/types/skill";

  interface Props {
    onInstall?: (skill: MarketplaceSkill) => void;
    onPreview?: (skill: MarketplaceSkill) => void;
  }

  let { onInstall, onPreview }: Props = $props();

  // State
  let searchQuery = $state("");
  let selectedCategory = $state<string | null>(null);
  let skills = $state<MarketplaceSkill[]>([]);
  let categories = $state<MarketplaceCategory[]>([]);
  let loading = $state(true);
  let selectedSkill = $state<MarketplaceSkill | null>(null);
  let installing = $state<string | null>(null);
  let error = $state<string | null>(null);

  // Mock data for demonstration
  const mockSkills: MarketplaceSkill[] = [
    {
      id: "mkp-readme-generator",
      name: "readme-generator",
      description: "Generate beautiful README.md files for your projects",
      content: `---
name: readme-generator
description: Generate beautiful README files
category: documentation
---

# README Generator

Generates professional README.md files...`,
      category: "documentation",
      author: "MiWarp Team",
      tags: ["readme", "documentation", "generator"],
      icon: "📖",
      downloadCount: 1234,
      rating: 4.8,
      version: "1.2.0",
      minAppVersion: "1.0.0",
      dependencies: [],
      createdAt: "2024-01-15T00:00:00Z",
      updatedAt: "2024-03-20T00:00:00Z",
    },
    {
      id: "mkp-git-flow",
      name: "git-flow",
      description: "Git workflow automation for feature branches",
      content: `---
name: git-flow
description: Git workflow automation
category: development
---

# Git Flow

Automate your git workflow...`,
      category: "development",
      author: "DevTools",
      tags: ["git", "workflow", "automation"],
      icon: "🌿",
      downloadCount: 892,
      rating: 4.6,
      version: "2.0.0",
      minAppVersion: "1.0.0",
      dependencies: [],
      createdAt: "2024-02-01T00:00:00Z",
      updatedAt: "2024-04-10T00:00:00Z",
    },
    {
      id: "mkp-test-coverage",
      name: "test-coverage",
      description: "Analyze and improve test coverage",
      content: `---
name: test-coverage
description: Test coverage analyzer
category: testing
---

# Test Coverage

Analyze your test coverage...`,
      category: "testing",
      author: "QA Master",
      tags: ["testing", "coverage", "quality"],
      icon: "🧪",
      downloadCount: 567,
      rating: 4.5,
      version: "1.0.0",
      minAppVersion: "1.0.0",
      dependencies: [],
      createdAt: "2024-03-01T00:00:00Z",
      updatedAt: "2024-03-01T00:00:00Z",
    },
  ];

  const mockCategories: MarketplaceCategory[] = [
    { id: "documentation", name: "Documentation", nameZh: "文档", icon: "📝", count: 45 },
    { id: "development", name: "Development", nameZh: "开发", icon: "🔧", count: 78 },
    { id: "testing", name: "Testing", nameZh: "测试", icon: "🧪", count: 32 },
    { id: "automation", name: "Automation", nameZh: "自动化", icon: "🤖", count: 56 },
    { id: "security", name: "Security", nameZh: "安全", icon: "🔒", count: 23 },
    { id: "productivity", name: "Productivity", nameZh: "效率", icon: "⚡", count: 89 },
  ];

  // Computed
  const filteredSkills = $derived(() => {
    let result = skills;

    if (selectedCategory) {
      result = result.filter((s) => s.category === selectedCategory);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return result;
  });

  // Methods
  async function loadMarketplace() {
    loading = true;
    error = null;

    try {
      // 模拟 API 调用
      await new Promise((resolve) => setTimeout(resolve, 500));
      skills = mockSkills;
      categories = mockCategories;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load marketplace";
    } finally {
      loading = false;
    }
  }

  async function installSkill(skill: MarketplaceSkill) {
    installing = skill.id;

    try {
      // 模拟安装过程
      await new Promise((resolve) => setTimeout(resolve, 1000));
      onInstall?.(skill);
    } finally {
      installing = null;
    }
  }

  function previewSkill(skill: MarketplaceSkill) {
    selectedSkill = skill;
    onPreview?.(skill);
  }

  function formatNumber(num: number): string {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k";
    }
    return num.toString();
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // Load on mount
  $effect(() => {
    loadMarketplace();
  });
</script>

<div class="skill-marketplace">
  <!-- Header -->
  <div class="mb-4">
    <h2 class="text-lg font-semibold">{t("Marketplace")}</h2>
    <p class="text-sm text-muted-foreground">
      {t("Discover and install community skills")}
    </p>
  </div>

  <!-- Search -->
  <div class="relative mb-4">
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
      placeholder={t("Search skills...")}
      class="h-9 w-full rounded-md border bg-background pl-10 pr-4 text-sm
        focus:outline-none focus:ring-2 focus:ring-primary/50"
    />
  </div>

  <!-- Categories -->
  <div class="mb-4 flex flex-wrap gap-2">
    <button
      class="rounded-full px-3 py-1 text-xs font-medium transition-colors
        {selectedCategory === null
        ? 'bg-primary text-primary-foreground'
        : 'bg-accent text-accent-foreground hover:bg-accent/80'}"
      onclick={() => (selectedCategory = null)}
    >
      {t("All")}
    </button>
    {#each categories as cat}
      <button
        class="rounded-full px-3 py-1 text-xs font-medium transition-colors
          {selectedCategory === cat.id
          ? 'bg-primary text-primary-foreground'
          : 'bg-accent text-accent-foreground hover:bg-accent/80'}"
        onclick={() => (selectedCategory = cat.id)}
      >
        {cat.icon}
        {cat.name}
        <span class="ml-1 text-muted-foreground">({cat.count})</span>
      </button>
    {/each}
  </div>

  <!-- Loading State -->
  {#if loading}
    <div class="flex h-40 items-center justify-center">
      <div
        class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      ></div>
    </div>
  {:else if error}
    <!-- Error State -->
    <div class="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
      <p class="text-sm text-destructive">{error}</p>
      <button class="mt-2 text-sm text-primary hover:underline" onclick={loadMarketplace}>
        {t("Retry")}
      </button>
    </div>
  {:else if filteredSkills().length === 0}
    <!-- Empty State -->
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
        {searchQuery ? t("No skills match your search") : t("No skills available")}
      </p>
    </div>
  {:else}
    <!-- Skills Grid -->
    <div class="grid gap-4 sm:grid-cols-2">
      {#each filteredSkills() as skill (skill.id)}
        <div
          class="group rounded-lg border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-md"
        >
          <!-- Header -->
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">{skill.icon}</span>
              <div>
                <div class="font-medium">/{skill.name}</div>
                <div class="text-xs text-muted-foreground">by {skill.author}</div>
              </div>
            </div>
            <span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              v{skill.version}
            </span>
          </div>

          <!-- Description -->
          <p class="mt-2 text-sm text-muted-foreground line-clamp-2">
            {skill.description}
          </p>

          <!-- Tags -->
          <div class="mt-2 flex flex-wrap gap-1">
            {#each skill.tags.slice(0, 3) as tag}
              <span class="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">
                {tag}
              </span>
            {/each}
          </div>

          <!-- Stats -->
          <div class="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span class="flex items-center gap-1">
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              {formatNumber(skill.downloadCount)}
            </span>
            <span class="flex items-center gap-1">
              <svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path
                  d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                />
              </svg>
              {skill.rating.toFixed(1)}
            </span>
            <span class="ml-auto">
              {formatDate(skill.updatedAt)}
            </span>
          </div>

          <!-- Actions -->
          <div class="mt-3 flex gap-2">
            <button
              class="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium
                hover:bg-accent transition-colors"
              onclick={() => previewSkill(skill)}
            >
              {t("Preview")}
            </button>
            <button
              class="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium
                text-primary-foreground hover:bg-primary/90 transition-colors
                disabled:opacity-50"
              onclick={() => installSkill(skill)}
              disabled={installing !== null}
            >
              {#if installing === skill.id}
                <span
                  class="inline-block h-3 w-3 animate-spin rounded-full border border-primary-foreground border-t-transparent"
                ></span>
              {:else}
                {t("Install")}
              {/if}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
