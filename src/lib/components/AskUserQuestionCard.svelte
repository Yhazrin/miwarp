<script lang="ts">
  /**
   * AskUserQuestionCard — extracted from InlineToolCard.
   * Renders AskUserQuestion pending, done, and permission_prompt states.
   */
  import type { BusToolItem, PermissionSuggestion } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import PhaseIndicator from "$lib/components/PhaseIndicator.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { AgentPhase } from "$lib/utils/phase-detection";
  import { dbg } from "$lib/utils/debug";

  interface ParsedQuestion {
    question: string;
    header: string;
    options: { label: string; description: string }[];
    multiSelect: boolean;
  }

  let {
    tool,
    style,
    currentPhase,
    onAnswer,
    onPermissionRespond,
  }: {
    tool: BusToolItem;
    style: { bg: string; text: string; icon: string };
    currentPhase: AgentPhase;
    onAnswer?: (answer: string) => void;
    onPermissionRespond?: (
      requestId: string,
      behavior: "allow" | "deny",
      updatedPermissions?: PermissionSuggestion[],
      updatedInput?: Record<string, unknown>,
      denyMessage?: string,
      interrupt?: boolean,
    ) => void | Promise<void>;
  } = $props();

  let submitting = $state(false);
  let multiChecked: Record<string, boolean> = $state({});
  let questionAnswers: Record<string, string> = $state({});
  let otherActive: Record<string, boolean> = $state({});
  let otherText: Record<string, string> = $state({});

  // Reset submitting when tool status changes
  $effect(() => {
    void tool.status;
    submitting = false;
  });

  function extractOptions(raw: unknown): { label: string; description: string }[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((o) => {
      if (typeof o === "string") return { label: o, description: "" };
      if (o && typeof o === "object") {
        const r = o as Record<string, unknown>;
        return { label: String(r.label ?? r.value ?? o), description: String(r.description ?? "") };
      }
      return { label: String(o), description: "" };
    });
  }

  let parsedQuestions = $derived.by((): ParsedQuestion[] => {
    if (!tool.input) return [];
    const questions = tool.input.questions as unknown;
    if (Array.isArray(questions) && questions.length > 0) {
      return questions.map((q: unknown) => {
        const qr = q as Record<string, unknown>;
        return {
          question: typeof qr?.question === "string" ? qr.question : "",
          header: typeof qr?.header === "string" ? qr.header : "",
          options: extractOptions(qr?.options),
          multiSelect: qr?.multiSelect === true,
        };
      });
    }
    if (typeof tool.input.question === "string") {
      return [
        {
          question: tool.input.question,
          header: "",
          options: extractOptions(tool.input.options as unknown),
          multiSelect: tool.input.multiSelect === true,
        },
      ];
    }
    return [];
  });

  let askQuestion = $derived(parsedQuestions[0]?.question ?? "");
  let askOptions = $derived(parsedQuestions[0]?.options.map((o) => o.label) ?? ([] as string[]));
  let isMultiSelect = $derived(parsedQuestions[0]?.multiSelect ?? false);
  let hasMultipleQuestions = $derived(parsedQuestions.length > 1);
  let allQuestionsAnswered = $derived(
    parsedQuestions.length > 0 && parsedQuestions.every((q) => !!questionAnswers[q.question]),
  );

  function extractOutputText(output: unknown): string {
    if (!output) return "";
    if (typeof output === "string") return output;
    if (typeof output === "object" && output !== null) {
      const o = output as Record<string, unknown>;
      if (typeof o.output === "string") return o.output;
      if (typeof o.text === "string") return o.text;
      if (typeof o.result === "string") return o.result;
    }
    return "";
  }

  let outputText = $derived(extractOutputText(tool.output));

  let askAnswersMap = $derived.by((): Record<string, string> => {
    const tur = tool.tool_use_result as Record<string, unknown> | undefined;
    if (tur?.answers && typeof tur.answers === "object") {
      return tur.answers as Record<string, string>;
    }
    if (tool.output) {
      const a = (tool.output as Record<string, unknown>).answer;
      if (typeof a === "string" && askQuestion) return { [askQuestion]: a };
    }
    if (outputText && askQuestion) return { [askQuestion]: outputText };
    return {};
  });

  let askAnnotationsMap = $derived.by((): Record<string, string> => {
    const tur = tool.tool_use_result as Record<string, unknown> | undefined;
    if (tur?.annotations && typeof tur.annotations === "object") {
      const ann = tur.annotations as Record<string, unknown>;
      const result: Record<string, string> = {};
      for (const [q, v] of Object.entries(ann)) {
        if (v && typeof v === "object" && "notes" in (v as Record<string, unknown>)) {
          const notes = (v as Record<string, unknown>).notes;
          if (typeof notes === "string") result[q] = notes;
        }
      }
      return result;
    }
    return {};
  });

  let askAnswer = $derived(askQuestion ? (askAnswersMap[askQuestion] ?? "") : "");
  let askAnswerSet = $derived.by(() => {
    if (!askAnswer) return new Set<string>();
    return new Set(
      askAnswer
        .split(", ")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  });

  function multiCount(): number {
    return Object.values(multiChecked).filter(Boolean).length;
  }

  function toggleMulti(option: string) {
    multiChecked = { ...multiChecked, [option]: !multiChecked[option] };
  }

  async function handleAnswer(answer: string) {
    if (submitting) return;
    submitting = true;
    try {
      await onAnswer?.(answer);
      dbg("ask-card", "answer sent", { answer: answer.slice(0, 50) });
    } catch (e) {
      dbg("ask-card", "answer failed", e);
    } finally {
      submitting = false;
    }
  }

  async function safePermissionRespond(
    ...args: Parameters<NonNullable<typeof onPermissionRespond>>
  ) {
    try {
      await onPermissionRespond?.(...args);
    } catch {
      submitting = false;
    }
  }

  function handlePermissionOption(answer: string) {
    if (submitting || !tool.permission_request_id) return;
    if (hasMultipleQuestions) {
      questionAnswers = { ...questionAnswers, [askQuestion]: answer };
      return;
    }
    submitting = true;
    const answers: Record<string, string> = { [askQuestion]: answer };
    const updatedInput = { ...(tool.input ?? {}), answers };
    safePermissionRespond(tool.permission_request_id, "allow", undefined, updatedInput);
  }

  function submitAllPermissionAnswers() {
    if (submitting || !tool.permission_request_id) return;
    submitting = true;
    const updatedInput = { ...(tool.input ?? {}), answers: questionAnswers };
    safePermissionRespond(tool.permission_request_id, "allow", undefined, updatedInput);
  }

  function submitMultiSelectPermission() {
    if (submitting || !tool.permission_request_id) return;
    let selected = Object.keys(multiChecked).filter((k) => multiChecked[k]);
    const otherVal = otherActive[askQuestion] && otherText[askQuestion]?.trim();
    if (otherVal) selected = [...selected, otherVal];
    if (selected.length === 0) return;
    submitting = true;
    const answers: Record<string, string> = { [askQuestion]: selected.join(", ") };
    const annotations: Record<string, { notes: string }> = {};
    if (otherVal) annotations[askQuestion] = { notes: otherVal };
    const updatedInput = { ...(tool.input ?? {}), answers, annotations };
    safePermissionRespond(tool.permission_request_id, "allow", undefined, updatedInput);
  }

  async function handlePermissionDeny() {
    if (!tool.permission_request_id || submitting) return;
    submitting = true;
    try {
      await onPermissionRespond?.(tool.permission_request_id, "deny");
    } finally {
      submitting = false;
    }
  }
</script>

{#if tool.status === "running" || tool.status === "ask_pending"}
  <!-- Pending: question + options -->
  <div
    class="glass-card gradient-border-left rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.05)] px-4 py-3"
  >
    <div class="flex items-center gap-2 mb-2">
      <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}">
        <svg
          class="h-3 w-3 {style.text}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d={style.icon} />
        </svg>
      </div>
      <span class="text-xs font-medium text-foreground">{t("inline_question")}</span>
      <PhaseIndicator phase={currentPhase} elapsed={tool.elapsed_time_seconds} />
      <div class="h-3 w-3 shrink-0 ml-auto">
        <Spinner
          size="xs"
          class="!h-2.5 !w-2.5 border-[hsl(var(--miwarp-status-warning)/0.3)] border-t-[hsl(var(--miwarp-status-warning))]"
        />
      </div>
    </div>
    <MarkdownContent
      text={askQuestion}
      class="text-sm text-foreground mb-3 [&>*:last-child]:mb-0"
    />
    {#if askOptions.length > 0 && onAnswer}
      {#if isMultiSelect}
        <div class="flex flex-wrap items-center gap-2">
          {#each askOptions as option}
            <button
              type="button"
              class="rounded-md border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed {multiChecked[
                option
              ]
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-foreground hover:bg-accent hover:border-ring/30'}"
              disabled={submitting}
              onclick={() => toggleMulti(option)}
            >
              {#if multiChecked[option]}<Icon
                  name="check"
                  size="xs"
                  class="inline mr-1 -mt-0.5"
                />{/if}
              {option}
            </button>
          {/each}
          <button
            type="button"
            class="rounded-md border border-dashed px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed {otherActive[
              askQuestion
            ]
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-muted-foreground hover:bg-accent hover:border-ring/30'}"
            disabled={submitting}
            onclick={() => {
              otherActive = { ...otherActive, [askQuestion]: !otherActive[askQuestion] };
            }}
          >
            {t("inline_other")}
          </button>
          {#if otherActive[askQuestion]}
            <input
              type="text"
              bind:value={otherText[askQuestion]}
              placeholder={t("inline_otherPlaceholder")}
              class="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          {/if}
          <button
            type="button"
            class="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={submitting ||
              (multiCount() === 0 && !(otherActive[askQuestion] && otherText[askQuestion]?.trim()))}
            onclick={() => {
              const selected = Object.keys(multiChecked).filter((k) => multiChecked[k]);
              const otherVal = otherActive[askQuestion] && otherText[askQuestion]?.trim();
              if (otherVal) selected.push(otherVal);
              if (selected.length > 0) handleAnswer(selected.join(", "));
            }}
          >
            {multiCount() > 0
              ? t("inline_submitCount", { count: String(multiCount()) })
              : t("inline_submit")}
          </button>
        </div>
      {:else}
        <div class="flex flex-wrap gap-2">
          {#each askOptions as option}
            <button
              type="button"
              class="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:border-ring/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={submitting}
              onclick={() => handleAnswer(option)}
            >
              {option}
            </button>
          {/each}
          <button
            type="button"
            class="rounded-md border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:border-ring/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={submitting}
            onclick={() => {
              otherActive = { ...otherActive, [askQuestion]: true };
            }}
          >
            {t("inline_other")}
          </button>
          {#if otherActive[askQuestion]}
            <div class="flex gap-1.5 w-full mt-0.5">
              <input
                type="text"
                bind:value={otherText[askQuestion]}
                placeholder={t("inline_otherPlaceholder")}
                class="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={submitting || !otherText[askQuestion]?.trim()}
                onclick={() => {
                  const text = otherText[askQuestion]?.trim();
                  if (text) handleAnswer(text);
                }}
              >
                {t("inline_submitOther")}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
{:else if tool.status !== "permission_prompt"}
  <!-- Done: show answer(s) -->
  <div class="glass-card rounded-lg border border-border/30 bg-background/50 px-4 py-3">
    <div class="flex items-center gap-2 mb-2">
      <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}">
        <svg
          class="h-3 w-3 {style.text}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d={style.icon} />
        </svg>
      </div>
      <span class="text-xs font-medium text-foreground">{t("inline_question")}</span>
      <PhaseIndicator phase={currentPhase} elapsed={tool.elapsed_time_seconds} />
    </div>
    {#if hasMultipleQuestions}
      <div class="space-y-2">
        {#each parsedQuestions as pq}
          <div class="rounded-md border border-border/20 bg-muted/10 px-3 py-2">
            {#if pq.header}<div class="text-[10px] font-medium text-muted-foreground mb-1">
                {pq.header}
              </div>{/if}
            <MarkdownContent
              text={pq.question}
              class="text-xs text-foreground mb-1.5 [&>*:last-child]:mb-0"
            />
            {#if pq.options.length > 0}
              <div class="flex flex-wrap gap-1">
                {#each pq.options as option}
                  {@const isSelected =
                    askAnswersMap[pq.question] === option.label ||
                    askAnswersMap[pq.question]?.includes(option.label)}
                  <span
                    class="rounded-md border px-2 py-0.5 text-[10px] {isSelected
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border/30 text-muted-foreground'}"
                  >
                    {#if isSelected}<Icon
                        name="check"
                        size="xs"
                        class="inline mr-0.5 -mt-0.5"
                      />{/if}
                    {option.label}
                  </span>
                {/each}
                {#if askAnnotationsMap[pq.question]}
                  <span
                    class="rounded-md border border-dashed border-border/30 px-2 py-0.5 text-[10px] text-muted-foreground italic"
                  >
                    {askAnnotationsMap[pq.question]}
                  </span>
                {/if}
              </div>
            {:else if askAnnotationsMap[pq.question]}
              <span class="text-[10px] text-muted-foreground italic"
                >{askAnnotationsMap[pq.question]}</span
              >
            {:else if askAnswersMap[pq.question]}
              <span class="text-xs text-foreground">{askAnswersMap[pq.question]}</span>
            {/if}
          </div>
        {/each}
      </div>
    {:else if askOptions.length > 0}
      <div class="flex flex-wrap gap-1">
        {#each askOptions as option}
          {@const isSelected = askAnswerSet.has(option)}
          <span
            class="rounded-md border px-2 py-0.5 text-[10px] {isSelected
              ? 'border-primary bg-primary/10 text-primary font-medium'
              : 'border-border/30 text-muted-foreground'}"
          >
            {#if isSelected}<Icon name="check" size="xs" class="inline mr-0.5 -mt-0.5" />{/if}
            {option}
          </span>
        {/each}
        {#if askAnnotationsMap[askQuestion]}
          <span
            class="rounded-md border border-dashed border-border/30 px-2 py-0.5 text-[10px] text-muted-foreground italic"
          >
            {askAnnotationsMap[askQuestion]}
          </span>
        {/if}
      </div>
    {:else if askAnnotationsMap[askQuestion]}
      <span class="text-[10px] text-muted-foreground italic">{askAnnotationsMap[askQuestion]}</span>
    {:else if askAnswer}
      <span
        class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary"
      >
        <Icon name="check" size="xs" class="inline mr-1 -mt-0.5" />
        {askAnswer}
      </span>
    {/if}
  </div>
{:else if tool.status === "permission_prompt" && tool.permission_request_id}
  <!-- Permission prompt: Allow/Deny -->
  <div
    class="glass-card rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.05)] px-4 py-3"
  >
    <div class="flex items-center gap-2 mb-2">
      <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}">
        <svg
          class="h-3 w-3 {style.text}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d={style.icon} />
        </svg>
      </div>
      <span class="text-xs font-medium text-foreground">{t("inline_question")}</span>
      <PhaseIndicator phase={currentPhase} elapsed={tool.elapsed_time_seconds} />
    </div>
    <MarkdownContent
      text={askQuestion}
      class="text-sm text-foreground mb-3 [&>*:last-child]:mb-0"
    />
    {#if hasMultipleQuestions}
      <div class="space-y-3 mb-3">
        {#each parsedQuestions as pq, qi}
          <div class="rounded-md border border-border/20 bg-muted/10 px-3 py-2">
            {#if pq.header}<div class="text-[10px] font-medium text-muted-foreground mb-1">
                {pq.header}
              </div>{/if}
            <MarkdownContent
              text={pq.question}
              class="text-xs text-foreground mb-1.5 [&>*:last-child]:mb-0"
            />
            {#if pq.options.length > 0}
              <div class="flex flex-wrap gap-1.5">
                {#each pq.options as option}
                  <button
                    type="button"
                    class="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-50 {questionAnswers[
                      pq.question
                    ] === option.label
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-foreground hover:bg-accent'}"
                    disabled={submitting}
                    onclick={() => {
                      questionAnswers = { ...questionAnswers, [pq.question]: option.label };
                    }}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
            {:else}
              <input
                type="text"
                bind:value={questionAnswers[pq.question]}
                placeholder={t("inline_otherPlaceholder")}
                class="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            {/if}
          </div>
        {/each}
      </div>
    {:else if askOptions.length > 0}
      <div class="flex flex-wrap gap-2 mb-3">
        {#each askOptions as option}
          <button
            type="button"
            class="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:border-ring/30 transition-all disabled:opacity-50"
            disabled={submitting}
            onclick={() => handlePermissionOption(option)}
          >
            {option}
          </button>
        {/each}
      </div>
    {:else}
      <input
        type="text"
        bind:value={questionAnswers[askQuestion]}
        placeholder={t("inline_otherPlaceholder")}
        class="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs mb-3 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
      />
    {/if}
    {#if !submitting}
      <div class="flex gap-2">
        <button
          type="button"
          class="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50"
          disabled={hasMultipleQuestions
            ? !allQuestionsAnswered
            : !questionAnswers[askQuestion]?.trim()}
          onclick={submitAllPermissionAnswers}
        >
          {t("common_confirm")}
        </button>
        <button
          type="button"
          class="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-all"
          onclick={handlePermissionDeny}
        >
          {t("common_deny")}
        </button>
      </div>
    {:else}
      <div class="flex items-center justify-center py-1.5">
        <Spinner size="xs" class="border-muted-foreground/30 border-t-primary" />
      </div>
    {/if}
  </div>
{/if}
