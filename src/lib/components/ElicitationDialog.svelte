<script lang="ts">
  import type { ElicitationState } from "$lib/stores/session-store.svelte";
  import type { ElicitationFieldSchema } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { fly } from "svelte/transition";

  let {
    elicitations,
    onRespond,
  }: {
    elicitations: Map<string, ElicitationState>;
    onRespond: (
      requestId: string,
      action: "accept" | "decline" | "cancel",
      content?: Record<string, unknown>,
    ) => void | Promise<void>;
  } = $props();

  let submitting = $state(false);

  let current = $derived.by(() => {
    const iter = elicitations.values();
    const first = iter.next();
    return first.done ? null : first.value;
  });

  let formValues = $state<Record<string, unknown>>({});

  $effect(() => {
    if (current) {
      const defaults: Record<string, unknown> = {};
      const props = current.requestedSchema?.properties;
      if (props) {
        for (const [key, field] of Object.entries(props)) {
          if (field.default !== undefined) {
            defaults[key] = field.default;
          } else if (field.type === "boolean") {
            defaults[key] = false;
          } else if (field.type === "number") {
            defaults[key] = 0;
          } else {
            defaults[key] = "";
          }
        }
      }
      formValues = defaults;
    }
  });

  function updateField(key: string, value: unknown) {
    formValues = { ...formValues, [key]: value };
  }

  let missingRequired = $derived.by(() => {
    if (!current?.requestedSchema) return [];
    const required = current.requestedSchema.required ?? [];
    const props = current.requestedSchema.properties ?? {};
    return required.filter((key) => {
      if (!(key in props)) return false;
      const val = formValues[key];
      if (val === undefined || val === null || val === "") return true;
      return false;
    });
  });

  async function handleAccept() {
    if (!current || submitting) return;
    if (missingRequired.length > 0) {
      dbgWarn("ElicitationDialog", "required fields missing", { keys: missingRequired });
      return;
    }
    submitting = true;
    dbg("ElicitationDialog", "accept", { requestId: current.requestId });
    try {
      await onRespond(current.requestId, "accept", formValues);
    } catch (e) {
      dbgWarn("ElicitationDialog", "accept error", e);
    } finally {
      submitting = false;
    }
  }

  async function handleDecline() {
    if (!current || submitting) return;
    submitting = true;
    dbg("ElicitationDialog", "decline", { requestId: current.requestId });
    try {
      await onRespond(current.requestId, "decline");
    } catch (e) {
      dbgWarn("ElicitationDialog", "decline error", e);
    } finally {
      submitting = false;
    }
  }

  async function openElicitationUrl(href: string) {
    try {
      const url = new URL(href);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        dbgWarn("ElicitationDialog", "blocked non-http(s) URL", { href });
        return;
      }
    } catch {
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(href);
    } catch {
      window.open(href, "_blank");
    }
  }

  function renderFieldType(field: ElicitationFieldSchema): string {
    if (field.enum && field.enum.length > 0) return "enum";
    return field.type ?? "string";
  }

  // Check if this is a simple multi-choice elicitation (common case)
  let isSimpleChoice = $derived.by(() => {
    if (!current?.requestedSchema?.properties) return false;
    const props = current.requestedSchema.properties;
    const entries = Object.entries(props);
    if (entries.length !== 1) return false;
    const [, field] = entries[0];
    return field.type === "string" && field.enum && field.enum.length > 0;
  });

  let choices = $derived.by(() => {
    if (!isSimpleChoice || !current?.requestedSchema?.properties) return [];
    const props = current.requestedSchema.properties;
    const entries = Object.entries(props);
    if (entries.length !== 1) return [];
    const [, field] = entries[0];
    return field.enum ?? [];
  });

  let selectedChoice = $derived(
    formValues[Object.keys(current?.requestedSchema?.properties ?? {})[0] ?? ""] as string,
  );

  function selectChoice(value: string) {
    if (!current?.requestedSchema?.properties) return;
    const key = Object.keys(current.requestedSchema.properties)[0];
    updateField(key, value);
  }
</script>

{#if current}
  <div
    class="relative isolate overflow-hidden rounded-2xl border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--miwarp-bg-elevated)/0.9)] px-6 py-5 shadow-[0_4px_24px_-8px_hsl(var(--miwarp-bg-deep)/0.4)] w-fit min-w-[520px] max-w-[760px] max-sm:w-full max-sm:min-w-0 max-sm:max-w-full"
    role="dialog"
    aria-label={t("elicitation_title")}
    transition:fly={{ y: 10, duration: 200 }}
  >
    <!-- Header -->
    <div class="mb-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <div
          class="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--miwarp-status-info)/0.12)] text-miwarp-status-info"
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
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
        </div>
        <span class="text-[13px] font-medium text-foreground">{t("elicitation_title")}</span>
      </div>
      <div class="shrink-0">
        {#if submitting}
          <span class="text-[11px] text-miwarp-status-info">...</span>
        {:else if missingRequired.length > 0}
          <span class="text-[11px] text-miwarp-status-info"
            >{t("elicitation_waiting") ?? "waiting"}</span
          >
        {:else}
          <span class="text-[11px] text-miwarp-status-success"
            >{t("elicitation_ready") ?? "ready"}</span
          >
        {/if}
      </div>
    </div>

    <!-- Message -->
    {#if current.message}
      <p class="mb-3.5 text-sm/[1.6] text-[hsl(var(--foreground)/0.9)]">{current.message}</p>
    {/if}

    <!-- URL button -->
    {#if current.url}
      <div class="mb-3.5">
        <button
          type="button"
          class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[hsl(var(--miwarp-status-info)/0.2)] bg-[hsl(var(--miwarp-status-info)/0.1)] px-3 py-1.5 text-xs text-miwarp-status-info transition-all duration-150 hover:border-[hsl(var(--miwarp-status-info)/0.35)] hover:bg-[hsl(var(--miwarp-status-info)/0.18)]"
          onclick={() => current?.url && openElicitationUrl(current.url)}
        >
          {t("elicitation_open_url")}
        </button>
      </div>
    {/if}

    <!-- Simple choice chips -->
    {#if isSimpleChoice && choices.length > 0}
      <div class="mb-4 flex flex-wrap gap-2">
        {#each choices as choice}
          <button
            type="button"
            class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[hsl(var(--border)/0.7)] bg-background px-3.5 py-1.5 text-[13px] font-medium text-[hsl(var(--foreground)/0.8)] transition-all duration-150 hover:border-[hsl(var(--primary)/0.3)] hover:bg-accent {selectedChoice ===
            choice
              ? 'border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.1)] text-primary'
              : ''}"
            onclick={() => selectChoice(choice)}
          >
            {#if selectedChoice === choice}
              <svg
                class="h-3 w-3 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            {/if}
            {choice}
          </button>
        {/each}
      </div>
    {:else if current.requestedSchema?.properties}
      <!-- Full form fields -->
      <div class="mb-4 flex flex-col gap-3.5">
        {#each Object.entries(current.requestedSchema.properties) as [key, field]}
          {@const fieldType = renderFieldType(field)}
          {@const isRequired = current.requestedSchema?.required?.includes(key) ?? field.required}
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-[hsl(var(--foreground)/0.85)]" for="elic-{key}">
              {field.title ?? key}
              {#if isRequired}
                <span class="text-destructive">*</span>
              {/if}
            </label>
            {#if field.description}
              <p class="mb-0.5 text-[11px] text-muted-foreground">{field.description}</p>
            {/if}

            {#if fieldType === "boolean"}
              <label
                class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex cursor-pointer items-center gap-2 rounded-md border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--background)/0.5)] px-3 py-2"
              >
                <input
                  id="elic-{key}"
                  type="checkbox"
                  checked={!!formValues[key]}
                  onchange={(e) => updateField(key, (e.target as HTMLInputElement).checked)}
                  class="rounded border-border text-primary focus:ring-ring/30"
                />
                <span class="text-xs text-muted-foreground">{field.title ?? key}</span>
              </label>
            {:else if fieldType === "enum" && field.enum}
              <select
                id="elic-{key}"
                value={String(formValues[key] ?? "")}
                onchange={(e) => updateField(key, (e.target as HTMLSelectElement).value)}
                class="w-full rounded-md border border-[hsl(var(--border)/0.6)] bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-[border-color] duration-150 focus:border-[hsl(var(--primary)/0.5)] focus:shadow-[0_0_0_2px_hsl(var(--primary)/0.1)]"
              >
                <option value="">--</option>
                {#each field.enum as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else if fieldType === "number"}
              <input
                id="elic-{key}"
                type="number"
                value={formValues[key] as number}
                oninput={(e) => updateField(key, Number((e.target as HTMLInputElement).value))}
                class="w-full rounded-md border border-[hsl(var(--border)/0.6)] bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-[border-color] duration-150 focus:border-[hsl(var(--primary)/0.5)] focus:shadow-[0_0_0_2px_hsl(var(--primary)/0.1)]"
              />
            {:else}
              <input
                id="elic-{key}"
                type="text"
                value={String(formValues[key] ?? "")}
                oninput={(e) => updateField(key, (e.target as HTMLInputElement).value)}
                class="w-full rounded-md border border-[hsl(var(--border)/0.6)] bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-[border-color] duration-150 focus:border-[hsl(var(--primary)/0.5)] focus:shadow-[0_0_0_2px_hsl(var(--primary)/0.1)]"
                placeholder={field.title ?? key}
              />
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Footer actions -->
    <div
      class="flex items-center justify-end gap-2 border-t border-[hsl(var(--border)/0.4)] pt-3.5"
    >
      <button
        type="button"
        class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex cursor-pointer items-center justify-center rounded-lg border border-[hsl(var(--border)/0.7)] bg-transparent px-[18px] py-2 text-[13px] font-medium text-muted-foreground transition-all duration-150 hover:border-border hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        disabled={submitting}
        onclick={handleDecline}
      >
        {t("elicitation_decline")}
      </button>
      <button
        type="button"
        class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex cursor-pointer items-center justify-center rounded-lg border border-primary bg-primary px-[18px] py-2 text-[13px] font-medium text-primary-foreground transition-all duration-150 hover:bg-[hsl(var(--primary)/0.9)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={submitting || missingRequired.length > 0}
        onclick={handleAccept}
      >
        {submitting ? "..." : t("elicitation_accept")}
      </button>
    </div>
  </div>
{/if}
