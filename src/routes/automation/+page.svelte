<script lang="ts">
  /**
   * Automation Scripts Page
   *
   * Main page for managing automation scripts.
   */
  import { t } from "$lib/i18n/index.svelte";
  import { automationStore } from "$lib/stores/automation-store.svelte";
  import { AUTOMATION_CATEGORIES, type AutomationScript } from "$lib/types/automation";
  import { createEmptyScript } from "$lib/types/automation";
  import AutomationScriptCard from "$lib/components/AutomationScriptCard.svelte";
  import AutomationEditor from "$lib/components/AutomationEditor.svelte";

  // State
  let searchQuery = $state("");
  let selectedCategory = $state<string | null>(null);
  let showEditor = $state(false);
  let editingScript = $state<AutomationScript | null>(null);
  let showNewScriptDialog = $state(false);
  let newScriptName = $state("");

  // Load scripts on mount
  $effect(() => {
    automationStore.loadScripts();
  });

  // Computed
  const filteredScripts = $derived.by(() => {
    let scripts = automationStore.state.scripts;

    if (selectedCategory) {
      scripts = scripts.filter((s) => s.category === selectedCategory);
    }

    if (searchQuery) {
      scripts = automationStore.searchScripts(searchQuery);
    }

    return scripts;
  });

  const groupedScripts = $derived(automationStore.scriptsByCategory);

  const CATEGORY_I18N: Record<string, string> = {
    web_scraping: "automationCat_webScraping",
    form_automation: "automationCat_formAutomation",
    testing: "automationCat_testing",
    data_entry: "automationCat_dataEntry",
    monitoring: "automationCat_monitoring",
    custom: "automationCat_custom",
  };

  // Methods
  function handleNewScript() {
    if (!newScriptName.trim()) return;

    const script = createEmptyScript();
    script.name = newScriptName.trim();

    automationStore.addScript(script);
    editingScript = script;
    showEditor = true;
    showNewScriptDialog = false;
    newScriptName = "";
  }

  function handleEditScript(script: AutomationScript) {
    editingScript = { ...script };
    showEditor = true;
  }

  function handleSaveScript(script: AutomationScript) {
    automationStore.updateScript(script);
    showEditor = false;
    editingScript = null;
  }

  function handleDeleteScript(script: AutomationScript) {
    if (confirm(`Delete "${script.name}"?`)) {
      automationStore.deleteScript(script.id);
    }
  }

  function handleDuplicateScript(script: AutomationScript) {
    const duplicate = createEmptyScript();
    duplicate.name = `${script.name} (Copy)`;
    duplicate.description = script.description;
    duplicate.category = script.category;
    duplicate.steps = script.steps.map((s) => ({ ...s }));
    duplicate.tags = [...script.tags];

    automationStore.addScript(duplicate);
  }

  function handleExecuteScript(_script: AutomationScript) {
    // Will be implemented with browser store
  }

  function handleExportScript(scriptId: string) {
    const json = automationStore.exportScript(scriptId);
    if (json) {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `automation-${scriptId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function handleImportScript() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      const script = automationStore.importScript(text);

      if (script) {
        editingScript = script;
        showEditor = true;
      }
    };
    input.click();
  }
</script>

<div class="automation-page h-full overflow-y-auto">
  <!-- Header -->
  <div class="border-b px-6 py-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold flex items-center gap-2">
          <span>⚡</span>
          {t("automation_title") || "Automation Scripts"}
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
          {t("automation_subtitle")}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          onclick={handleImportScript}
        >
          📥 {t("automation_import")}
        </button>
        <button
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onclick={() => (showNewScriptDialog = true)}
        >
          + {t("automation_newScript")}
        </button>
      </div>
    </div>
  </div>

  <!-- Content -->
  <div class="p-6">
    <!-- Search and filters -->
    <div class="mb-6 flex flex-wrap items-center gap-4">
      <div class="relative flex-1 min-w-[200px]">
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
          class="h-9 w-full rounded-md border bg-background pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          placeholder={t("automation_searchPlaceholder")}
        />
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-full px-3 py-1 text-xs font-medium transition-colors
            {selectedCategory === null
            ? 'bg-primary text-primary-foreground'
            : 'bg-accent text-accent-foreground hover:bg-accent/80'}"
          onclick={() => (selectedCategory = null)}
        >
          {t("automation_all")} ({automationStore.state.scripts.length})
        </button>
        {#each AUTOMATION_CATEGORIES as cat}
          {@const count = groupedScripts[cat.value]?.length ?? 0}
          <button
            class="rounded-full px-3 py-1 text-xs font-medium transition-colors
              {selectedCategory === cat.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-accent text-accent-foreground hover:bg-accent/80'}"
            onclick={() => (selectedCategory = cat.value)}
          >
            {cat.icon}
            {CATEGORY_I18N[cat.value] ? t(CATEGORY_I18N[cat.value] as never) : cat.label} ({count})
          </button>
        {/each}
      </div>
    </div>

    <!-- Scripts grid -->
    {#if filteredScripts.length === 0}
      <div class="rounded-lg border border-dashed p-12 text-center">
        <span class="text-5xl mb-4 block">⚡</span>
        <h3 class="text-lg font-medium mb-2">{t("automation_emptyTitle")}</h3>
        <p class="text-sm text-muted-foreground mb-4">
          {t("automation_emptyDesc")}
        </p>
        <button
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onclick={() => (showNewScriptDialog = true)}
        >
          {t("automation_createScript")}
        </button>
      </div>
    {:else}
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each filteredScripts as script (script.id)}
          <AutomationScriptCard
            {script}
            onSelect={handleEditScript}
            onEdit={handleEditScript}
            onExecute={handleExecuteScript}
            onDelete={handleDeleteScript}
            onDuplicate={handleDuplicateScript}
          />
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- New Script Dialog -->
{#if showNewScriptDialog}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    onclick={(e) => {
      if (e.target === e.currentTarget) showNewScriptDialog = false;
    }}
    onkeydown={(e) => {
      if (e.key === "Escape") showNewScriptDialog = false;
    }}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="w-[400px] rounded-lg bg-background p-6 shadow-xl">
      <h2 class="text-lg font-semibold mb-4">{t("automation_createDialogTitle")}</h2>

      <div class="space-y-4">
        <div>
          <label for="new-script-name" class="text-sm font-medium">{t("automation_scriptName")}</label>
          <input
            id="new-script-name"
            type="text"
            bind:value={newScriptName}
            class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder={t("automation_scriptNamePlaceholder")}
            onkeydown={(e) => {
              if (e.key === "Enter") handleNewScript();
            }}
          />
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-3">
        <button
          class="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          onclick={() => {
            showNewScriptDialog = false;
            newScriptName = "";
          }}
        >
          {t("automation_cancel")}
        </button>
        <button
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          onclick={handleNewScript}
          disabled={!newScriptName.trim()}
        >
          {t("automation_create")}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Editor Modal -->
{#if showEditor && editingScript}
  <div class="fixed inset-0 z-50 bg-background">
    <AutomationEditor
      script={editingScript}
      onSave={handleSaveScript}
      onClose={() => {
        showEditor = false;
        editingScript = null;
      }}
    />
  </div>
{/if}
