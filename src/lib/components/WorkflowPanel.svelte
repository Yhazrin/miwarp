<script lang="ts">
  /**
   * WorkflowPanel - Guided Workflows UI Component
   *
   * Provides step indicator, current step details, and navigation controls.
   */
  import { workflowStore } from "$lib/stores/workflow-store.svelte";
  import type { WorkflowTemplate, WorkflowStep } from "$lib/types/workflow";
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    onExecute?: (step: WorkflowStep) => Promise<void>;
    onNotify?: (message: string) => void;
  }

  let { onExecute, onNotify }: Props = $props();

  // Local UI state
  let showTemplateSelector = $state(false);
  let showContextPanel = $state(false);
  let customPrompt = $state("");

  // Derived state
  let templates = $derived(workflowStore.templates);
  let activeTemplate = $derived(workflowStore.activeTemplate);
  let currentStep = $derived(workflowStore.currentStep);
  let activeInstance = $derived(workflowStore.state.activeInstance);
  let isRunning = $derived(workflowStore.isRunning);
  let isWaiting = $derived(workflowStore.isWaiting);
  let progress = $derived(workflowStore.progress);
  let error = $derived(workflowStore.state.error);
  let isExecuting = $derived(workflowStore.state.isExecuting);

  // Category colors
  const categoryColors: Record<string, { bg: string; text: string }> = {
    development: { bg: "bg-indigo-500/10", text: "text-indigo-500" },
    review: { bg: "bg-amber-500/10", text: "text-amber-500" },
    testing: { bg: "bg-emerald-500/10", text: "text-emerald-500" },
    documentation: { bg: "bg-blue-500/10", text: "text-blue-500" },
    deployment: { bg: "bg-red-500/10", text: "text-red-500" },
    custom: { bg: "bg-violet-500/10", text: "text-violet-500" },
  };

  function handleSelectTemplate(template: WorkflowTemplate) {
    workflowStore.startWorkflow(template.id);
    showTemplateSelector = false;
    customPrompt = "";
  }

  function handleStart() {
    if (!activeInstance) return;
    if (currentStep?.interventionLevel && currentStep.interventionLevel >= 2) {
      workflowStore.waitForIntervention();
    } else {
      workflowStore.resumeWorkflow();
    }
  }

  async function handleNext() {
    if (!currentStep) return;

    if (currentStep.interventionLevel >= 1 && !customPrompt.trim()) {
      workflowStore.waitForIntervention();
      onNotify?.(t("workflow_fillPromptFirst"));
      return;
    }

    workflowStore.state.isExecuting = true;
    try {
      if (onExecute) {
        await onExecute(currentStep);
      }
      await workflowStore.nextStep({
        prompt: customPrompt,
        executedAt: new Date().toISOString(),
      });
      customPrompt = "";
    } catch (e) {
      workflowStore.failStep(String(e));
    } finally {
      workflowStore.state.isExecuting = false;
    }
  }

  function handlePrev() {
    workflowStore.prevStep();
  }

  function handleSkip() {
    workflowStore.skipStep();
    customPrompt = "";
  }

  function handlePause() {
    workflowStore.pauseWorkflow();
  }

  function handleCancel() {
    workflowStore.cancelWorkflow();
    customPrompt = "";
  }

  function handleReset() {
    workflowStore.resetWorkflow();
    customPrompt = "";
  }

  function handleJumpToStep(index: number) {
    workflowStore.jumpToStep(index);
  }

  function handleRestoreCheckpoint(index: number) {
    workflowStore.restoreFromCheckpoint(index);
  }

  // SVG path data for step status icons
  const stepIconPaths: Record<string, string> = {
    completed: "M20 6 9 17l-5-5",
    active: "M5 3l14 9-14 9V3z",
    skipped: "M5 4l10 8-10 8V4zM19 5v14",
    failed: "M18 6 6 18M6 6l12 12",
    pending: "",
  };

  function getStepIcon(step: WorkflowStep): string {
    return stepIconPaths[step.status] ?? "";
  }

  function getInterventionLabel(level: number): string {
    switch (level) {
      case 0:
        return t("workflow_intervention_auto");
      case 1:
        return t("workflow_intervention_confirm");
      case 2:
        return t("workflow_intervention_approval");
      case 3:
        return t("workflow_intervention_manual");
      default:
        return t("workflow_intervention_unknown");
    }
  }

  const interventionClasses: Record<number, string> = {
    0: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    1: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    2: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    3: "bg-red-500/10 text-red-600 dark:text-red-400",
  };
</script>

<div class="flex flex-col gap-3 p-3 text-foreground">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2">
    <h3 class="text-sm font-semibold text-foreground">{t("workflow_pageTitle")}</h3>
    <button
      class="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onclick={() => (showTemplateSelector = !showTemplateSelector)}
      title={t("workflow_templates")}
    >
      <svg
        class="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    </button>
  </div>

  <!-- Template Selector -->
  {#if showTemplateSelector}
    <div class="rounded-lg border border-border bg-card p-3">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-xs font-semibold text-foreground">{t("workflow_selectTemplate")}</h4>
        <button
          class="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onclick={() => (showTemplateSelector = false)}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="grid grid-cols-1 gap-2">
        {#each templates as template (template.id)}
          {@const cat = categoryColors[template.category] ?? categoryColors.custom}
          <button
            class="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/30 p-3 text-left transition-colors hover:border-primary/30 hover:bg-accent/30"
            onclick={() => handleSelectTemplate(template)}
          >
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {cat.bg} {cat.text}"
            >
              <svg
                class="h-4.5 w-4.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={template.icon} />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-medium text-foreground">{template.name}</div>
              <div class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {template.description}
              </div>
              <div class="mt-1.5 flex items-center gap-2">
                <span class="rounded-full {cat.bg} px-2 py-0.5 text-[10px] font-medium {cat.text}">
                  {template.category}
                </span>
                <span class="text-[10px] text-muted-foreground/60">{template.estimatedTime}</span>
              </div>
            </div>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Empty State -->
  {#if !activeTemplate}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div
        class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted"
      >
        <svg
          class="h-6 w-6 text-muted-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09zM12 15l-3-3M22 2l-7.5 7.5"
          />
          <path d="M11.5 12.5 9.5 10.5 14 2l8 8-8.5 4.5zM14 8l-2 2" />
        </svg>
      </div>
      <h3 class="text-sm font-medium text-foreground mb-1">{t("workflow_startFromTemplate")}</h3>
      <p class="text-xs text-muted-foreground max-w-xs mb-4">
        {t("workflow_selectTemplate")}
      </p>
      <button
        class="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        onclick={() => (showTemplateSelector = true)}
      >
        {t("workflow_browseTemplates")}
      </button>
    </div>
  {:else}
    <!-- Progress Bar -->
    <div class="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
      <div class="mb-1.5 flex items-center justify-between">
        <span class="text-xs font-medium text-foreground">{activeTemplate.name}</span>
        <span class="text-[11px] font-semibold text-primary">{progress}%</span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          class="h-full rounded-full bg-primary transition-all duration-300"
          style="width: {progress}%"
        ></div>
      </div>
    </div>

    <!-- Step Indicator -->
    <div
      class="flex items-center gap-1 overflow-x-auto rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5"
    >
      {#each activeTemplate.steps as step, index (step.id)}
        <button
          class="flex shrink-0 flex-col items-center gap-1 rounded-md p-1.5 transition-colors {step.status ===
          'active'
            ? 'bg-primary/10'
            : 'hover:bg-accent/30'}"
          onclick={() => handleJumpToStep(index)}
          title={step.title}
        >
          {#if step.status === "completed"}
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"
            >
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={getStepIcon(step)} />
              </svg>
            </span>
          {:else if step.status === "active"}
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={getStepIcon(step)} />
              </svg>
            </span>
          {:else if step.status === "failed"}
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
            >
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={getStepIcon(step)} />
              </svg>
            </span>
          {:else if step.status === "skipped"}
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full bg-muted-foreground/40 text-background"
            >
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={getStepIcon(step)} />
              </svg>
            </span>
          {:else}
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full border-2 border-border text-[10px] font-medium text-muted-foreground"
            >
              {index + 1}
            </span>
          {/if}
        </button>
        {#if index < activeTemplate.steps.length - 1}
          <div
            class="h-0.5 min-w-[12px] flex-1 rounded-full {step.status === 'completed'
              ? 'bg-emerald-500'
              : 'bg-border'}"
          ></div>
        {/if}
      {/each}
    </div>

    <!-- Current Step Details -->
    {#if currentStep}
      <div class="rounded-lg border border-border bg-card p-3.5">
        <div class="mb-2 flex items-start justify-between gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="text-sm font-semibold text-foreground">
              {t("workflow_stepLabel")}
              {(activeInstance?.currentStepIndex ?? 0) + 1}: {currentStep.title}
            </h4>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-medium {interventionClasses[
                currentStep.interventionLevel
              ] ?? interventionClasses[0]}"
            >
              {getInterventionLabel(currentStep.interventionLevel)}
            </span>
          </div>
          {#if currentStep.estimatedTime}
            <span class="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
              </svg>
              {currentStep.estimatedTime}
            </span>
          {/if}
        </div>

        <p class="mb-3 text-xs leading-relaxed text-muted-foreground">{currentStep.instruction}</p>

        <!-- Auto-generated Prompt -->
        {#if currentStep.prompt}
          <div class="mb-3">
            <h5
              class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t("workflow_autoPrompt")}
            </h5>
            <pre
              class="whitespace-pre-wrap rounded-md border border-border/50 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-foreground/80">{currentStep.prompt}</pre>
          </div>
        {/if}

        <!-- Custom Prompt Input -->
        <div class="mb-3">
          <h5 class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("workflow_customPrompt")}
          </h5>
          <textarea
            bind:value={customPrompt}
            placeholder={t("workflow_promptPlaceholder")}
            rows="3"
            class="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          ></textarea>
        </div>

        <!-- Tools -->
        {#if currentStep.tools.length > 0}
          <div>
            <h5
              class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t("workflow_requiredTools")}
            </h5>
            <div class="flex flex-wrap gap-1.5">
              {#each currentStep.tools as tool (tool)}
                <span
                  class="rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-primary"
                  >{tool}</span
                >
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Status Messages -->
    {#if isWaiting}
      <div
        class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
      >
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
        </svg>
        <span>{t("workflow_waitingConfirm")}</span>
      </div>
    {/if}

    {#if error}
      <div
        class="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-500"
      >
        <svg
          class="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span class="flex-1">{error}</span>
        <button
          class="rounded p-0.5 hover:bg-red-500/10"
          onclick={() => workflowStore.clearError()}
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/if}

    <!-- Control Buttons -->
    <div class="flex flex-wrap items-center justify-center gap-2">
      {#if !isRunning && !isWaiting}
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          onclick={handlePrev}
          disabled={!activeInstance || (activeInstance?.currentStepIndex ?? 0) === 0}
        >
          {t("workflow_prevStep")}
        </button>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onclick={handleSkip}
        >
          {t("workflow_skip")}
        </button>
        <button
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          onclick={handleStart}
          disabled={isExecuting}
        >
          {currentStep?.interventionLevel === 0
            ? t("workflow_startExecute")
            : t("workflow_confirmExecute")}
        </button>
      {:else if isRunning}
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onclick={handlePause}
        >
          {t("workflow_pause")}
        </button>
        <button
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          onclick={handleNext}
          disabled={isExecuting}
        >
          {isExecuting ? t("workflow_executing") : t("workflow_nextStep")}
        </button>
      {:else if isWaiting}
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onclick={handlePrev}
        >
          {t("workflow_prevStep")}
        </button>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onclick={handleSkip}
        >
          {t("workflow_skip")}
        </button>
        <button
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          onclick={handleNext}
          disabled={isExecuting}
        >
          {t("workflow_confirmExecute")}
        </button>
      {/if}
    </div>

    <!-- Workflow Actions -->
    <div class="flex flex-wrap items-center justify-center gap-2">
      {#if (activeInstance?.status ?? "") === "completed"}
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onclick={handleReset}
        >
          {t("workflow_restart")}
        </button>
        <button
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onclick={() => (showTemplateSelector = true)}
        >
          {t("workflow_newWorkflow")}
        </button>
      {:else if activeInstance && activeInstance.status !== "completed" && activeInstance.status !== "cancelled"}
        <button
          class="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          onclick={handleCancel}
        >
          {t("workflow_cancel")}
        </button>
      {/if}
    </div>

    <!-- Context Panel Toggle -->
    <button
      class="rounded-md border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground"
      onclick={() => (showContextPanel = !showContextPanel)}
    >
      {showContextPanel ? t("workflow_hide") : t("workflow_show")}
      {t("workflow_contextLabel")}
    </button>

    <!-- Context Panel -->
    {#if showContextPanel}
      <div class="rounded-lg border border-border/50 bg-muted/20 p-3">
        <h5 class="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("workflow_contextInfo")}
        </h5>
        <div class="mb-2.5">
          <label class="mb-1 block text-[11px] text-muted-foreground"
            >{t("workflow_projectPath")}</label
          >
          <input
            type="text"
            value={workflowStore.state.currentContext.projectPath ?? ""}
            onchange={(e) => workflowStore.updateContext({ projectPath: e.currentTarget.value })}
            placeholder="/path/to/project"
            class="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label class="mb-1 block text-[11px] text-muted-foreground"
            >{t("workflow_relevantFiles")}</label
          >
          <textarea
            value={workflowStore.state.currentContext.relevantFiles.join("\n")}
            onchange={(e) =>
              workflowStore.updateContext({
                relevantFiles: e.currentTarget.value.split("\n").filter(Boolean),
              })}
            placeholder={t("workflow_oneFilePerLine")}
            rows="2"
            class="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          ></textarea>
        </div>
      </div>
    {/if}

    <!-- Checkpoint History -->
    {#if (activeInstance?.checkpoints.length ?? 0) > 0}
      <div class="rounded-lg border border-border/50 bg-muted/20 p-3">
        <h5 class="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("workflow_execHistory")}
        </h5>
        <div class="space-y-1">
          {#each activeInstance?.checkpoints ?? [] as cp, index (cp.timestamp)}
            <div
              class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] {index <
              (activeInstance?.checkpoints.length ?? 0) - 1
                ? 'border-b border-border/20'
                : ''}"
            >
              <span class="text-muted-foreground"
                >{new Date(cp.timestamp).toLocaleTimeString()}</span
              >
              <span class="text-foreground">Step {cp.stepIndex + 1}</span>
              <span class={cp.completed ? "text-emerald-500" : "text-muted-foreground"}>
                {cp.completed ? t("workflow_completed") : t("workflow_skipped")}
              </span>
              <button
                class="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onclick={() => handleRestoreCheckpoint(index)}
                title={t("workflow_restoreToPoint")}
              >
                <svg
                  class="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="1,4 1,10 7,10" /><path d="M3.51 15a9 9 0 105.64-11.36L1 10" />
                </svg>
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
