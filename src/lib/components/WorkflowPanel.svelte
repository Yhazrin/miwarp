<script lang="ts">
  import {
    workflowStore,
    executeWorkflow,
    type WorkflowTemplate,
    type WorkflowStep,
  } from "$lib/stores/workflow-store.svelte";
  import { multiFieldFuzzyMatch } from "$lib/utils/fuzzy";

  let {
    open = $bindable(false),
    onExecute = (step: WorkflowStep) => {
      // Default: dispatch to prompt input
      window.dispatchEvent(new CustomEvent("miwarp:workflow-step", { detail: step }));
    },
  }: {
    open?: boolean;
    onExecute?: (step: WorkflowStep) => void;
  } = $props();

  let searchQuery = $state("");
  let selectedTemplateId = $state<string | null>(null);
  let selectedCategory = $state<WorkflowTemplate["category"] | null>(null);

  // Filtered templates based on search and category
  let filteredTemplates = $derived.by(() => {
    let templates = workflowStore.filteredTemplates;

    if (selectedCategory) {
      templates = templates.filter((t) => t.category === selectedCategory);
    }

    if (searchQuery) {
      templates = templates.filter((t) => {
        const result = multiFieldFuzzyMatch(
          searchQuery,
          { name: t.name, description: t.description, tags: t.tags.join(" ") },
          { threshold: 0.2 },
        );
        return result.matched;
      });
    }

    return templates;
  });

  // Group templates by category
  let groupedTemplates = $derived.by(() => {
    const groups: Record<WorkflowTemplate["category"], WorkflowTemplate[]> = {
      development: [],
      review: [],
      automation: [],
      collaboration: [],
    };
    for (const template of filteredTemplates) {
      groups[template.category].push(template);
    }
    return groups;
  });

  let selectedTemplate = $derived(
    selectedTemplateId ? workflowStore.getTemplate(selectedTemplateId) : null,
  );

  function handleSelectTemplate(template: WorkflowTemplate) {
    selectedTemplateId = template.id;
  }

  async function handleExecuteTemplate() {
    if (!selectedTemplateId) return;

    open = false;

    await executeWorkflow(selectedTemplateId, {
      onStep: (step, _index) => {
        // Dispatch step to be executed
        onExecute(step);
      },
      onComplete: () => {
        workflowStore.recordUsage(selectedTemplateId!);
        selectedTemplateId = null;
      },
      onError: (error: Error) => {
        console.error("Workflow execution error:", error);
        selectedTemplateId = null;
      },
    });
  }

  function handleClose() {
    open = false;
    searchQuery = "";
    selectedTemplateId = null;
    selectedCategory = null;
  }

  // Reset on open
  $effect(() => {
    if (open) {
      workflowStore.loadRecentTemplates();
    }
  });
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    onclick={(e) => {
      if (e.target === e.currentTarget) handleClose();
    }}
    role="dialog"
    aria-modal="true"
  >
    <div class="flex h-[70vh] w-[800px] flex-col rounded-lg bg-background shadow-xl">
      <!-- Header -->
      <div class="flex items-center justify-between border-b px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="text-2xl">⚡</span>
          <div>
            <h2 class="text-lg font-semibold">Workflows</h2>
            <p class="text-xs text-muted-foreground">Quick access to predefined workflows</p>
          </div>
        </div>
        <button class="rounded-md p-1.5 hover:bg-accent" onclick={handleClose} aria-label="Close">
          <svg
            class="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="flex flex-1 overflow-hidden">
        <!-- Left: Template list -->
        <div class="w-1/2 border-r overflow-y-auto">
          <!-- Search -->
          <div class="sticky top-0 z-10 border-b bg-background p-3">
            <div class="relative">
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
                class="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Search workflows..."
                bind:value={searchQuery}
              />
            </div>

            <!-- Category filters -->
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                class="rounded-md px-2 py-1 text-xs transition-colors {selectedCategory === null
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent hover:bg-accent/80'}"
                onclick={() => (selectedCategory = null)}
              >
                All
              </button>
              {#each workflowStore.getCategories() as category}
                {@const cat = category as WorkflowTemplate["category"]}
                <button
                  class="rounded-md px-2 py-1 text-xs transition-colors {selectedCategory === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-accent hover:bg-accent/80'}"
                  onclick={() => (selectedCategory = cat)}
                >
                  {workflowStore.getCategoryIcon(cat)}
                  {workflowStore.getCategoryLabel(cat)}
                </button>
              {/each}
            </div>
          </div>

          <!-- Template list -->
          <div class="p-3 space-y-4">
            {#if filteredTemplates.length === 0}
              <div class="py-8 text-center text-sm text-muted-foreground">No workflows found</div>
            {:else}
              {#each Object.entries(groupedTemplates) as [category, templates]}
                {@const cat = category as WorkflowTemplate["category"]}
                <div class="space-y-1">
                  <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span>{workflowStore.getCategoryIcon(cat)}</span>
                    <span>{workflowStore.getCategoryLabel(cat)}</span>
                  </div>
                  {#each templates as template}
                    {@const isSelected = selectedTemplateId === template.id}
                    <button
                      class="w-full rounded-md p-3 text-left transition-colors {isSelected
                        ? 'bg-accent border border-primary'
                        : 'hover:bg-accent/50 border border-transparent'}"
                      onclick={() => handleSelectTemplate(template)}
                    >
                      <div class="flex items-center gap-3">
                        <span class="text-xl">{template.icon}</span>
                        <div class="flex-1 min-w-0">
                          <div class="font-medium truncate">{template.name}</div>
                          <div class="text-xs text-muted-foreground truncate">
                            {template.description}
                          </div>
                        </div>
                        {#if template.usageCount && template.usageCount > 0}
                          <div class="text-xs text-muted-foreground">
                            {template.usageCount}×
                          </div>
                        {/if}
                      </div>
                      {#if template.tags.length > 0}
                        <div class="mt-2 flex flex-wrap gap-1">
                          {#each template.tags.slice(0, 3) as tag}
                            <span
                              class="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground"
                            >
                              {tag}
                            </span>
                          {/each}
                        </div>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Right: Template detail -->
        <div class="w-1/2 overflow-y-auto p-4">
          {#if selectedTemplate}
            <div class="space-y-4">
              <!-- Template header -->
              <div class="flex items-start gap-3">
                <span class="text-3xl">{selectedTemplate.icon}</span>
                <div>
                  <h3 class="text-lg font-semibold">{selectedTemplate.name}</h3>
                  <p class="text-sm text-muted-foreground">{selectedTemplate.description}</p>
                </div>
              </div>

              <!-- Steps preview -->
              <div class="space-y-2">
                <div class="text-sm font-medium">Steps:</div>
                <div class="space-y-1.5">
                  {#each selectedTemplate.steps as step, index}
                    <div class="flex items-start gap-2 rounded-md bg-accent/50 p-2">
                      <span
                        class="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
                      >
                        {index + 1}
                      </span>
                      <div class="flex-1 min-w-0">
                        <div class="text-xs text-muted-foreground uppercase">
                          {step.type.replace("_", " ")}
                        </div>
                        <div class="text-sm truncate">{step.description || step.value}</div>
                      </div>
                      {#if step.delay}
                        <span class="text-xs text-muted-foreground">+{step.delay}ms</span>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>

              <!-- Required context -->
              {#if selectedTemplate.requiredContext && selectedTemplate.requiredContext.length > 0}
                <div class="space-y-2">
                  <div class="text-sm font-medium">Required context:</div>
                  <div class="flex flex-wrap gap-1.5">
                    {#each selectedTemplate.requiredContext as ctx}
                      <span class="rounded bg-accent px-2 py-1 text-xs">
                        {ctx === "cwd"
                          ? "📁 Working Directory"
                          : ctx === "git"
                            ? "📊 Git Repository"
                            : "💬 Active Session"}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Execute button -->
              <button
                class="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                onclick={handleExecuteTemplate}
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Execute Workflow
              </button>
            </div>
          {:else}
            <div
              class="flex h-full flex-col items-center justify-center text-center text-muted-foreground"
            >
              <span class="text-4xl mb-3">📋</span>
              <p class="text-sm">Select a workflow to see details</p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Prevent body scroll when modal is open */
  :global(body:has(.fixed.inset-0.z-50)) {
    overflow: hidden;
  }
</style>
