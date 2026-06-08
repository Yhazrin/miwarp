<script lang="ts">
  /**
   * Automation Editor Component
   *
   * Visual editor for automation scripts with drag-and-drop step management.
   */
  import { t } from "$lib/i18n/index.svelte";
  import {
    type AutomationScript,
    type AutomationStep,
    getStepTypeInfo,
    createEmptyStep,
  } from "$lib/types/automation";
  import { executeScript, cancelExecution, validateScript } from "$lib/services/automation-service";
  import { browserStore } from "$lib/stores/browser-store.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import StepEditor from "./StepEditor.svelte";

  interface Props {
    script: AutomationScript;
    onSave?: (script: AutomationScript) => void;
    onClose?: () => void;
  }

  let { script, onSave, onClose }: Props = $props();

  // State — initialized from prop via effect to avoid state_referenced_locally
  let editedScript = $state<AutomationScript>({} as AutomationScript);
  $effect(() => {
    editedScript = { ...script };
  });
  let selectedStepIndex = $state<number | null>(null);
  let isDragging = $state(false);
  let dragIndex = $state<number | null>(null);
  let executionLog = $state<
    Array<{ step: string; status: "pending" | "running" | "success" | "failed"; message?: string }>
  >([]);
  let isExecuting = $state(false);
  let executionProgress = $state(0);
  let executionError = $state<string | null>(null);

  // Computed
  const selectedStep = $derived(
    selectedStepIndex !== null ? editedScript.steps[selectedStepIndex] : null,
  );

  const canExecute = $derived(editedScript.steps.length > 0 && browserStore.state.connected);

  const validationResult = $derived(validateScript(editedScript));

  // Methods
  function handleStepSelect(index: number) {
    selectedStepIndex = index;
  }

  function handleStepUpdate(updatedStep: AutomationStep) {
    if (selectedStepIndex !== null) {
      editedScript.steps[selectedStepIndex] = updatedStep;
    }
  }

  function handleAddStep() {
    const newStep = createEmptyStep(editedScript.steps.length + 1);
    editedScript.steps.push(newStep);
    selectedStepIndex = editedScript.steps.length - 1;
  }

  function handleDeleteStep(index: number) {
    editedScript.steps.splice(index, 1);
    // Reorder
    editedScript.steps.forEach((step, i) => {
      step.order = i + 1;
    });
    if (selectedStepIndex === index) {
      selectedStepIndex = null;
    } else if (selectedStepIndex !== null && selectedStepIndex > index) {
      selectedStepIndex--;
    }
  }

  function handleMoveStep(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= editedScript.steps.length) return;

    const steps = [...editedScript.steps];
    const [movedStep] = steps.splice(fromIndex, 1);
    steps.splice(toIndex, 0, movedStep);

    // Update order
    steps.forEach((step, i) => {
      step.order = i + 1;
    });

    editedScript.steps = steps;
    selectedStepIndex = toIndex;
  }

  function handleDuplicateStep(index: number) {
    const step = editedScript.steps[index];
    const duplicate: AutomationStep = {
      ...step,
      id: `step_${Date.now()}`,
      order: editedScript.steps.length + 1,
    };
    editedScript.steps.splice(index + 1, 0, duplicate);
    // Update order for all subsequent steps
    for (let i = index + 1; i < editedScript.steps.length; i++) {
      editedScript.steps[i].order = i + 1;
    }
  }

  function handleSave() {
    editedScript.updatedAt = new Date().toISOString();
    onSave?.(editedScript);
  }

  function handleNameChange(e: Event) {
    const target = e.target as HTMLInputElement;
    editedScript.name = target.value;
  }

  function handleDescriptionChange(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    editedScript.description = target.value;
  }

  function handleCategoryChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    editedScript.category = target.value as AutomationScript["category"];
  }

  function handleTagInput(e: Event) {
    const target = e.target as HTMLInputElement;
    if (e instanceof KeyboardEvent && e.key === "Enter") {
      const tag = target.value.trim();
      if (tag && !editedScript.tags.includes(tag)) {
        editedScript.tags.push(tag);
        target.value = "";
      }
    }
  }

  function handleRemoveTag(tag: string) {
    editedScript.tags = editedScript.tags.filter((t) => t !== tag);
  }

  async function handleExecute() {
    if (!canExecute) return;

    isExecuting = true;
    executionProgress = 0;
    executionError = null;
    executionLog = editedScript.steps.map((step) => ({
      step: step.description || step.type,
      status: "pending" as const,
    }));

    try {
      const tabId = browserStore.state.activeTabId;
      if (!tabId) {
        throw new Error("No active tab");
      }

      const result = await executeScript(editedScript, tabId, {
        onStepStart: (step, index) => {
          executionLog[index] = { step: step.description || step.type, status: "running" };
          executionProgress = (index / editedScript.steps.length) * 100;
        },
        onStepComplete: (step, stepResult) => {
          const index = editedScript.steps.findIndex((s) => s.id === step.id);
          if (index !== -1) {
            executionLog[index] = {
              step: step.description || step.type,
              status: stepResult.success ? "success" : "failed",
              message: stepResult.error,
            };
          }
          executionProgress = ((index + 1) / editedScript.steps.length) * 100;
        },
        onError: (error) => {
          executionError = error.message;
        },
      });

      if (result.success) {
        executionLog = executionLog.map((log) =>
          log.status === "running" ? { ...log, status: "success" as const } : log,
        );
      } else {
        executionError = result.error ?? t("automationEditor_executionFailed");
      }

      executionProgress = 100;
      editedScript.usageCount++;
    } catch (error) {
      executionError =
        error instanceof Error ? error.message : t("automationEditor_executionError");
    } finally {
      isExecuting = false;
    }
  }

  function handleCancelExecution() {
    cancelExecution();
    isExecuting = false;
  }

  // Drag handlers
  function handleDragStart(e: DragEvent, index: number) {
    if (!e.dataTransfer) return;
    dragIndex = index;
    isDragging = true;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  }

  function handleDragOver(e: DragEvent, _index: number) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
  }

  function handleDrop(e: DragEvent, toIndex: number) {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      handleMoveStep(dragIndex, toIndex);
    }
    dragIndex = null;
    isDragging = false;
  }

  function handleDragEnd() {
    dragIndex = null;
    isDragging = false;
  }
</script>

<div class="automation-editor flex h-full flex-col">
  <!-- Header -->
  <div class="flex items-center justify-between border-b px-4 py-3">
    <div class="flex items-center gap-3">
      <Icon name="zap" size="lg" class="text-primary shrink-0" />
      <div>
        <input
          type="text"
          value={editedScript.name}
          oninput={handleNameChange}
          class="text-lg font-semibold focus:outline-none"
          placeholder={t("automationEditor_scriptName")}
        />
      </div>
    </div>
    <div class="flex items-center gap-2">
      {#if !validationResult.valid}
        <span class="text-xs text-destructive">
          {validationResult.errors.length}
          {t("automationEditor_validationErrors")}
        </span>
      {/if}
      <button
        type="button"
        class="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        onclick={handleSave}
      >
        {t("automationEditor_save")}
      </button>
      <button
        type="button"
        class="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        onclick={onClose}
      >
        {t("automationEditor_close")}
      </button>
    </div>
  </div>

  <!-- Content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Left: Steps list -->
    <div class="w-1/2 border-r overflow-y-auto">
      <!-- Metadata -->
      <div class="border-b p-4 space-y-3">
        <div>
          <span class="text-xs font-medium text-muted-foreground"
            >{t("automationEditor_description")}</span
          >
          <textarea
            value={editedScript.description}
            oninput={handleDescriptionChange}
            class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
            rows="2"
            placeholder={t("automationEditor_descriptionPlaceholder")}
          ></textarea>
        </div>

        <div class="flex gap-3">
          <div class="flex-1">
            <span class="text-xs font-medium text-muted-foreground"
              >{t("automationEditor_category")}</span
            >
            <select
              value={editedScript.category}
              onchange={handleCategoryChange}
              class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {#each [["web_scraping", t("automationCat_webScraping")], ["form_automation", t("automationCat_formAutomation")], ["testing", t("automationCat_testing")], ["data_entry", t("automationCat_dataEntry")], ["monitoring", t("automationCat_monitoring")], ["custom", t("automationCat_custom")]] as [value, label]}
                <option {value}>{label}</option>
              {/each}
            </select>
          </div>
        </div>

        <div>
          <span class="text-xs font-medium text-muted-foreground">{t("automationEditor_tags")}</span
          >
          <div class="mt-1 flex flex-wrap gap-1.5">
            {#each editedScript.tags as tag}
              <span class="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-xs">
                {tag}
                <button
                  type="button"
                  class="hover:text-destructive"
                  onclick={() => handleRemoveTag(tag)}
                  aria-label={t("common_remove")}
                >
                  ×
                </button>
              </span>
            {/each}
            <input
              type="text"
              class="flex-1 min-w-[80px] rounded border bg-background px-2 py-0.5 text-xs focus:outline-none"
              placeholder={t("automationEditor_addTag")}
              onkeydown={handleTagInput}
            />
          </div>
        </div>
      </div>

      <!-- Steps -->
      <div class="p-4">
        <div class="mb-3 flex items-center justify-between">
          <span class="text-sm font-medium"
            >{t("automationEditor_steps")} ({editedScript.steps.length})</span
          >
          <button
            type="button"
            class="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
            onclick={handleAddStep}
          >
            + {t("automationEditor_addStep")}
          </button>
        </div>

        {#if editedScript.steps.length === 0}
          <EmptyState
            iconName="clipboard-list"
            title={t("automationEditor_noSteps")}
            variant="dashed"
          />
        {:else}
          <div class="space-y-2">
            {#each editedScript.steps as step, index (step.id)}
              {@const stepInfo = getStepTypeInfo(step.type)}
              <div
                class="group relative rounded-lg border p-3 cursor-move transition-all
                  {selectedStepIndex === index
                  ? 'border-primary bg-primary/5'
                  : 'hover:border-primary/50'}
                  {isDragging && dragIndex === index ? 'opacity-50' : ''}"
                draggable="true"
                role="button"
                tabindex="0"
                onclick={() => handleStepSelect(index)}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleStepSelect(index);
                  }
                }}
                ondragstart={(e) => handleDragStart(e, index)}
                ondragover={(e) => handleDragOver(e, index)}
                ondrop={(e) => handleDrop(e, index)}
                ondragend={handleDragEnd}
              >
                <!-- Drag indicator -->
                <div
                  class="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-50"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5" />
                    <circle cx="15" cy="6" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="18" r="1.5" />
                    <circle cx="15" cy="18" r="1.5" />
                  </svg>
                </div>

                <!-- Step content -->
                <div class="flex items-start gap-3 pl-4">
                  <span
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium"
                  >
                    {step.order}
                  </span>
                  <Icon name={stepInfo.icon} size="md" class="text-muted-foreground shrink-0" />
                  <div class="flex-1 min-w-0">
                    <div class="font-medium">{stepInfo.label}</div>
                    {#if step.description}
                      <div class="text-xs text-muted-foreground truncate">
                        {step.description}
                      </div>
                    {/if}
                    <div class="text-[10px] text-muted-foreground mt-0.5">
                      {#if step.params.url}
                        → {step.params.url}
                      {:else if step.params.coordinate}
                        @ [{step.params.coordinate.join(", ")}]
                      {:else if step.params.text}
                        "{step.params.text.slice(0, 20)}..."
                      {:else if step.params.duration}
                        {step.params.duration}ms
                      {:else if step.params.script}
                        JS: {step.params.script.slice(0, 30)}...
                      {:else}
                        {Object.keys(step.params).length} params
                      {/if}
                    </div>
                  </div>

                  <!-- Actions -->
                  <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      class="rounded p-1 hover:bg-accent"
                      title={t("automationEditor_duplicate")}
                      aria-label={t("automationEditor_duplicate")}
                      onclick={(e) => {
                        e.stopPropagation();
                        handleDuplicateStep(index);
                      }}
                    >
                      <Icon name="external-link" size="sm" />
                    </button>
                    <button
                      type="button"
                      class="rounded p-1 hover:bg-destructive/10 hover:text-destructive"
                      title={t("automationEditor_delete")}
                      aria-label={t("automationEditor_delete")}
                      onclick={(e) => {
                        e.stopPropagation();
                        handleDeleteStep(index);
                      }}
                    >
                      <Icon name="trash" size="sm" />
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Right: Step editor / Preview -->
    <div class="w-1/2 overflow-y-auto p-4">
      {#if selectedStep}
        <StepEditor step={selectedStep} onUpdate={handleStepUpdate} />
      {:else}
        <EmptyState iconName="mouse-pointer-click" title={t("automationEditor_selectStep")} />
      {/if}

      <!-- Execution controls -->
      <div class="mt-4 rounded-lg border bg-card p-4">
        <h3 class="text-sm font-medium mb-3">{t("automationEditor_execution")}</h3>

        {#if !browserStore.state.connected}
          <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <Icon name="triangle-alert" size="sm" class="inline shrink-0" />
            {t("automationEditor_browserRequired")}
          </div>
        {:else if isExecuting}
          <div class="space-y-3">
            <div class="h-2 rounded-full bg-accent overflow-hidden">
              <div
                class="h-full bg-primary transition-all duration-300"
                style="width: {executionProgress}%"
              ></div>
            </div>
            <div class="text-xs text-muted-foreground">
              {executionProgress.toFixed(0)}% complete
            </div>
            <div class="space-y-1 max-h-32 overflow-y-auto">
              {#each executionLog as log}
                <div class="flex items-center gap-2 text-xs">
                  {#if log.status === "pending"}
                    <span class="h-3 w-3 rounded-full bg-muted"></span>
                  {:else if log.status === "running"}
                    <span class="h-3 w-3 animate-pulse rounded-full bg-primary"></span>
                  {:else if log.status === "success"}
                    <Icon name="check" size="sm" class="text-miwarp-status-success" />
                  {:else}
                    <Icon name="x" size="sm" class="text-destructive" />
                  {/if}
                  <span class={log.status === "failed" ? "text-destructive" : ""}>
                    {log.step}
                  </span>
                </div>
              {/each}
            </div>
            <button
              type="button"
              class="w-full rounded-md border border-destructive px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
              onclick={handleCancelExecution}
            >
              Cancel
            </button>
          </div>
        {:else}
          <button
            type="button"
            class="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onclick={handleExecute}
            disabled={!canExecute}
          >
            <Icon name="play" size="sm" class="inline" />
            {t("automationEditor_execute")}
          </button>
          {#if executionError}
            <div class="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              {executionError}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>
