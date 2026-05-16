<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { updateUserSettings } from "$lib/api";
  import { setMascotOverrides } from "$lib/stores/mascot-overrides.svelte";
  import { AGENT_ASSETS, type AgentKind } from "$lib/utils/agent-assets";
  import type { UserSettings } from "$lib/types";

  let { settings }: { settings: UserSettings } = $props();

  // Current overrides (local copy for reactivity)
  let overrides = $state<Record<string, string>>({ ...(settings.mascot_overrides ?? {}) });

  // Which agent's picker is open
  let activePickerAgent = $state<string | null>(null);

  // All built-in mascots available as options
  const BUILT_IN_MASCOTS: { key: string; label: string; src: string }[] = [
    { key: "claude", label: "Claude", src: "/vendor/codeisland/mascots/claude.gif" },
    { key: "codex", label: "Codex", src: "/vendor/codeisland/mascots/codex.gif" },
    { key: "gemini", label: "Gemini", src: "/vendor/codeisland/mascots/gemini.gif" },
    { key: "cursor", label: "Cursor", src: "/vendor/codeisland/mascots/cursor.gif" },
    { key: "qoder", label: "Qoder", src: "/vendor/codeisland/mascots/qoder.gif" },
    { key: "factory", label: "Factory", src: "/vendor/codeisland/mascots/factory.gif" },
    { key: "codebuddy", label: "CodeBuddy", src: "/vendor/codeisland/mascots/codebuddy.gif" },
    { key: "opencode", label: "OpenCode", src: "/vendor/codeisland/mascots/opencode.gif" },
    { key: "cline", label: "Cline", src: "/vendor/codeisland/mascots/cline.gif" },
  ];

  // Agents that have mascot entries and show up in the list
  const CONFIGURABLE_AGENTS: { kind: AgentKind; label: string; defaultSrc: string }[] =
    Object.values(AGENT_ASSETS)
      .filter((a) => a.mascot || a.icon)
      .map((a) => ({
        kind: a.kind,
        label: a.displayName,
        defaultSrc: a.mascot ?? a.icon ?? "/light.png",
      }));

  function currentSrc(kind: string): string {
    return (
      overrides[kind] ?? AGENT_ASSETS[kind]?.mascot ?? AGENT_ASSETS[kind]?.icon ?? "/light.png"
    );
  }

  function isCustom(kind: string): boolean {
    const v = overrides[kind];
    return !!v && v.startsWith("data:");
  }

  function isOverridden(kind: string): boolean {
    return !!overrides[kind];
  }

  async function applyOverride(kind: string, src: string) {
    overrides = { ...overrides, [kind]: src };
    activePickerAgent = null;
    await saveOverrides();
  }

  async function resetOverride(kind: string) {
    const next = { ...overrides };
    delete next[kind];
    overrides = next;
    await saveOverrides();
  }

  async function resetAll() {
    overrides = {};
    await saveOverrides();
  }

  async function saveOverrides() {
    try {
      const updated = await updateUserSettings({ mascot_overrides: overrides });
      setMascotOverrides(updated.mascot_overrides ?? {});
    } catch (e) {
      console.error("Failed to save mascot overrides:", e);
    }
  }

  function handleFileUpload(kind: string, e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUri = ev.target?.result as string;
      if (dataUri) {
        await applyOverride(kind, dataUri);
      }
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    input.value = "";
  }

  function closePicker() {
    activePickerAgent = null;
  }
</script>

<div class="space-y-5">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-sm font-semibold text-foreground">
        {t("settings_appearance_agentTitle") || "Agent Avatars"}
      </h2>
      <p class="mt-0.5 text-xs text-muted-foreground">
        {t("settings_appearance_agentDesc") ||
          "Customize the mascot image shown for each AI agent. Choose a built-in GIF or upload your own."}
      </p>
    </div>
    {#if Object.keys(overrides).length > 0}
      <button
        class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onclick={resetAll}
      >
        {t("settings_appearance_resetAll") || "Reset all"}
      </button>
    {/if}
  </div>

  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {#each CONFIGURABLE_AGENTS as agent (agent.kind)}
      <div class="group relative">
        <!-- Agent card -->
        <button
          class="relative w-full rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-[hsl(var(--miwarp-accent-violet))] hover:bg-accent/40"
          onclick={() => (activePickerAgent = activePickerAgent === agent.kind ? null : agent.kind)}
        >
          <div class="flex flex-col items-center gap-2">
            <div
              class="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--miwarp-accent-violet)/0.08)]"
            >
              <img
                src={currentSrc(agent.kind)}
                alt={agent.label}
                class="h-full w-full object-contain"
                style="image-rendering: auto;"
              />
              {#if isOverridden(agent.kind)}
                <div
                  class="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-full bg-[hsl(var(--miwarp-accent-violet))] text-[9px] text-white"
                >
                  ✓
                </div>
              {/if}
            </div>
            <span class="text-center text-xs font-medium text-foreground">{agent.label}</span>
            {#if isCustom(agent.kind)}
              <span
                class="rounded-full bg-[hsl(var(--miwarp-accent-violet)/0.1)] px-1.5 py-0.5 text-[10px] text-[hsl(var(--miwarp-accent-violet))]"
              >
                {t("settings_appearance_custom") || "Custom"}
              </span>
            {:else if isOverridden(agent.kind)}
              <span
                class="rounded-full bg-[hsl(var(--miwarp-accent-violet)/0.1)] px-1.5 py-0.5 text-[10px] text-[hsl(var(--miwarp-accent-violet))]"
              >
                {t("settings_appearance_changed") || "Changed"}
              </span>
            {:else}
              <span class="text-[10px] text-muted-foreground">
                {t("settings_appearance_default") || "Default"}
              </span>
            {/if}
          </div>
        </button>

        <!-- Picker dropdown -->
        {#if activePickerAgent === agent.kind}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-40" onclick={closePicker}></div>
          <div
            class="absolute left-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-popover p-3 shadow-xl"
          >
            <p
              class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {t("settings_appearance_chooseMascot") || "Choose mascot"}
            </p>

            <!-- Built-in mascots grid -->
            <div class="grid grid-cols-3 gap-2">
              {#each BUILT_IN_MASCOTS as mascot (mascot.key)}
                <button
                  class="flex flex-col items-center gap-1 rounded-lg p-2 transition-colors hover:bg-accent {overrides[
                    agent.kind
                  ] === mascot.src
                    ? 'bg-[hsl(var(--miwarp-accent-violet)/0.15)] ring-1 ring-[hsl(var(--miwarp-accent-violet))]'
                    : ''}"
                  onclick={() => applyOverride(agent.kind, mascot.src)}
                  title={mascot.label}
                >
                  <div class="h-10 w-10 overflow-hidden rounded-full bg-accent/50">
                    <img src={mascot.src} alt={mascot.label} class="h-full w-full object-contain" />
                  </div>
                  <span class="text-[10px] text-muted-foreground">{mascot.label}</span>
                </button>
              {/each}
            </div>

            <div class="my-2 border-t border-border"></div>

            <!-- Upload custom -->
            <label
              class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {t("settings_appearance_uploadCustom") || "Upload custom image…"}
              <input
                type="file"
                accept="image/*"
                class="sr-only"
                onchange={(e) => handleFileUpload(agent.kind, e)}
              />
            </label>

            <!-- Reset this agent -->
            {#if isOverridden(agent.kind)}
              <button
                class="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
                onclick={() => resetOverride(agent.kind)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.31" />
                </svg>
                {t("settings_appearance_resetThis") || "Reset to default"}
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
