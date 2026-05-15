<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { getPresets } from "$lib/services/team-dispatcher";
  import type { TeamPreset } from "$lib/types";

  let {
    open = $bindable(false),
    prompt = "",
    cwd = "",
    onDispatch,
    onUseSingleClaude,
    onCancel,
  }: {
    open?: boolean;
    prompt?: string;
    cwd?: string;
    onDispatch: (presetId: string) => void;
    onUseSingleClaude?: () => void;
    onCancel?: () => void;
  } = $props();

  let presets = $state<TeamPreset[]>([]);
  let selectedPresetId = $state("");
  let loading = $state(true);

  onMount(async () => {
    try {
      presets = await getPresets();
      if (presets.length > 0) {
        selectedPresetId = presets[0].id;
      }
    } catch (e) {
      console.error("Failed to load team presets:", e);
    } finally {
      loading = false;
    }
  });

  function handleDispatch() {
    if (!selectedPresetId) return;
    onDispatch(selectedPresetId);
    open = false;
  }

  function handleUseClaude() {
    onUseSingleClaude?.();
    open = false;
  }

  function handleCancel() {
    onCancel?.();
    open = false;
  }

  let selectedPreset = $derived(presets.find((p) => p.id === selectedPresetId));

  const PRESET_ICONS: Record<string, string> = {
    fullstack: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    review: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    research: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  };
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    onclick={handleCancel}
    onkeydown={(e) => e.key === "Escape" && handleCancel()}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="flex items-center gap-3 px-5 pt-5 pb-3">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <svg
            class="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <div>
          <h2 class="text-sm font-semibold text-foreground">{t("teamRun_dispatchTitle")}</h2>
          <p class="text-xs text-muted-foreground">{t("teamRun_dispatchDesc")}</p>
        </div>
      </div>

      <!-- Prompt preview -->
      <div class="mx-5 mb-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
        <p class="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{prompt}</p>
        {#if cwd}
          <p class="mt-1 text-[10px] text-muted-foreground/60 font-mono truncate">{cwd}</p>
        {/if}
      </div>

      <!-- Preset selection -->
      <div class="px-5 pb-3">
        <p class="text-xs font-medium text-foreground mb-2">{t("teamRun_selectPreset")}</p>
        {#if loading}
          <div class="flex items-center justify-center py-6">
            <div
              class="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"
            ></div>
          </div>
        {:else}
          <div class="space-y-1.5">
            {#each presets as preset (preset.id)}
              <button
                class="w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors
                  {selectedPresetId === preset.id
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border/40 hover:bg-accent/30'}"
                onclick={() => (selectedPresetId = preset.id)}
              >
                <!-- Icon -->
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md
                    {selectedPresetId === preset.id
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'}"
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
                    <path d={PRESET_ICONS[preset.id] || PRESET_ICONS.fullstack} />
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-foreground">{preset.name}</div>
                  <div class="text-xs text-muted-foreground">{preset.description}</div>
                  <div class="flex flex-wrap gap-1 mt-1.5">
                    {#each preset.members as member (member.id)}
                      <span
                        class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >{member.name}</span
                      >
                    {/each}
                  </div>
                </div>
                <!-- Radio dot -->
                <div
                  class="mt-1 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center
                    {selectedPresetId === preset.id
                    ? 'border-primary'
                    : 'border-muted-foreground/30'}"
                >
                  {#if selectedPresetId === preset.id}
                    <div class="h-2 w-2 rounded-full bg-primary"></div>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
        <button
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
          onclick={handleUseClaude}
        >
          {t("teamRun_useClaude")}
        </button>
        <div class="flex items-center gap-2">
          <button
            class="rounded-md px-3 py-1.5 text-xs font-medium border border-border text-foreground hover:bg-accent transition-colors"
            onclick={handleCancel}
          >
            {t("teamRun_cancel")}
          </button>
          <button
            class="rounded-md px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            disabled={!selectedPresetId || loading}
            onclick={handleDispatch}
          >
            {t("teamRun_startButton")}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
