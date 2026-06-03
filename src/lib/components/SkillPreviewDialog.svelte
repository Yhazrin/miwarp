<!--
  SkillPreviewDialog.svelte
  
  A dialog component that shows a preview of what a skill will do
  before it executes. Based on Claude Cowork design patterns.
-->
<script lang="ts">
  import type { Skill } from "$lib/types/skill";
  import { generateSkillPreview, type SkillPreview } from "$lib/services/skill-preview";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import MiDialog from "$lib/ui/MiDialog.svelte";

  interface Props {
    open?: boolean;
    skill?: Skill | null;
    args?: string;
    onConfirm?: (skill: Skill, args: string) => void;
    onCancel?: () => void;
  }

  let { open = $bindable(false), skill = null, args = "", onConfirm, onCancel }: Props = $props();

  // Generate preview when skill changes
  let preview = $state<SkillPreview | null>(null);

  $effect(() => {
    if (open && skill) {
      preview = generateSkillPreview(skill, args);
    } else {
      preview = null;
    }
  });

  let closingViaConfirm = $state(false);

  function handleConfirm() {
    if (skill) {
      closingViaConfirm = true;
      onConfirm?.(skill, args);
      open = false;
    }
  }

  function handleCancel() {
    open = false;
    onCancel?.();
  }

  function handleDialogClose() {
    if (!closingViaConfirm) handleCancel();
    closingViaConfirm = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      handleCancel();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      handleConfirm();
    }
  }

  // Get icon for step
  function getStepIcon(icon: string): string {
    return icon || "📋";
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<MiDialog bind:open onClose={handleDialogClose} contentClass="max-w-lg overflow-hidden p-0">
  {#if preview}
    <div class="w-full">
      <!-- Header -->
      <div class="flex items-center justify-between border-b px-6 py-4">
        <div class="flex items-center gap-3">
          <span class="text-2xl">{skill?.icon || "📋"}</span>
          <div>
            <h2 class="text-lg font-semibold">{t('skillPreview_title')}</h2>
            <p class="text-sm text-muted-foreground">/{preview.skillName}</p>
          </div>
        </div>
        <button type="button"
          class="rounded-md p-1.5 hover:bg-accent transition-colors"
          aria-label={t('common_close')}
          onclick={handleCancel}
        >
          <Icon name="x" size="lg" />
        </button>
      </div>

      <!-- Content -->
      <div class="max-h-[60vh] overflow-y-auto p-6">
        <!-- Description -->
        <p class="mb-4 text-sm text-muted-foreground">{preview.description}</p>

        <!-- Warnings -->
        {#if preview.warnings.length > 0}
          <div class="mb-4 rounded-md bg-[hsl(var(--miwarp-status-warning)/0.1)] border border-[hsl(var(--miwarp-status-warning)/0.2)] p-3">
            <div class="flex items-center gap-2 text-miwarp-status-warning mb-2">
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span class="text-sm font-medium">{t('skillPreview_warnings')}</span>
            </div>
            <ul class="space-y-1 text-xs text-[hsl(var(--miwarp-status-warning)/0.8)]">
              {#each preview.warnings as warning}
                <li class="flex items-start gap-2">
                  <span>•</span>
                  <span>{warning}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Prerequisites -->
        {#if preview.prerequisites.length > 0}
          <div class="mb-4 rounded-md bg-[hsl(var(--miwarp-status-info)/0.1)] border border-[hsl(var(--miwarp-status-info)/0.2)] p-3">
            <div class="flex items-center gap-2 text-miwarp-status-info mb-2">
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span class="text-sm font-medium">{t('skillPreview_prerequisites')}</span>
            </div>
            <ul class="space-y-1 text-xs text-[hsl(var(--miwarp-status-info)/0.8)]">
              {#each preview.prerequisites as prereq}
                <li class="flex items-start gap-2">
                  <span>•</span>
                  <span>{prereq}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Steps -->
        <div class="mb-4">
          <h3 class="text-sm font-medium mb-3 flex items-center gap-2">
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
              />
            </svg>
            {t("skillPreview_executionSteps")}
          </h3>
          <div class="space-y-2">
            {#each preview.steps as step, i}
              <div class="flex items-start gap-3 rounded-md bg-muted/50 p-3">
                <span
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm"
                >
                  {step.order}
                </span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-base">{getStepIcon(step.icon)}</span>
                    <span class="text-sm font-medium truncate">{step.description}</span>
                  </div>
                  {#if step.toolCalls && step.toolCalls.length > 0}
                    <div class="mt-1 flex flex-wrap gap-1">
                      {#each step.toolCalls as tool}
                        <span
                          class="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                        >
                          {tool}
                        </span>
                      {/each}
                    </div>
                  {/if}
                  {#if step.estimatedDuration}
                    <span class="mt-1 text-xs text-muted-foreground">
                      {t("skillPreview_est")} {step.estimatedDuration}
                    </span>
                  {/if}
                </div>
                {#if i < preview.steps.length - 1}
                  <div class="absolute left-[3.25rem] mt-6 h-4 w-px bg-border"></div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- Estimated Duration -->
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="clock" size="md" />
          <span
            >{t("skillPreview_estimatedDuration")} <strong class="text-foreground">{preview.estimatedDuration}</strong
            ></span
          >
        </div>

        <!-- Side Effects -->
        {#if preview.potentialSideEffects.length > 0}
          <div class="mt-4 rounded-md border border-muted p-3">
            <h4 class="text-xs font-medium text-muted-foreground mb-2">{t("skillPreview_sideEffects")}</h4>
            <div class="flex flex-wrap gap-2">
              {#each preview.potentialSideEffects as effect}
                <span class="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs">
                  {effect}
                </span>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between border-t px-6 py-4">
        <div class="text-xs text-muted-foreground">
          {t("skillPreview_confirmHint")}
        </div>
        <div class="flex items-center gap-3">
          <button type="button"
            class="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
            onclick={handleCancel}
          >
            {t("skillPreview_cancel")}
          </button>
          <button type="button"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            onclick={handleConfirm}
          >
            {t("skillPreview_execute")}
          </button>
        </div>
      </div>
    </div>
  {/if}
</MiDialog>
