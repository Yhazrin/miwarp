<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { showToast as globalToast } from "$lib/stores/toast-store.svelte";
  import { createSkill, updateSkill, getSkillContent } from "$lib/api";
  import type { StandaloneSkill } from "$lib/types";

  let {
    projectCwd = "",
    onSaved,
    onClose,
  }: {
    projectCwd?: string;
    onSaved: () => Promise<void>;
    onClose: () => void;
  } = $props();

  // Editor state
  let editorMode = $state<null | "new" | "edit">(null);
  let editorName = $state("");
  let editorDescription = $state("");
  let editorContent = $state("");
  let editorScope = $state<"user" | "project">("user");
  let editorPath = $state("");
  let editorSaving = $state(false);

  export function startNewSkill() {
    editorMode = "new";
    editorName = "";
    editorDescription = "Brief description";
    editorContent = "# New Skill\n\nInstructions for Claude...";
    editorScope = "user";
    editorPath = "";
  }

  export function startEditSkill(skill: StandaloneSkill) {
    editorMode = "edit";
    editorName = skill.name;
    editorDescription = skill.description;
    editorPath = skill.path;
    editorScope = (skill.scope as "user" | "project") ?? "user";
    getSkillContent(skill.path, projectCwd || undefined)
      .then((raw) => {
        editorContent = raw;
      })
      .catch((e) => {
        editorContent = t("plugin_loadFailedContent");
        dbgWarn("plugins", "edit load error", e);
      });
  }

  function cancelEditor() {
    editorMode = null;
    editorName = "";
    editorDescription = "";
    editorContent = "";
    editorPath = "";
    onClose();
  }

  async function handleCreateSkill() {
    const name = editorName.trim();
    if (!name) {
      globalToast(t("plugin_skillNameRequired"), "error");
      return;
    }
    editorSaving = true;
    dbg("plugins", "createSkill", { name, scope: editorScope });
    try {
      const skill = await createSkill(
        name,
        editorDescription.trim(),
        editorContent,
        editorScope,
        projectCwd || undefined,
      );
      globalToast(t("plugin_createdSkill", { name: skill.name }), "success");
      cancelEditor();
      await onSaved();
    } catch (e) {
      globalToast(t("plugin_failedCreateSkill", { error: String(e) }), "error");
    } finally {
      editorSaving = false;
    }
  }

  async function handleSaveSkill() {
    editorSaving = true;
    dbg("plugins", "updateSkill", { path: editorPath });
    try {
      await updateSkill(editorPath, editorContent, projectCwd || undefined);
      globalToast(t("plugin_skillSaved"), "success");
      cancelEditor();
      await onSaved();
    } catch (e) {
      globalToast(t("plugin_failedSaveSkill", { error: String(e) }), "error");
    } finally {
      editorSaving = false;
    }
  }

  export function isOpen() {
    return editorMode !== null;
  }
</script>

{#if editorMode === "new" || editorMode === "edit"}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-miwarp-overlay backdrop-blur-sm"
    onclick={(e) => {
      if (e.target === e.currentTarget) cancelEditor();
    }}
    onkeydown={(e) => {
      if (e.key === "Escape") cancelEditor();
    }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div
      class="w-full max-w-lg rounded-2xl border border-border/40 bg-background/95 backdrop-blur-md shadow-2xl max-h-[85vh] flex flex-col mx-4"
      role="presentation"
      onclick={(e) => e.stopPropagation()}
    >
      <div
        class="flex items-center justify-between px-5 py-4 border-b border-border shrink-0"
      >
        <h3 class="text-sm font-semibold text-foreground">
          {editorMode === "new" ? t("plugin_createSkill") : t("extensions_editSkill")}
        </h3>
        <button
          type="button"
          class="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Close"
          onclick={cancelEditor}
        >
          <Icon name="x" size="md" />
        </button>
      </div>

      <div class="px-5 py-4 space-y-4 overflow-y-auto">
        {#if editorMode === "new"}
          <div>
            <label
              for="plugin-editor-name"
              class="block text-xs font-medium text-muted-foreground mb-1"
              >{t("plugin_editorName")}</label
            >
            <input
              id="plugin-editor-name"
              type="text"
              placeholder={t("plugins_skillNamePlaceholder")}
              class="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              bind:value={editorName}
            />
          </div>

          <div>
            <label
              for="plugin-editor-desc"
              class="block text-xs font-medium text-muted-foreground mb-1"
              >{t("plugin_editorDescription")}</label
            >
            <input
              id="plugin-editor-desc"
              type="text"
              placeholder={t("plugins_skillDescPlaceholder")}
              class="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              bind:value={editorDescription}
            />
          </div>

          <div>
            <label
              for="plugin-editor-scope"
              class="block text-xs font-medium text-muted-foreground mb-1"
              >{t("plugin_editorScope")}</label
            >
            <select
              id="plugin-editor-scope"
              class="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              bind:value={editorScope}
            >
              <option value="user">{t("plugin_editorScopeUser")}</option>
              <option value="project" disabled={!projectCwd}>
                {t("plugin_editorScopeProject")}
                {projectCwd ? "" : t("plugin_editorNoProject")}
              </option>
            </select>
            <p class="text-[11px] text-muted-foreground mt-1">
              {editorScope === "user"
                ? t("extensions_scopeUserDesc")
                : t("extensions_scopeProjectDesc")}
            </p>
            {#if !projectCwd && editorScope === "user"}
              <p class="text-[11px] text-[hsl(var(--miwarp-status-warning)/0.8)] mt-0.5">
                {t("extensions_noWorkspaceForProjectScope")}
              </p>
            {/if}
          </div>
        {/if}

        <div>
          <label
            for="plugin-editor-content"
            class="block text-xs font-medium text-muted-foreground mb-1"
            >{editorMode === "new"
              ? t("plugin_editorContent")
              : t("plugin_skillMdContent")}</label
          >
          <textarea
            id="plugin-editor-content"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            rows="12"
            placeholder={t("plugins_skillContentPlaceholder")}
            bind:value={editorContent}
          ></textarea>
        </div>
      </div>

      <div class="flex justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
        <button
          type="button"
          class="rounded-lg border border-border px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onclick={cancelEditor}>{t("common_cancel")}</button
        >
        <button
          type="button"
          class="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          onclick={editorMode === "new" ? handleCreateSkill : handleSaveSkill}
          disabled={editorSaving || (editorMode === "new" && !editorName.trim())}
        >
          {editorSaving
            ? t("plugin_saving")
            : editorMode === "new"
              ? t("plugin_createSkill")
              : t("plugin_saveChanges")}
        </button>
      </div>
    </div>
  </div>
{/if}
