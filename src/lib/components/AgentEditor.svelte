<script lang="ts">
  /**
   * AgentEditor — slide-over editor for user/project agent definitions.
   *
   * v1.0.9 redesign: collapse advanced fields (maxTurns / effort / memory /
   * background / isolation / initialPrompt) into a single disclosure; reorder
   * fields so the eye lands on name → description → system prompt first.
   * Drop the "(view)" suffix on the form tab — read-only state is already
   * obvious from the disabled inputs.
   */
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { createAgentFile, updateAgentFile, readAgentFile } from "$lib/api";
  import {
    serializeAgentFile,
    parseAgentFile,
    validateAgentForm,
    validateSourceContent,
    extractFrontmatterName,
    defaultFormData,
    type AgentFormData,
  } from "$lib/utils/agent-editor";
  import type { AgentDefinitionSummary } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";

  let {
    mode,
    agent = null,
    projectCwd = "",
    existingAgentNames = [],
    onSave,
    onCancel,
  }: {
    mode: "create" | "edit";
    agent?: AgentDefinitionSummary | null;
    projectCwd: string;
    existingAgentNames: string[];
    onSave: () => void;
    onCancel: () => void;
  } = $props();

  // ── State ────────────────────────────────────────────────────────────────
  let editorMode = $state<"form" | "source">("form");
  let showAdvanced = $state(false);
  let formData = $state<AgentFormData>(defaultFormData());
  let sourceContent = $state("");
  let scope = $state<"user" | "project">("user");
  let saving = $state(false);
  let errors = $state<string[]>([]);
  let toolInput = $state("");

  $effect(() => {
    editorMode = mode === "create" ? "form" : "source";
  });

  $effect(() => {
    if (mode === "edit" && agent) {
      scope = agent.scope as "user" | "project";
      loadAgentContent();
    } else {
      formData = defaultFormData();
      sourceContent = "";
      scope = "user";
    }
  });

  async function loadAgentContent() {
    if (!agent) return;
    try {
      const content = await readAgentFile(
        agent.scope as "user" | "project",
        agent.file_name,
        projectCwd || undefined,
      );
      sourceContent = content;
      formData = parseAgentFile(content);
      dbg("agent-editor", "loaded content", { fileName: agent.file_name });
    } catch (e) {
      dbgWarn("agent-editor", "failed to load", e);
      errors = [`Failed to load agent: ${e}`];
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    saving = true;
    errors = [];

    try {
      if (mode === "create") {
        if (editorMode === "form") {
          const validationErrors = validateAgentForm(formData);
          if (validationErrors.length > 0) {
            errors = validationErrors.map((e) => `${e.field}: ${e.message}`);
            saving = false;
            return;
          }
          const content = serializeAgentFile(formData);
          await createAgentFile(scope, formData.name, content, projectCwd || undefined);
          dbg("agent-editor", "created (form)", { fileName: formData.name, scope });
        } else {
          const validation = validateSourceContent(sourceContent, existingAgentNames);
          if (!validation.valid) {
            errors = validation.warnings;
            saving = false;
            return;
          }
          const fileName = extractFrontmatterName(sourceContent) || "new-agent";
          await createAgentFile(scope, fileName, sourceContent, projectCwd || undefined);
          dbg("agent-editor", "created (source)", { fileName, scope });
        }
      } else if (mode === "edit" && agent) {
        if (editorMode === "source") {
          const validation = validateSourceContent(
            sourceContent,
            existingAgentNames.filter((n) => n !== agent?.name),
          );
          if (!validation.valid) {
            errors = validation.warnings;
            saving = false;
            return;
          }
        }
        const content = editorMode === "source" ? sourceContent : serializeAgentFile(formData);
        await updateAgentFile(
          agent.scope as "user" | "project",
          agent.file_name,
          content,
          projectCwd || undefined,
        );
        dbg("agent-editor", "updated", { fileName: agent.file_name });
      }
      onSave();
    } catch (e) {
      dbgWarn("agent-editor", "save failed", e);
      errors = [String(e)];
    } finally {
      saving = false;
    }
  }

  function handleForceSave() {
    errors = [];
    saving = true;
    const content = editorMode === "source" ? sourceContent : serializeAgentFile(formData);
    const doSave = async () => {
      try {
        if (mode === "create") {
          const fileName = editorMode === "form" ? formData.name : formData.name || "new-agent";
          await createAgentFile(scope, fileName, content, projectCwd || undefined);
        } else if (agent) {
          await updateAgentFile(
            agent.scope as "user" | "project",
            agent.file_name,
            content,
            projectCwd || undefined,
          );
        }
        onSave();
      } catch (e) {
        errors = [String(e)];
      } finally {
        saving = false;
      }
    };
    void doSave();
  }

  function addTool() {
    const tool = toolInput.trim();
    if (tool && !formData.tools.includes(tool)) {
      formData.tools = [...formData.tools, tool];
      toolInput = "";
    }
  }

  function removeTool(tool: string) {
    formData.tools = formData.tools.filter((t) => t !== tool);
  }

  const AVAILABLE_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "Task",
    "NotebookEdit",
  ];
</script>

<div class="flex flex-col gap-4">
  <!-- Header with mode toggle -->
  <div class="flex items-center justify-between">
    <h3 class="text-base font-semibold text-foreground">
      {mode === "create" ? t("agent_createAgent") : t("agent_editAgent")}
    </h3>
    <div class="flex gap-0.5 rounded-md bg-muted p-0.5">
      <button
        type="button"
        class="rounded px-2.5 py-1 text-xs transition-colors
          {editorMode === 'form'
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => {
          editorMode = "form";
          if (sourceContent) formData = parseAgentFile(sourceContent);
        }}
      >
        {t("agentsPanel_basic")}
      </button>
      <button
        type="button"
        class="rounded px-2.5 py-1 text-xs transition-colors
          {editorMode === 'source'
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => {
          editorMode = "source";
          if (mode === "create" && !sourceContent) {
            sourceContent = serializeAgentFile(formData);
          }
        }}
      >
        {t("agentsPanel_sourceView")}
      </button>
    </div>
  </div>

  {#if errors.length > 0}
    <div class="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 p-3">
      {#each errors as error}
        <p class="text-xs text-destructive">{error}</p>
      {/each}
      {#if mode === "edit" && editorMode === "source"}
        <button
          type="button"
          class="text-xs text-muted-foreground underline hover:text-foreground"
          onclick={handleForceSave}
        >
          {t("agentEditor_forceSave")}
        </button>
      {/if}
    </div>
  {/if}

  {#if editorMode === "form"}
    <div class="flex flex-col gap-3">
      <!-- Name -->
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-foreground">{t("agent_name")} *</span>
        <input
          type="text"
          class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground
            focus:border-ring focus:outline-none disabled:opacity-50"
          placeholder={t("agentEditor_placeholderName")}
          bind:value={formData.name}
          disabled={mode === "edit"}
        />
        <span class="mt-0.5 block text-[11px] text-muted-foreground">{t("agent_nameFormat")}</span>
      </label>

      <!-- Description -->
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-foreground"
          >{t("agent_description")} *</span
        >
        <textarea
          class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground
            focus:border-ring focus:outline-none resize-none disabled:opacity-50"
          rows="2"
          placeholder={t("agentEditor_placeholderDesc")}
          bind:value={formData.description}
          disabled={mode === "edit"}
        ></textarea>
      </label>

      <!-- Scope (create only) -->
      {#if mode === "create"}
        <div>
          <span class="mb-1 block text-xs font-medium text-foreground"
            >{t("agentEditor_scope")}</span
          >
          <div class="inline-flex rounded-md bg-muted p-0.5">
            <button
              type="button"
              class="rounded px-3 py-1 text-xs transition-colors
                {scope === 'user'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (scope = "user")}
            >
              {t("agent_scopeUser")}
            </button>
            <button
              type="button"
              class="rounded px-3 py-1 text-xs transition-colors
                {scope === 'project'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (scope = "project")}
            >
              {t("agent_scopeProject")}
            </button>
          </div>
        </div>
      {/if}

      <!-- Model -->
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-foreground">{t("agent_model")}</span>
        <select
          class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground
            focus:border-ring focus:outline-none disabled:opacity-50"
          bind:value={formData.model}
          disabled={mode === "edit"}
        >
          <option value="inherit">{t("agent_inherit")}</option>
          <option value="sonnet">sonnet</option>
          <option value="opus">opus</option>
          <option value="haiku">haiku</option>
        </select>
      </label>

      <!-- Tools -->
      <div>
        <span class="mb-1 block text-xs font-medium text-foreground">{t("agent_tools")}</span>
        {#if formData.tools.length > 0}
          <div class="mb-1.5 flex flex-wrap gap-1">
            {#each formData.tools as tool (tool)}
              <span
                class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
              >
                {tool}
                {#if mode === "create"}
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${tool}`}
                    onclick={() => removeTool(tool)}>×</button
                  >
                {/if}
              </span>
            {/each}
          </div>
        {:else}
          <p class="mb-1.5 text-[11px] text-muted-foreground">{t("agent_allTools")}</p>
        {/if}
        {#if mode === "create"}
          <div class="flex gap-1">
            <select
              class="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
              bind:value={toolInput}
            >
              <option value="">{t("agentEditor_addTool")}</option>
              {#each AVAILABLE_TOOLS.filter((t) => !formData.tools.includes(t)) as tool (tool)}
                <option value={tool}>{tool}</option>
              {/each}
            </select>
            <button
              type="button"
              class="rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/80 disabled:opacity-50"
              onclick={addTool}
              disabled={!toolInput}
            >
              <Icon name="plus" size="xs" />
            </button>
          </div>
        {/if}
      </div>

      <!-- System prompt (always visible — primary content) -->
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-foreground">{t("agent_systemPrompt")}</span
        >
        <textarea
          class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground
            focus:border-ring focus:outline-none resize-y disabled:opacity-50"
          rows="8"
          placeholder={t("agentEditor_placeholderSystemPrompt")}
          bind:value={formData.systemPrompt}
          disabled={mode === "edit"}
        ></textarea>
      </label>

      <!-- Advanced disclosure -->
      <details class="rounded-md border border-border/60 bg-card/40" bind:open={showAdvanced}>
        <summary
          class="cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground select-none"
        >
          <span class="inline-flex items-center gap-1.5">
            <Icon name={showAdvanced ? "chevron-down" : "chevron-right"} size="xs" />
            {t("agentsPanel_advanced")}
          </span>
        </summary>
        <div class="flex flex-col gap-3 border-t border-border/60 p-3">
          <!-- Permission mode -->
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground"
              >{t("agent_permissionMode")}</span
            >
            <select
              class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground
                focus:border-ring focus:outline-none disabled:opacity-50"
              bind:value={formData.permissionMode}
              disabled={mode === "edit"}
            >
              <option value="default">{t("agentEditor_permDefault")}</option>
              <option value="acceptEdits">{t("agentEditor_permAcceptEdits")}</option>
              <option value="dontAsk">{t("agentEditor_permDontAsk")}</option>
              <option value="bypassPermissions">{t("agentEditor_permBypass")}</option>
              <option value="plan">{t("agentEditor_permPlan")}</option>
            </select>
          </label>

          <!-- Max turns -->
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground">{t("agent_maxTurns")}</span
            >
            <input
              type="number"
              class="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground
                focus:border-ring focus:outline-none disabled:opacity-50"
              placeholder="10"
              value={formData.maxTurns ?? ""}
              oninput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                formData.maxTurns = v ? parseInt(v, 10) : null;
              }}
              disabled={mode === "edit"}
            />
          </label>

          <!-- Memory -->
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground">{t("agent_memory")}</span>
            <input
              type="text"
              class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground
                focus:border-ring focus:outline-none disabled:opacity-50"
              placeholder="MEMORY.md"
              bind:value={formData.memory}
              disabled={mode === "edit"}
            />
            <span class="mt-0.5 block text-[11px] text-muted-foreground"
              >{t("agent_memory_hint")}</span
            >
          </label>

          <!-- Initial prompt -->
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground"
              >{t("agent_initialPrompt")}</span
            >
            <input
              type="text"
              class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground
                focus:border-ring focus:outline-none disabled:opacity-50"
              placeholder={t("agentEditor_placeholderAutoSubmit")}
              bind:value={formData.initialPrompt}
              disabled={mode === "edit"}
            />
          </label>

          <!-- Checkboxes -->
          <div class="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <label class="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                class="h-3.5 w-3.5 rounded border-border"
                bind:checked={formData.background}
                disabled={mode === "edit"}
              />
              {t("agent_background")}
            </label>
            <label class="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                class="h-3.5 w-3.5 rounded border-border"
                checked={formData.isolation === "worktree"}
                onchange={(e) => {
                  formData.isolation = (e.target as HTMLInputElement).checked ? "worktree" : "";
                }}
                disabled={mode === "edit"}
              />
              {t("agent_isolation")}
            </label>
          </div>
        </div>
      </details>
    </div>
  {:else}
    <!-- Source Mode -->
    <div>
      {#if mode === "create"}
        <div class="mb-3">
          <span class="mb-1 block text-xs font-medium text-foreground"
            >{t("agentEditor_scope")}</span
          >
          <div class="inline-flex rounded-md bg-muted p-0.5">
            <button
              type="button"
              class="rounded px-3 py-1 text-xs transition-colors
                {scope === 'user'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (scope = "user")}
            >
              {t("agent_scopeUser")}
            </button>
            <button
              type="button"
              class="rounded px-3 py-1 text-xs transition-colors
                {scope === 'project'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (scope = "project")}
            >
              {t("agent_scopeProject")}
            </button>
          </div>
        </div>
      {:else}
        <p class="mb-2 text-[11px] text-muted-foreground">
          {t("agentEditor_scope")}: {agent?.scope === "user"
            ? t("agent_scopeUser")
            : t("agent_scopeProject")}
        </p>
      {/if}
      <textarea
        class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground
          focus:border-ring focus:outline-none resize-y"
        rows="22"
        bind:value={sourceContent}
        spellcheck="false"
      ></textarea>
    </div>
  {/if}

  <!-- Footer -->
  <div class="flex justify-end gap-2 border-t border-border/60 pt-3">
    <button
      type="button"
      class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      onclick={onCancel}
    >
      {t("common_cancel")}
    </button>
    <button
      type="button"
      class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      onclick={handleSave}
      disabled={saving}
    >
      {saving
        ? t("agentEditor_saving")
        : mode === "create"
          ? t("agent_createAgent")
          : t("agentEditor_save")}
    </button>
  </div>
</div>
