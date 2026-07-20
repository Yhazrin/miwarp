<script lang="ts">
  import Spinner from "$lib/components/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { showToast as globalToast } from "$lib/stores/toast-store.svelte";
  import { renderMarkdown } from "$lib/utils/markdown";
  import { formatInstallCount } from "$lib/utils/format";
  import {
    checkCommunityHealth,
    searchCommunitySkills,
    getCommunitySkillDetail,
    installCommunitySkill,
  } from "$lib/api";
  import type { CommunitySkillResult, CommunitySkillDetail, ProviderHealth } from "$lib/types";

  let {
    projectCwd = "",
    sByScope = {} as Record<string, Set<string>>,
    operationLoading = $bindable<string | null>(null),
    onInstalled,
  }: {
    projectCwd?: string;
    sByScope?: Record<string, Set<string>>;
    operationLoading?: string | null;
    onInstalled: () => Promise<void>;
  } = $props();

  // Community state
  let communityQuery = $state("");
  let communityResults = $state<CommunitySkillResult[]>([]);
  let communityPopular = $state<CommunitySkillResult[]>([]);
  let communitySearching = $state(false);
  let communityRefreshing = $state(false);
  let communityScope = $state<"user" | "project">("user");
  let communityHealth = $state<ProviderHealth | null>(null);
  let communityDetail = $state<CommunitySkillDetail | null>(null);
  let communityDetailLoading = $state(false);
  let communityDetailError = $state<string | null>(null);
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  let communityDisplayResults = $derived(
    communityQuery.trim().length >= 2 ? communityResults : communityPopular,
  );

  function _skillSlug(skillPath: string): string {
    const parts = skillPath.replace(/\\/g, "/").split("/");
    return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : "";
  }

  function toLocalSlug(s: string): string {
    const base = s.split("/").pop() ?? s;
    return base
      .replace(/:/g, "-")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .toLowerCase();
  }

  export async function refreshCommunity() {
    communityRefreshing = true;
    try {
      const [h, r] = await Promise.all([
        checkCommunityHealth(),
        searchCommunitySkills("skill", 20),
      ]);
      communityHealth = h;
      communityPopular = r;
      dbg("plugins", "community refreshed", { health: h.available, popular: r.length });
    } catch (e) {
      dbgWarn("plugins", "community refresh error", e);
    } finally {
      communityRefreshing = false;
    }
  }

  function handleCommunitySearch() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    const q = communityQuery.trim();
    if (q.length < 2) {
      communityResults = [];
      return;
    }
    searchDebounceTimer = setTimeout(async () => {
      communitySearching = true;
      try {
        communityResults = await searchCommunitySkills(q, 30);
      } catch (e) {
        globalToast(t("plugin_searchFailed", { error: String(e) }), "error");
      } finally {
        communitySearching = false;
      }
    }, 300);
  }

  async function handleCommunityDetail(skill: CommunitySkillResult) {
    communityDetailLoading = true;
    communityDetail = null;
    communityDetailError = null;
    try {
      communityDetail = await getCommunitySkillDetail(skill.source, skill.skill_id);
    } catch (e) {
      communityDetailError = String(e);
    } finally {
      communityDetailLoading = false;
    }
  }

  async function handleCommunityInstall(skill: CommunitySkillResult) {
    operationLoading = skill.id;
    try {
      const result = await installCommunitySkill(
        skill.source,
        skill.skill_id,
        communityScope,
        projectCwd || undefined,
      );
      globalToast(
        result.success
          ? t("plugin_installedSkill", { name: skill.name }) + " " + t("plugin_skillRestartHint")
          : result.message,
        result.success ? "success" : "error",
      );
      if (result.success) {
        await onInstalled();
      }
    } catch (e) {
      globalToast(t("plugin_errorGeneric", { error: String(e) }), "error");
    } finally {
      operationLoading = null;
    }
  }

  function setCommunityFilter(q: string) {
    communityQuery = q;
    handleCommunitySearch();
  }
</script>

<!-- Health badge + search + scope -->
<div class="flex items-center gap-3 mb-4">
  <!-- Health indicator + refresh -->
  <div class="flex items-center gap-1 shrink-0">
    <div class="flex items-center gap-1.5" title={communityHealth?.reason ?? ""}>
      <span
        class="inline-block h-2 w-2 rounded-full {communityHealth === null
          ? 'bg-muted-foreground/40'
          : communityHealth.available
            ? 'bg-miwarp-status-success'
            : 'bg-miwarp-status-error'}"
      ></span>
      <span class="text-[10px] text-muted-foreground">skills.sh</span>
    </div>
    <button
      type="button"
      class="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
      title={t("plugins_refresh")}
      aria-label={t("plugins_refresh")}
      disabled={communityRefreshing}
      onclick={refreshCommunity}
    >
      <svg
        class="h-3 w-3 {communityRefreshing ? 'animate-spin' : ''}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg
      >
    </button>
  </div>

  <!-- Search input -->
  <div class="relative flex-1">
    <Icon
      name="search"
      class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
    />
    <input
      type="text"
      placeholder={t("plugin_searchCommunity")}
      class="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      bind:value={communityQuery}
      oninput={handleCommunitySearch}
    />
  </div>

  <!-- Scope selector -->
  <div class="flex rounded-lg border border-border p-0.5 shrink-0">
    <button
      type="button"
      class="rounded-md px-2 py-1 text-xs font-medium transition-colors {communityScope === 'user'
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (communityScope = "user")}>{t("plugin_scopeUser")}</button
    >
    <button
      type="button"
      class="rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed {communityScope ===
      'project'
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      disabled={!projectCwd}
      onclick={() => (communityScope = "project")}>{t("plugin_scopeProject")}</button
    >
  </div>
</div>

<!-- Scope description -->
<div class="flex items-center gap-1.5 mb-3 text-[11px] text-muted-foreground/70">
  <svg
    class="h-3 w-3"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    ><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg
  >
  {communityScope === "user" ? t("extensions_scopeUserDesc") : t("extensions_scopeProjectDesc")}
</div>

<!-- Quick filters -->
<div class="flex flex-wrap gap-1.5 mb-4">
  {#each ["react", "python", "security", "testing", "devops", "best practices"] as filter}
    <button
      type="button"
      class="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors {communityQuery ===
      filter
        ? 'bg-primary/10 border-primary/30 text-foreground'
        : ''}"
      onclick={() => setCommunityFilter(filter)}
    >
      {filter}
    </button>
  {/each}
</div>

<!-- Loading spinner for search -->
{#if communitySearching}
  <div class="flex items-center justify-center py-4">
    <Spinner size="sm" />
    <span class="ml-2 text-xs text-muted-foreground">{t("plugin_searching")}</span>
  </div>
{/if}

<!-- Results / Popular -->
{#if !communitySearching}
  <div>
    <div class="text-xs font-medium text-muted-foreground mb-2">
      {communityQuery.trim().length >= 2
        ? t("plugin_nResults", { count: String(communityResults.length) })
        : t("plugin_popularSkills")}
    </div>

    {#if communityDisplayResults.length === 0}
      <div class="flex flex-col items-center justify-center py-12 text-center gap-2">
        <p class="text-xs text-muted-foreground">
          {communityQuery.trim().length >= 2
            ? t("extensions_noSkillsExplore")
            : communityRefreshing
              ? t("plugin_loadingPopular")
              : t("plugin_couldNotLoadPopular")}
        </p>
        {#if communityQuery.trim().length < 2 && !communityRefreshing}
          <button
            type="button"
            class="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
            onclick={refreshCommunity}
          >
            {t("common_retry")}
          </button>
        {/if}
      </div>
    {:else}
      <!-- Side-by-side: skill list (left) + preview (right) -->
      <div class="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <!-- Left: scrollable skill list -->
        <div
          class="lg:w-[280px] lg:shrink-0 lg:max-h-[min(560px,60vh)] lg:overflow-y-auto space-y-1.5 pr-1"
        >
          {#each communityDisplayResults as skill}
            {@const isInstalled = (sByScope[communityScope] ?? new Set<string>()).has(
              toLocalSlug(skill.skill_id),
            )}
            <div
              class="w-full text-left rounded-xl border px-3 py-2.5 transition-all cursor-pointer {communityDetail?.id ===
              skill.id
                ? 'border-primary/50 bg-primary/5'
                : 'border-border/50 bg-card/30 hover:bg-card/60'}"
              onclick={() => handleCommunityDetail(skill)}
              onkeydown={(e) => {
                if (e.key === "Enter") handleCommunityDetail(skill);
              }}
              role="button"
              tabindex="0"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-medium text-foreground truncate block"
                    >{skill.name}</span
                  >
                  <div class="flex items-center gap-2 mt-0.5">
                    {#if skill.installs > 0}
                      <span class="text-[11px] text-muted-foreground"
                        >{formatInstallCount(skill.installs)}</span
                      >
                    {/if}
                    <span class="text-[10px] text-muted-foreground truncate">{skill.source}</span>
                  </div>
                </div>
                <button
                  type="button"
                  class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 shrink-0 {isInstalled
                    ? 'bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success cursor-default'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'}"
                  onclick={(e) => {
                    e.stopPropagation();
                    if (!isInstalled) handleCommunityInstall(skill);
                  }}
                  disabled={isInstalled || operationLoading === skill.id}
                >
                  {#if operationLoading === skill.id}
                    ...
                  {:else if isInstalled}
                    {t("plugin_installed")}
                  {:else}
                    {t("plugin_install")}
                  {/if}
                </button>
              </div>
            </div>
          {/each}
        </div>

        <!-- Right: preview panel -->
        <div class="flex-1 min-w-0 lg:max-h-[min(560px,60vh)] lg:overflow-y-auto">
          {#if communityDetailLoading}
            <div
              class="rounded-xl border border-border/50 bg-card/20 p-6 flex items-center justify-center h-full"
            >
              <Spinner size="sm" />
              <span class="ml-2 text-xs text-muted-foreground">{t("plugin_loadingPreview")}</span>
            </div>
          {:else if communityDetailError}
            <div
              class="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex flex-col items-center justify-center h-full gap-2 text-center"
            >
              <span class="text-2xl">!</span>
              <p class="text-xs font-medium text-destructive">
                {t("plugin_skillUnavailable")}
              </p>
              <p class="text-[10px] text-muted-foreground max-w-[280px] leading-relaxed">
                {communityDetailError}
              </p>
            </div>
          {:else if communityDetail}
            <div class="rounded-xl border border-border/50 bg-card/20 p-4 space-y-3">
              <!-- Header -->
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <h3 class="text-sm font-semibold text-foreground truncate">
                    {communityDetail.name}
                  </h3>
                  <div class="flex items-center gap-2 mt-1 flex-wrap">
                    {#if communityDetail.installs > 0}
                      <span class="text-[10px] text-muted-foreground"
                        >{formatInstallCount(communityDetail.installs)}
                        {t("plugin_installs")}</span
                      >
                    {/if}
                    <span class="text-[10px] text-muted-foreground/60"
                      >{communityDetail.source}</span
                    >
                    {#if communityDetail.github_url}
                      <a
                        href={communityDetail.github_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-[10px] text-muted-foreground hover:text-foreground underline"
                        >GitHub</a
                      >
                    {/if}
                    {#if communityDetail.skills_sh_url}
                      <a
                        href={communityDetail.skills_sh_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-[10px] text-muted-foreground hover:text-foreground underline"
                        >skills.sh</a
                      >
                    {/if}
                  </div>
                  {#if communityDetail.description}
                    <p class="text-xs text-muted-foreground mt-1.5">
                      {communityDetail.description}
                    </p>
                  {/if}
                </div>
                <button
                  type="button"
                  class="shrink-0 text-muted-foreground hover:text-foreground"
                  onclick={() => (communityDetail = null)}
                  title={t("plugin_closePreview")}
                >
                  <Icon name="x" size="sm" />
                </button>
              </div>

              <!-- SKILL.md content -->
              {#if communityDetail.content}
                <div class="border-t border-border pt-3">
                  <div class="prose prose-sm dark:prose-invert max-w-none">
                    {@html renderMarkdown(communityDetail.content)}
                  </div>
                </div>
              {:else}
                <div class="border-t border-border pt-3">
                  <p class="text-xs text-muted-foreground italic">
                    {t("plugin_noContentPreview")}
                  </p>
                </div>
              {/if}
            </div>
          {:else}
            <div
              class="rounded-xl border border-dashed border-border/50 p-6 flex items-center justify-center h-full"
            >
              <p class="text-xs text-muted-foreground">{t("plugin_clickToPreview")}</p>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
