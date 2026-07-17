<script lang="ts">
  /**
   * AgentsPanel — list + edit agents scoped to user/project/plugin sources.
   *
   * v1.0.9 redesign: drop the 3-tab layout (built-in / custom / plugin). The
   * scope pill on each card already encodes source; grouping by scope instead
   * of tab-switching keeps everything in one scannable view with a single
   * search filter and one inline rename flow.
   *
   * Layout: master/detail with a wide center column for the source preview
   * (only loaded on demand). Editor lives in the existing MiDialog-based
   * side sheet.
   */
  import { listAgents, readAgentFile, deleteAgentFile, createAgentFile } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import MiConfirmDialog from "$lib/components/MiConfirmDialog.svelte";
  import { untrack } from "svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import type { AgentDefinitionSummary } from "$lib/types";
  import AgentEditor from "./AgentEditor.svelte";

  let {
    projectCwd = "",
    showToast,
  }: {
    projectCwd: string;
    showToast: (message: string, type: "success" | "error") => void;
  } = $props();

  // ── Built-in agents (hardcoded, read-only) ───────────────────────────────
  const builtInAgents: AgentDefinitionSummary[] = [
    {
      file_name: "Explore",
      name: "Explore",
      description: t("agentsPanel_exploreDesc"),
      model: "haiku",
      source: "built-in",
      scope: "user",
      tools: ["Read", "Grep", "Glob", "WebFetch", "WebSearch"],
      readonly: true,
    },
    {
      file_name: "Plan",
      name: "Plan",
      description: t("agentsPanel_planDesc"),
      source: "built-in",
      scope: "user",
      tools: ["Read", "Grep", "Glob", "WebFetch", "WebSearch"],
      readonly: true,
    },
    {
      file_name: "general-purpose",
      name: "general-purpose",
      description: t("agentsPanel_generalPurposeDesc"),
      source: "built-in",
      scope: "user",
      readonly: true,
    },
    {
      file_name: "claude-code-guide",
      name: "claude-code-guide",
      description: t("agentsPanel_claudeCodeGuideDesc"),
      model: "haiku",
      source: "built-in",
      scope: "user",
      tools: ["Glob", "Grep", "Read", "WebFetch", "WebSearch"],
      readonly: true,
    },
    {
      file_name: "statusline-setup",
      name: "statusline-setup",
      description: t("agents_statuslineDesc"),
      model: "sonnet",
      source: "built-in",
      scope: "user",
      tools: ["Read", "Edit"],
      readonly: true,
    },
  ];

  // ── State ────────────────────────────────────────────────────────────────
  let loading = $state(true);
  let customAgents = $state<AgentDefinitionSummary[]>([]);
  let pluginAgents = $state<AgentDefinitionSummary[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used in template
  let pluginError = $state(false);
  let searchQuery = $state("");
  let selectedAgent = $state<AgentDefinitionSummary | null>(null);
  let selectedContent = $state<string | null>(null);
  let selectedContentLoading = $state(false);
  let editorState = $state<{
    mode: "create" | "edit";
    agent: AgentDefinitionSummary | null;
  } | null>(null);
  let deleteCandidate = $state<AgentDefinitionSummary | null>(null);
  let deleting = $state(false);
  let inlineRenameFor = $state<AgentDefinitionSummary | null>(null);
  let inlineRenameName = $state("");
  let inlineRenameError = $state("");
  let inlineRenameSaving = $state(false);

  // ── Data loading ─────────────────────────────────────────────────────────
  async function loadAgents() {
    loading = true;
    pluginError = false;
    try {
      const all = await listAgents(projectCwd || undefined);
      dbg("agents-panel", "loaded agents", { count: all.length });
      customAgents = all.filter((a) => a.scope === "user" || a.scope === "project");
      pluginAgents = all.filter((a) => a.scope === "plugin");
      pluginError = false;
    } catch (e) {
      dbgWarn("agents-panel", "failed to load agents", e);
      customAgents = [];
      pluginAgents = [];
      pluginError = true;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void projectCwd;
    void loadAgents();
  });

  // ── Derived ─────────────────────────────────────────────────────────────
  let existingAgentNames = $derived(customAgents.map((a) => a.name));

  type Scope = "built-in" | "user" | "project" | "plugin";
  const SCOPE_ORDER: Scope[] = ["built-in", "user", "project", "plugin"];

  const trimmedQuery = $derived(searchQuery.trim().toLowerCase());
  const matchesFilter = $derived(
    (agent: AgentDefinitionSummary) =>
      trimmedQuery.length === 0 ||
      agent.name.toLowerCase().includes(trimmedQuery) ||
      agent.file_name.toLowerCase().includes(trimmedQuery) ||
      agent.description.toLowerCase().includes(trimmedQuery),
  );

  const groupedAgents = $derived.by(() => {
    const groups: Record<Scope, AgentDefinitionSummary[]> = {
      "built-in": [],
      user: [],
      project: [],
      plugin: [],
    };
    for (const agent of builtInAgents) {
      if (matchesFilter(agent)) groups["built-in"].push(agent);
    }
    for (const agent of customAgents) {
      if (matchesFilter(agent)) groups[agent.scope as Scope].push(agent);
    }
    for (const agent of pluginAgents) {
      if (matchesFilter(agent)) groups.plugin.push(agent);
    }
    return SCOPE_ORDER.map((scope) => ({
      scope,
      agents: groups[scope],
    })).filter((g) => g.agents.length > 0);
  });

  const totalAgents = $derived(groupedAgents.reduce((n, g) => n + g.agents.length, 0));

  const scopeLabel = (scope: Scope): string => {
    switch (scope) {
      case "built-in":
        return t("agentsPanel_groupBuiltIn");
      case "user":
        return t("agentsPanel_groupUser");
      case "project":
        return t("agentsPanel_groupProject");
      case "plugin":
        return t("agentsPanel_groupPlugin");
    }
  };

  const scopeBadgeClass = (agent: AgentDefinitionSummary): string => {
    if (agent.source === "built-in") return "bg-muted text-muted-foreground";
    if (agent.scope === "user")
      return "bg-[hsl(var(--miwarp-status-info)/0.12)] text-miwarp-status-info";
    if (agent.scope === "project")
      return "bg-[hsl(var(--miwarp-status-success)/0.12)] text-miwarp-status-success";
    if (agent.scope === "plugin")
      return "bg-[hsl(var(--miwarp-accent-violet)/0.12)] text-miwarp-accent-violet";
    return "bg-muted text-muted-foreground";
  };

  // ── Selection / source preview ──────────────────────────────────────────
  function isSameAgent(a: AgentDefinitionSummary, b: AgentDefinitionSummary): boolean {
    return a.file_name === b.file_name && a.source === b.source && a.scope === b.scope;
  }

  async function selectAgent(agent: AgentDefinitionSummary) {
    selectedAgent = agent;
    selectedContent = agent.raw_content ?? null;
    if (agent.raw_content != null || agent.source === "built-in") return;

    selectedContentLoading = true;
    try {
      selectedContent = await readAgentFile(
        agent.scope as "user" | "project",
        agent.file_name,
        projectCwd || undefined,
      );
    } catch (e) {
      dbgWarn("agents-panel", "failed to read agent file", e);
      selectedContent = null;
    } finally {
      selectedContentLoading = false;
    }
  }

  // Keep selection valid when the underlying list changes. Writes to
  // `selectedAgent` are wrapped in `untrack` so the effect doesn't
  // re-subscribe to the field it just updated (which would cause
  // Svelte 5 to flag "effect updated its own state" + re-run forever).
  $effect(() => {
    const current = selectedAgent;
    if (!current) return;
    const pool = current.source === "built-in" ? builtInAgents : [...customAgents, ...pluginAgents];
    const next = pool.find((a) => isSameAgent(a, current));
    untrack(() => {
      if (!next) {
        selectedAgent = null;
        selectedContent = null;
      } else if (next !== current) {
        selectedAgent = next;
      }
    });
  });

  // ── Inline rename ────────────────────────────────────────────────────────
  function startInlineRename(agent: AgentDefinitionSummary) {
    inlineRenameFor = agent;
    inlineRenameName = agent.file_name;
    inlineRenameError = "";
  }

  async function commitInlineRename() {
    if (!inlineRenameFor) return;
    const agent = inlineRenameFor;
    const newName = inlineRenameName.trim();
    if (!newName || newName === agent.file_name) {
      inlineRenameError = t("agent_nameFormat");
      return;
    }
    inlineRenameSaving = true;
    inlineRenameError = "";
    try {
      const content = await readAgentFile(
        agent.scope as "user" | "project",
        agent.file_name,
        projectCwd || undefined,
      );
      await createAgentFile(
        agent.scope as "user" | "project",
        newName,
        content,
        projectCwd || undefined,
      );
      await deleteAgentFile(
        agent.scope as "user" | "project",
        agent.file_name,
        projectCwd || undefined,
      );
      showToast(t("agent_saved"), "success");
      inlineRenameFor = null;
      selectedAgent = null;
      selectedContent = null;
      await loadAgents();
    } catch (e) {
      inlineRenameError = String(e);
    } finally {
      inlineRenameSaving = false;
    }
  }

  function cancelInlineRename() {
    inlineRenameFor = null;
    inlineRenameName = "";
    inlineRenameError = "";
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function performDelete() {
    if (!deleteCandidate) return;
    const agent = deleteCandidate;
    deleting = true;
    try {
      await deleteAgentFile(
        agent.scope as "user" | "project",
        agent.file_name,
        projectCwd || undefined,
      );
      showToast(t("agent_deleted", { name: agent.name }), "success");
      deleteCandidate = null;
      selectedAgent = null;
      selectedContent = null;
      await loadAgents();
    } catch (e) {
      showToast(t("agent_deleteFailed", { error: String(e) }), "error");
      deleteCandidate = null;
    } finally {
      deleting = false;
    }
  }

  function isCustomEditable(agent: AgentDefinitionSummary): boolean {
    return !agent.readonly && (agent.scope === "user" || agent.scope === "project");
  }
</script>

<div class="flex h-full min-h-0 flex-col gap-3">
  <!-- Toolbar -->
  <div class="flex items-center justify-between gap-3">
    <div class="min-w-0">
      <h2 class="text-sm font-semibold text-foreground">{t("sidebar_agents")}</h2>
      <p class="text-[11px] text-muted-foreground">
        {t("agent_desc")}
        <span class="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >{totalAgents}</span
        >
      </p>
    </div>
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      onclick={() => {
        editorState = { mode: "create", agent: null };
      }}
    >
      <Icon name="plus" size="xs" />
      {t("agent_createAgent")}
    </button>
  </div>

  <!-- Search -->
  <div class="relative">
    <span
      class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
    >
      <Icon name="search" size="xs" />
    </span>
    <input
      type="text"
      class="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:outline-none"
      placeholder={t("agentsPanel_searchPlaceholder")}
      bind:value={searchQuery}
    />
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-16">
      <Spinner size="md" />
    </div>
  {:else if groupedAgents.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center"
    >
      <p class="text-xs font-medium text-foreground">{t("agentsPanel_noResults")}</p>
    </div>
  {:else}
    <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(220px,260px)_1fr_minmax(320px,1fr)]">
      <!-- Left: scope-grouped agent list -->
      <div class="min-h-0 space-y-4 overflow-y-auto pr-1">
        {#each groupedAgents as group (group.scope)}
          <section>
            <header class="mb-1.5 flex items-baseline justify-between px-1">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {scopeLabel(group.scope)}
              </p>
              <span class="text-[10px] text-muted-foreground/70">{group.agents.length}</span>
            </header>
            <ul class="flex flex-col gap-1">
              {#each group.agents as agent (agent.file_name + agent.source)}
                {@const selected = selectedAgent && isSameAgent(selectedAgent, agent)}
                <li>
                  <button
                    type="button"
                    class="w-full rounded-md border px-2.5 py-2 text-left transition-colors
                      {selected
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:border-border hover:bg-muted/40'}"
                    onclick={() => selectAgent(agent)}
                  >
                    <div class="flex items-center justify-between gap-1.5">
                      <span class="truncate text-[13px] font-medium text-foreground">
                        {agent.name}
                      </span>
                      {#if agent.model}
                        <span
                          class="shrink-0 rounded bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground"
                        >
                          {agent.model}
                        </span>
                      {/if}
                    </div>
                    <div class="mt-0.5 flex items-center gap-1">
                      <span
                        class="rounded px-1.5 py-px text-[9px] font-medium {scopeBadgeClass(agent)}"
                      >
                        {agent.scope}
                      </span>
                      {#if agent.tools && agent.tools.length > 0}
                        <span class="text-[10px] text-muted-foreground">
                          {t("agentsPanel_toolCount", { count: String(agent.tools.length) })}
                        </span>
                      {/if}
                    </div>
                    {#if agent.description}
                      <p class="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {agent.description}
                      </p>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>

      <!-- Middle: detail -->
      <div class="min-h-0 overflow-y-auto rounded-lg border border-border/60 bg-card/40 p-4">
        {#if selectedAgent}
          {#key selectedAgent.file_name + selectedAgent.source}
            <div class="flex flex-col gap-4">
              <header class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h3 class="truncate text-base font-semibold text-foreground">
                      {selectedAgent.name}
                    </h3>
                    {#if selectedAgent.readonly}
                      <span
                        class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {t("agent_readonlyBadge")}
                      </span>
                    {/if}
                  </div>
                  <div class="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span class="rounded px-1.5 py-0.5 {scopeBadgeClass(selectedAgent)}">
                      {selectedAgent.source === "built-in"
                        ? t("agentsPanel_groupBuiltIn")
                        : selectedAgent.scope}
                    </span>
                    {#if selectedAgent.name !== selectedAgent.file_name && selectedAgent.source !== "built-in"}
                      <span class="font-mono">{selectedAgent.file_name}.md</span>
                    {/if}
                  </div>
                </div>
              </header>

              {#if inlineRenameFor && isSameAgent(inlineRenameFor, selectedAgent)}
                <div
                  class="flex flex-col gap-1.5 rounded-md border border-border bg-background p-3"
                >
                  <label
                    for="agent-inline-rename"
                    class="text-[11px] font-medium text-muted-foreground"
                  >
                    {t("agent_renameTitle")}
                  </label>
                  <input
                    id="agent-inline-rename"
                    type="text"
                    class="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
                    bind:value={inlineRenameName}
                    onkeydown={(e) => {
                      if (e.key === "Enter") void commitInlineRename();
                      if (e.key === "Escape") cancelInlineRename();
                    }}
                  />
                  {#if inlineRenameError}
                    <p class="text-[11px] text-destructive">{inlineRenameError}</p>
                  {/if}
                  <div class="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      class="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                      onclick={cancelInlineRename}
                    >
                      {t("common_cancel")}
                    </button>
                    <button
                      type="button"
                      class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      disabled={inlineRenameSaving ||
                        !inlineRenameName ||
                        inlineRenameName === inlineRenameFor.file_name}
                      onclick={() => void commitInlineRename()}
                    >
                      {t("agent_renameConfirm")}
                    </button>
                  </div>
                </div>
              {/if}

              {#if selectedAgent.description}
                <p class="text-xs leading-relaxed text-foreground">{selectedAgent.description}</p>
              {:else}
                <p class="text-xs italic text-muted-foreground">{t("agentsPanel_noDescription")}</p>
              {/if}

              <!-- Property grid -->
              <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {#if selectedAgent.model}
                  <dt class="text-muted-foreground">{t("agent_model")}</dt>
                  <dd class="text-foreground">{selectedAgent.model}</dd>
                {/if}
                {#if selectedAgent.permission_mode}
                  <dt class="text-muted-foreground">{t("agent_permissionMode")}</dt>
                  <dd class="text-foreground">{selectedAgent.permission_mode}</dd>
                {/if}
                {#if selectedAgent.max_turns}
                  <dt class="text-muted-foreground">{t("agent_maxTurns")}</dt>
                  <dd class="text-foreground">{selectedAgent.max_turns}</dd>
                {/if}
                {#if selectedAgent.background}
                  <dt class="text-muted-foreground">{t("agent_background")}</dt>
                  <dd class="text-foreground">{t("agents_yes")}</dd>
                {/if}
                {#if selectedAgent.isolation}
                  <dt class="text-muted-foreground">{t("agent_isolation")}</dt>
                  <dd class="text-foreground">{selectedAgent.isolation}</dd>
                {/if}
              </dl>

              {#if selectedAgent.tools && selectedAgent.tools.length > 0}
                <div>
                  <p
                    class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t("agent_tools")}
                  </p>
                  <div class="flex flex-wrap gap-1">
                    {#each selectedAgent.tools as tool (tool)}
                      <span
                        class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground"
                      >
                        {tool}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if selectedAgent.disallowed_tools && selectedAgent.disallowed_tools.length > 0}
                <div>
                  <p
                    class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {t("agent_disallowedTools")}
                  </p>
                  <div class="flex flex-wrap gap-1">
                    {#each selectedAgent.disallowed_tools as tool (tool)}
                      <span
                        class="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-mono text-destructive"
                      >
                        {tool}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if isCustomEditable(selectedAgent)}
                <footer
                  class="mt-1 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3"
                >
                  <button
                    type="button"
                    class="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                    onclick={() => {
                      editorState = { mode: "edit", agent: selectedAgent };
                    }}
                  >
                    {t("agent_editAgent")}
                  </button>
                  <button
                    type="button"
                    class="rounded-md bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-muted/80"
                    onclick={() => startInlineRename(selectedAgent!)}
                  >
                    {t("agent_renameAgent")}
                  </button>
                  <button
                    type="button"
                    class="rounded-md bg-destructive/10 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/20"
                    onclick={() => (deleteCandidate = selectedAgent)}
                  >
                    {t("agent_deleteAgent")}
                  </button>
                  <span class="text-[10px] text-muted-foreground">
                    {t("agent_changesNextSession")}
                  </span>
                </footer>
              {/if}
            </div>
          {/key}
        {:else}
          <div
            class="flex h-full items-center justify-center text-center text-xs text-muted-foreground"
          >
            {t("agentsPanel_selectHint")}
          </div>
        {/if}
      </div>

      <!-- Right: source preview -->
      <div
        class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-card/40"
      >
        <header
          class="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2"
        >
          <p class="text-[11px] font-medium text-muted-foreground">
            {t("agentsPanel_sourceView")}
          </p>
          {#if selectedAgent}
            <span class="font-mono text-[10px] text-muted-foreground/80">
              {selectedAgent.file_name}.md
            </span>
          {/if}
        </header>
        <div class="min-h-0 flex-1 overflow-auto p-3">
          {#if !selectedAgent}
            <p class="text-[11px] text-muted-foreground">{t("agentsPanel_selectHint")}</p>
          {:else if selectedContentLoading}
            <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Spinner size="sm" />
              <span>…</span>
            </div>
          {:else if selectedContent}
            <pre
              class="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">{selectedContent}</pre>
          {:else}
            <p class="text-[11px] italic text-muted-foreground">
              {selectedAgent.readonly ? t("agent_readonlyBadge") : t("agentsPanel_noDescription")}
            </p>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- Delete confirmation -->
<MiConfirmDialog
  open={deleteCandidate != null}
  title={t("agent_deleteAgent")}
  description={deleteCandidate ? t("agent_deleteConfirm", { name: deleteCandidate.name }) : ""}
  confirmLabel={t("agent_deleteAgent")}
  cancelLabel={t("common_cancel")}
  destructive={true}
  onConfirm={() => {
    if (deleting) return;
    void performDelete();
  }}
  onCancel={() => (deleteCandidate = null)}
/>

<!-- Editor side sheet -->
{#if editorState}
  <div
    class="fixed inset-0 z-40 flex justify-end bg-miwarp-bg-deepest/60"
    onclick={() => (editorState = null)}
    onkeydown={(e) => e.key === "Escape" && (editorState = null)}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div
      class="w-full max-w-lg overflow-y-auto border-l border-border bg-background p-6 shadow-xl"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <AgentEditor
        mode={editorState.mode}
        agent={editorState.agent}
        {projectCwd}
        {existingAgentNames}
        onSave={async () => {
          showToast(
            editorState?.mode === "create" ? t("agent_created") : t("agent_saved"),
            "success",
          );
          editorState = null;
          selectedAgent = null;
          selectedContent = null;
          await loadAgents();
        }}
        onCancel={() => (editorState = null)}
      />
    </div>
  </div>
{/if}
