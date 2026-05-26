<script lang="ts">
  /**
   * WizardFlow - Phase-based wizard component for multi-step workflows.
   *
   * Design patterns from Claude Code's setup-cowork skill:
   * - One step at a time
   * - Skips are fine
   * - Keep each message short (2-3 sentences + widget)
   * - Phase grouping for complex workflows
   */
  import { t } from "$lib/i18n/index.svelte";
  import Button from "./Button.svelte";
  import type { Snippet } from "svelte";

  export interface WizardStep {
    id: string;
    title: string;
    description?: string;
    phase?: string;
    component?: Snippet;
    onNext?: () => boolean | Promise<boolean>;
    onBack?: () => void;
    onSkip?: () => void;
    canSkip?: boolean;
    canGoBack?: boolean;
    isLoading?: boolean;
  }

  export interface WizardPhase {
    id: string;
    label: string;
    description?: string;
    icon?: string;
  }

  interface Props {
    phases?: WizardPhase[];
    steps: WizardStep[];
    initialStep?: number;
    onComplete?: (data: Record<string, unknown>) => void;
    onCancel?: () => void;
    showProgress?: boolean;
    allowSkip?: boolean;
  }

  let {
    phases = [],
    steps,
    initialStep = 0,
    onComplete,
    onCancel,
    showProgress = true,
    allowSkip = true,
  }: Props = $props();

  // Current step index
  let currentStepIndex = $state(0);
  $effect(() => {
    currentStepIndex = initialStep;
  });

  // Navigation state
  let isTransitioning = $state(false);
  let transitionDirection = $state<"forward" | "back">("forward");

  // Collected data from all steps
  let collectedData = $state<Record<string, unknown>>({});

  // Derived state
  let currentStep = $derived(steps[currentStepIndex]);
  let totalSteps = $derived(steps.length);
  let currentPhase = $derived(
    currentStep.phase
      ? phases.find((p) => p.id === currentStep.phase)
      : null,
  );
  let currentPhaseIndex = $derived(
    currentPhase
      ? phases.findIndex((p) => p.id === currentPhase.id)
      : -1,
  );

  // Group steps by phase
  let stepsByPhase = $derived.by(() => {
    if (phases.length === 0) return null;

    const grouped: Record<string, { step: WizardStep; index: number }[]> = {};
    steps.forEach((step, index) => {
      const phaseId = step.phase || "default";
      if (!grouped[phaseId]) grouped[phaseId] = [];
      grouped[phaseId].push({ step, index });
    });
    return grouped;
  });

  // Calculate phase progress
  let phaseProgress = $derived.by(() => {
    if (!stepsByPhase || phases.length === 0) return null;

    return phases.map((phase, pIdx) => {
      const phaseSteps = stepsByPhase[phase.id] || [];
      if (phaseSteps.length === 0) return { phase, progress: 0, completed: false };

      const completedInPhase = phaseSteps.filter(
        (s) => s.index < currentStepIndex,
      ).length;
      const progress = (completedInPhase / phaseSteps.length) * 100;

      return {
        phase,
        progress,
        completed: progress === 100,
        current: pIdx === currentPhaseIndex,
      };
    });
  });

  // Navigation functions
  async function goNext() {
    if (isTransitioning) return;

    // Call onNext hook if exists
    if (currentStep.onNext) {
      const canProceed = await currentStep.onNext();
      if (canProceed === false) return;
    }

    isTransitioning = true;
    transitionDirection = "forward";

    await new Promise((resolve) => setTimeout(resolve, 200)); // Animation delay

    if (currentStepIndex < totalSteps - 1) {
      currentStepIndex++;
    } else {
      // Completed all steps
      onComplete?.(collectedData);
    }

    isTransitioning = false;
  }

  function goBack() {
    if (isTransitioning) return;

    // Call onBack hook if exists
    currentStep.onBack?.();

    isTransitioning = true;
    transitionDirection = "back";

    setTimeout(() => {
      if (currentStepIndex > 0) {
        currentStepIndex--;
      }
      isTransitioning = false;
    }, 200);
  }

  function skip() {
    if (!allowSkip || !currentStep.canSkip) return;

    // Call onSkip hook if exists
    currentStep.onSkip?.();

    isTransitioning = true;

    setTimeout(() => {
      if (currentStepIndex < totalSteps - 1) {
        currentStepIndex++;
      }
      isTransitioning = false;
    }, 200);
  }

  function goToStep(index: number) {
    if (isTransitioning || index < 0 || index >= totalSteps) return;

    transitionDirection = index > currentStepIndex ? "forward" : "back";
    isTransitioning = true;

    setTimeout(() => {
      currentStepIndex = index;
      isTransitioning = false;
    }, 200);
  }

  // Update collected data (can be called from child components)
  function updateStepData(stepId: string, data: unknown) {
    collectedData = { ...collectedData, [stepId]: data };
  }
</script>

<div class="flex flex-col h-full">
  <!-- Phase progress (if phases defined) -->
  {#if phases.length > 0 && phaseProgress}
    <div class="shrink-0 border-b border-border bg-muted/30">
      <div class="flex items-center px-4 py-3 gap-2 overflow-x-auto">
        {#each phaseProgress as phaseItem}
          <div class="flex items-center gap-2">
            {#if phaseItem.phase.icon}
              <span class="text-sm">{phaseItem.phase.icon}</span>
            {/if}
            <div class="flex flex-col">
              <span class="text-xs font-medium {phaseItem.current ? 'text-foreground' : 'text-muted-foreground'}">
                {phaseItem.phase.label}
              </span>
              {#if phaseItem.current}
                <div class="w-16 h-1 rounded-full bg-muted overflow-hidden mt-0.5">
                  <div
                    class="h-full rounded-full bg-primary transition-all duration-300"
                    style="width: {phaseItem.progress}%"
                  ></div>
                </div>
              {/if}
            </div>
            {#if phaseItem !== phaseProgress[phaseProgress.length - 1]}
              <span class="text-muted-foreground/30 mx-1">›</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Step progress bar -->
  {#if showProgress}
    <div class="shrink-0 px-4 pt-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-muted-foreground">
          {t("wizard_stepProgress", { current: String(currentStepIndex + 1), total: String(totalSteps) })}
        </span>
        <span class="text-xs text-muted-foreground">
          {Math.round(((currentStepIndex + 1) / totalSteps) * 100)}%
        </span>
      </div>
      <div class="h-1 rounded-full bg-muted overflow-hidden">
        <div
          class="h-full rounded-full bg-primary transition-all duration-300"
          style="width: {((currentStepIndex + 1) / totalSteps) * 100}%"
        ></div>
      </div>
    </div>
  {/if}

  <!-- Step content area -->
  <div class="flex-1 overflow-y-auto p-4">
    {#if isTransitioning}
      <div class="animate-pulse">{t("wizard_loading")}</div>
    {:else if currentStep.component}
      {@render currentStep.component()}
    {:else}
      <!-- Default step rendering -->
      <div class="space-y-4">
        {#if currentStep.title}
          <h2 class="text-lg font-semibold">{currentStep.title}</h2>
        {/if}
        {#if currentStep.description}
          <p class="text-sm text-muted-foreground">{currentStep.description}</p>
        {/if}
        <!-- Placeholder for step content -->
        <div class="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground">
          {t("wizard_stepContentPlaceholder")}
        </div>
      </div>
    {/if}
  </div>

  <!-- Navigation footer -->
  <div class="shrink-0 border-t border-border bg-muted/30 px-4 py-3">
    <div class="flex items-center justify-between">
      <!-- Left: Back button -->
      <div>
        {#if currentStepIndex > 0 && (currentStep.canGoBack !== false)}
          <Button variant="ghost" size="sm" onclick={goBack}>
            ← {t("wizard_back")}
          </Button>
        {/if}
      </div>

      <!-- Center: Skip (if allowed) -->
      <div>
        {#if allowSkip && currentStep.canSkip}
          <Button variant="ghost" size="sm" onclick={skip}>
            {t("wizard_skip")}
          </Button>
        {/if}
      </div>

      <!-- Right: Next/Finish button -->
      <div>
        {#if currentStepIndex < totalSteps - 1}
          <Button
            onclick={goNext}
            disabled={currentStep.isLoading}
          >
            {#if currentStep.isLoading}
              <span class="flex items-center gap-2">
                <span class="h-3 w-3 border border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin"></span>
                {t("wizard_processing")}
              </span>
            {:else}
              {t("wizard_next")} →
            {/if}
          </Button>
        {:else}
          <Button onclick={goNext}>
            {t("wizard_complete")}
          </Button>
        {/if}
      </div>
    </div>
  </div>
</div>
