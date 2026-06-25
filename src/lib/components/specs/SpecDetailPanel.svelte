<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type {
    SpecAcceptanceCriterion,
    SpecGate,
    SpecPlanStep,
    SpecRecord,
  } from "$lib/types/spec";
  import { relativeTime } from "$lib/utils/format";

  let {
    spec,
    onRunGate,
  }: {
    spec: SpecRecord | null;
    onRunGate: (gateId: string) => void;
  } = $props();

  const stepKey: Record<SpecPlanStep["status"], MessageKey> = {
    pending: "specs_step_pending",
    in_progress: "specs_step_in_progress",
    done: "specs_step_done",
  };

  const criterionKey: Record<SpecAcceptanceCriterion["status"], MessageKey> = {
    pending: "specs_criterion_pending",
    in_progress: "specs_criterion_in_progress",
    pass: "specs_criterion_pass",
    fail: "specs_criterion_fail",
  };

  const gateKey: Record<SpecGate["verdict"], MessageKey> = {
    pending: "specs_gate_pending",
    pass: "specs_gate_pass",
    fail: "specs_gate_fail",
  };

  const gateTone: Record<SpecGate["verdict"], string> = {
    pending: "bg-muted text-muted-foreground",
    pass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    fail: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  };

  const linkedTaskStatusKey: Record<"pending" | "in_progress" | "done" | "failed", MessageKey> = {
    pending: "specs_linked_task_status_pending",
    in_progress: "specs_linked_task_status_in_progress",
    done: "specs_linked_task_status_done",
    failed: "specs_linked_task_status_failed",
  };
</script>

{#if !spec}
  <div class="flex h-full items-center justify-center px-6 py-10 text-sm text-muted-foreground">
    {t("specs_empty")}
  </div>
{:else}
  <div class="flex h-full flex-col overflow-y-auto">
    <header class="border-b border-border px-6 py-4">
      <h2 class="truncate text-base font-semibold text-foreground">{spec.title}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{spec.summary}</p>
      <p class="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        {relativeTime(spec.updated_at)}
      </p>
    </header>

    <div class="grid grid-cols-1 gap-6 px-6 py-4 lg:grid-cols-2">
      <section class="space-y-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("specs_section_plan")}
        </h3>
        <ul class="space-y-1.5">
          {#each spec.plan_steps as step (step.id)}
            <li
              class="rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
            >
              <div class="flex items-center justify-between gap-2">
                <span>{step.description}</span>
                <span
                  class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {t(stepKey[step.status])}
                </span>
              </div>
              {#if step.linked_task_id}
                <p class="mt-1 text-[10px] text-muted-foreground">
                  {t("specs_linked_task", { id: step.linked_task_id })}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>

      <section class="space-y-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("specs_section_acceptance")}
        </h3>
        <ul class="space-y-1.5">
          {#each spec.acceptance_criteria as criterion (criterion.id)}
            <li
              class="rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
            >
              <div class="flex items-center justify-between gap-2">
                <span>{criterion.description}</span>
                <span
                  class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {t(criterionKey[criterion.status])}
                </span>
              </div>
              {#if criterion.linked_task_id}
                <p class="mt-1 text-[10px] text-muted-foreground">
                  {t("specs_linked_task", { id: criterion.linked_task_id })}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>

      <section class="space-y-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("specs_section_clarifications")}
        </h3>
        {#if spec.clarifications.length === 0}
          <p class="text-xs text-muted-foreground">—</p>
        {:else}
          <ul class="space-y-1.5">
            {#each spec.clarifications as question (question.id)}
              <li class="rounded-md border border-border bg-background px-3 py-2 text-xs">
                <p class="text-foreground">{question.question}</p>
                {#if question.answer}
                  <p class="mt-1 text-muted-foreground">{question.answer}</p>
                  <p class="mt-1 text-[10px] text-muted-foreground">
                    {t("specs_clarification_answered", { by: question.answered_by ?? "—" })}
                  </p>
                {:else}
                  <p class="mt-1 text-[10px] text-amber-600 dark:text-amber-300">
                    {t("specs_clarification_unanswered")}
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="space-y-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("specs_section_linked_tasks")}
        </h3>
        {#if spec.linked_tasks.length === 0}
          <p class="text-xs text-muted-foreground">—</p>
        {:else}
          <ul class="space-y-1.5">
            {#each spec.linked_tasks as link (link.task_id)}
              <li
                class="rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono">{link.task_id}</span>
                  <span
                    class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {t(linkedTaskStatusKey[link.status])} · {link.role}
                  </span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="space-y-2 lg:col-span-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("specs_section_gates")}
        </h3>
        {#if spec.gates.length === 0}
          <p class="text-xs text-muted-foreground">—</p>
        {:else}
          <ul class="space-y-1.5">
            {#each spec.gates as gate (gate.id)}
              <li
                class="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
              >
                <div class="min-w-0">
                  <p class="truncate font-medium">{gate.name}</p>
                  <p class="text-[10px] text-muted-foreground">
                    {gate.last_run_at ? relativeTime(gate.last_run_at) : t("specs_gate_pending")}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <span
                    class="rounded-full px-2 py-0.5 text-[10px] font-semibold {gateTone[
                      gate.verdict
                    ]}"
                  >
                    {t(gateKey[gate.verdict])}
                  </span>
                  <button
                    type="button"
                    class="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                    aria-label={t("specs_gate_run")}
                    onclick={() => onRunGate(gate.id)}
                  >
                    {t("specs_gate_run")}
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  </div>
{/if}
