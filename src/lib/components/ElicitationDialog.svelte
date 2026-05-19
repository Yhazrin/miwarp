<script lang="ts">
  import type { ElicitationState } from "$lib/stores/session-store.svelte";
  import type { ElicitationFieldSchema } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";

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
  <div class="elicitation-card" role="dialog" aria-label={t("elicitation_title")}>
    <!-- Header -->
    <div class="elicitation-header">
      <div class="elicitation-header-left">
        <div class="elicitation-icon">
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
        <span class="elicitation-type-label">{t("elicitation_title")}</span>
      </div>
      <div class="elicitation-header-right">
        {#if submitting}
          <span class="elicitation-status submitting">...</span>
        {:else if missingRequired.length > 0}
          <span class="elicitation-status waiting">{t("elicitation_waiting") ?? "waiting"}</span>
        {:else}
          <span class="elicitation-status ready">{t("elicitation_ready") ?? "ready"}</span>
        {/if}
      </div>
    </div>

    <!-- Message -->
    {#if current.message}
      <p class="elicitation-message">{current.message}</p>
    {/if}

    <!-- URL button -->
    {#if current.url}
      <div class="elicitation-url">
        <button
          class="elicitation-url-btn"
          onclick={() => current?.url && openElicitationUrl(current.url)}
        >
          {t("elicitation_open_url")}
        </button>
      </div>
    {/if}

    <!-- Simple choice chips -->
    {#if isSimpleChoice && choices.length > 0}
      <div class="elicitation-chips">
        {#each choices as choice}
          <button
            class="elicitation-chip"
            class:selected={selectedChoice === choice}
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
      <div class="elicitation-fields">
        {#each Object.entries(current.requestedSchema.properties) as [key, field]}
          {@const fieldType = renderFieldType(field)}
          {@const isRequired = current.requestedSchema?.required?.includes(key) ?? field.required}
          <div class="elicitation-field">
            <label class="elicitation-field-label" for="elic-{key}">
              {field.title ?? key}
              {#if isRequired}
                <span class="text-destructive">*</span>
              {/if}
            </label>
            {#if field.description}
              <p class="elicitation-field-hint">{field.description}</p>
            {/if}

            {#if fieldType === "boolean"}
              <label class="elicitation-checkbox-row">
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
                class="elicitation-select"
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
                class="elicitation-input"
              />
            {:else}
              <input
                id="elic-{key}"
                type="text"
                value={String(formValues[key] ?? "")}
                oninput={(e) => updateField(key, (e.target as HTMLInputElement).value)}
                class="elicitation-input"
                placeholder={field.title ?? key}
              />
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Footer actions -->
    <div class="elicitation-footer">
      <button
        class="elicitation-btn elicitation-btn--deny"
        disabled={submitting}
        onclick={handleDecline}
      >
        {t("elicitation_decline")}
      </button>
      <button
        class="elicitation-btn elicitation-btn--primary"
        disabled={submitting || missingRequired.length > 0}
        onclick={handleAccept}
      >
        {submitting ? "..." : t("elicitation_accept")}
      </button>
    </div>
  </div>
{/if}

<style>
  .elicitation-card {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    border-radius: 18px;
    padding: 18px 22px;
    background: hsl(var(--miwarp-bg-elevated) / 0.9);
    border: 1px solid hsl(var(--border) / 0.5);
    box-shadow: 0 4px 24px -8px hsl(var(--miwarp-bg-deep) / 0.4);
    animation: fade-in 0.2s ease-out both;

    /* Content-fit width */
    width: fit-content;
    min-width: 520px;
    max-width: 760px;
  }

  @media (max-width: 640px) {
    .elicitation-card {
      width: 100%;
      min-width: unset;
      max-width: 100%;
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .elicitation-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .elicitation-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .elicitation-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: hsl(var(--miwarp-status-info) / 0.12);
    color: hsl(var(--miwarp-status-info));
  }

  .elicitation-type-label {
    font-size: 13px;
    font-weight: 500;
    color: hsl(var(--foreground));
  }

  .elicitation-header-right {
    flex-shrink: 0;
  }

  .elicitation-status {
    font-size: 11px;
    color: hsl(var(--muted-foreground));
  }

  .elicitation-status.waiting {
    color: hsl(var(--miwarp-status-info));
  }
  .elicitation-status.submitting {
    color: hsl(var(--miwarp-status-info));
  }
  .elicitation-status.ready {
    color: hsl(var(--miwarp-status-success));
  }

  .elicitation-message {
    font-size: 14px;
    line-height: 1.6;
    color: hsl(var(--foreground) / 0.9);
    margin-bottom: 14px;
  }

  .elicitation-url {
    margin-bottom: 14px;
  }

  .elicitation-url-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 12px;
    color: hsl(var(--miwarp-status-info));
    background: hsl(var(--miwarp-status-info) / 0.1);
    border: 1px solid hsl(var(--miwarp-status-info) / 0.2);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .elicitation-url-btn:hover {
    background: hsl(var(--miwarp-status-info) / 0.18);
    border-color: hsl(var(--miwarp-status-info) / 0.35);
  }

  .elicitation-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }

  .elicitation-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 450;
    color: hsl(var(--foreground) / 0.8);
    background: hsl(var(--background));
    border: 1px solid hsl(var(--border) / 0.7);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .elicitation-chip:hover {
    background: hsl(var(--accent));
    border-color: hsl(var(--primary) / 0.3);
  }

  .elicitation-chip.selected {
    background: hsl(var(--primary) / 0.1);
    border-color: hsl(var(--primary) / 0.5);
    color: hsl(var(--primary));
  }

  .elicitation-fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 16px;
  }

  .elicitation-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .elicitation-field-label {
    font-size: 12px;
    font-weight: 500;
    color: hsl(var(--foreground) / 0.85);
  }

  .elicitation-field-hint {
    font-size: 11px;
    color: hsl(var(--muted-foreground));
    margin-bottom: 2px;
  }

  .elicitation-checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: hsl(var(--background) / 0.5);
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 8px;
    cursor: pointer;
  }

  .elicitation-select,
  .elicitation-input {
    width: 100%;
    padding: 8px 12px;
    font-size: 13px;
    color: hsl(var(--foreground));
    background: hsl(var(--background));
    border: 1px solid hsl(var(--border) / 0.6);
    border-radius: 8px;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .elicitation-select:focus,
  .elicitation-input:focus {
    border-color: hsl(var(--primary) / 0.5);
    box-shadow: 0 0 0 2px hsl(var(--primary) / 0.1);
  }

  .elicitation-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 14px;
    border-top: 1px solid hsl(var(--border) / 0.4);
  }

  .elicitation-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .elicitation-btn--deny {
    color: hsl(var(--muted-foreground));
    background: transparent;
    border: 1px solid hsl(var(--border) / 0.7);
  }

  .elicitation-btn--deny:hover:not(:disabled) {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
    border-color: hsl(var(--border));
  }

  .elicitation-btn--primary {
    color: hsl(var(--primary-foreground));
    background: hsl(var(--primary));
    border: 1px solid hsl(var(--primary));
  }

  .elicitation-btn--primary:hover:not(:disabled) {
    background: hsl(var(--primary) / 0.9);
  }

  .elicitation-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
