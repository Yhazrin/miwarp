<script lang="ts">
  /**
   * AI Preferences card — picks the default CLI runtime, default model, and
   * fallback model that new sessions will boot with. Reuses the existing
   * UserSettings fields (default_agent / default_model / fallback_model) so
   * the chat welcome screen + session creation flow see the same value.
   */
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { UserSettings } from "$lib/types";
  import type { AiSettings } from "./settings-slice";
  import Icon from "$lib/components/Icon.svelte";
  import PersonalSection from "./PersonalSection.svelte";

  let {
    aiSettings,
    runtimes,
    runtimesLoading = false,
    onCommit,
  }: {
    aiSettings: AiSettings;
    /** Available runtime ids from the control plane (e.g. ["claude", "codex"]). */
    runtimes: string[];
    /** When true, render the runtime radio group as a skeleton and hide the
     *  options. Used so cold-start pages can paint the rest of the card
     *  before the runtime probe finishes. */
    runtimesLoading?: boolean;
    onCommit: (patch: Partial<UserSettings>) => Promise<void>;
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  const RUNTIME_OPTIONS = $derived(
    runtimes.length > 0
      ? runtimes
      : aiSettings.default_agent
        ? [aiSettings.default_agent]
        : ["claude"],
  );

  async function pickRuntime(id: string) {
    if (id === aiSettings.default_agent) return;
    await onCommit({ default_agent: id });
  }

  async function commitModel(field: "default_model" | "fallback_model", value: string) {
    const trimmed = value.trim();
    const current = (aiSettings[field] as string | undefined) ?? "";
    if (trimmed === current) return;
    await onCommit({ [field]: trimmed || undefined } as Partial<UserSettings>);
  }
</script>

<PersonalSection
  icon="bot"
  eyebrow={lk("personal_section_ai_eyebrow")}
  title={lk("personal_section_ai_title")}
  description={lk("personal_section_ai_desc")}
>
  {#snippet action()}
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onclick={() => goto("/settings")}
    >
      {lk("personal_openSettings")}
      <Icon name="external-link" size="xs" />
    </button>
  {/snippet}

  <div class="space-y-4">
    <div class="space-y-2">
      <div>
        <p class="text-sm font-medium text-foreground">
          {lk("personal_ai_defaultRuntime")}
        </p>
        <p class="text-xs text-muted-foreground">{lk("personal_ai_defaultRuntimeDesc")}</p>
      </div>
      <div
        role="radiogroup"
        aria-label={lk("personal_ai_defaultRuntime")}
        class="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5"
      >
        {#if runtimesLoading}
          <div
            class="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/60"
            ></span>
            {lk("personal_runtime_loading")}
          </div>
        {:else}
          {#each RUNTIME_OPTIONS as id (id)}
            <button
              type="button"
              role="radio"
              aria-checked={aiSettings.default_agent === id}
              class="rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150
                {aiSettings.default_agent === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => pickRuntime(id)}
            >
              {id}
            </button>
          {/each}
        {/if}
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-1.5">
        <label
          for="personal-default-model"
          class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          {lk("personal_ai_defaultModel")}
        </label>
        <input
          id="personal-default-model"
          type="text"
          value={aiSettings.default_model ?? ""}
          placeholder={lk("personal_ai_defaultModelPlaceholder")}
          autocomplete="off"
          onblur={(e) => commitModel("default_model", (e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          class="w-full rounded-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm font-mono text-sidebar-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
        />
        <p class="text-[11px] text-muted-foreground/80">
          {lk("personal_ai_defaultModelHelp")}
        </p>
      </div>

      <div class="space-y-1.5">
        <label
          for="personal-fallback-model"
          class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          {lk("personal_ai_fallbackModel")}
        </label>
        <input
          id="personal-fallback-model"
          type="text"
          value={aiSettings.fallback_model ?? ""}
          placeholder={lk("personal_ai_fallbackModelPlaceholder")}
          autocomplete="off"
          onblur={(e) => commitModel("fallback_model", (e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          class="w-full rounded-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm font-mono text-sidebar-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
        />
        <p class="text-[11px] text-muted-foreground/80">
          {lk("personal_ai_fallbackModelHelp")}
        </p>
      </div>
    </div>
  </div>
</PersonalSection>
