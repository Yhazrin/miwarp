<script lang="ts">
  /**
   * CLI Config settings tab.
   * Extracted from settings/+page.svelte to reduce file complexity.
   */
  import { onMount } from "svelte";
  import Card from "$lib/components/Card.svelte";
  import type { CliConfigSettingDef } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import * as api from "$lib/api";
  import { dbg, dbgWarn } from "$lib/utils/debug";

  onMount(() => loadCliConfig());

  let cliConfig = $state<Record<string, unknown>>({});
  let projectCliConfig = $state<Record<string, unknown>>({});
  let cliConfigLoaded = $state(false);
  let cliConfigLoading = $state(false);
  let cliConfigError = $state("");

  // CLI Config setting definitions
  const CLI_CONFIG_SETTINGS: CliConfigSettingDef[] = [
    // Behavior
    {
      key: "thinkingEnabled",
      label: t("settings_cliConfig_thinkingModeLabel"),
      description: t("settings_cliConfig_thinkingModeDesc"),
      group: "behavior",
      type: "boolean",
      default: true,
    },
    {
      key: "fastMode",
      label: t("settings_cliConfig_fastModeLabel"),
      description: t("settings_cliConfig_fastModeDesc"),
      group: "behavior",
      type: "boolean",
      default: false,
    },
    {
      key: "autoCompactEnabled",
      label: t("settings_cliConfig_autoCompactLabel"),
      description: t("settings_cliConfig_autoCompactDesc"),
      group: "behavior",
      type: "boolean",
      default: true,
    },
    {
      key: "fileCheckpointingEnabled",
      label: t("settings_cliConfig_fileCheckpointsLabel"),
      description: t("settings_cliConfig_fileCheckpointsDesc"),
      group: "behavior",
      type: "boolean",
      default: true,
    },
    {
      key: "respectGitignore",
      label: t("settings_cliConfig_respectGitignoreLabel"),
      description: t("settings_cliConfig_respectGitignoreDesc"),
      group: "behavior",
      type: "boolean",
      default: true,
    },
    {
      key: "verbose",
      label: t("settings_cliConfig_verboseLabel"),
      description: t("settings_cliConfig_verboseDesc"),
      group: "behavior",
      type: "boolean",
      default: false,
    },
    {
      key: "defaultPermissionMode",
      label: t("settings_cliConfig_permissionModeLabel"),
      description: t("settings_cliConfig_permissionModeDesc"),
      group: "behavior",
      type: "enum",
      default: undefined,
      options: [
        { value: "default", label: t("settings_cliConfig_optDefault") },
        { value: "plan", label: t("settings_cliConfig_optPlan") },
        { value: "acceptEdits", label: t("settings_cliConfig_optAutoEdit") },
        { value: "bypassPermissions", label: t("settings_cliConfig_optFullAuto") },
      ],
    },
    {
      key: "teammateMode",
      label: t("settings_cliConfig_teammateModeLabel"),
      description: t("settings_cliConfig_teammateModeDesc"),
      group: "behavior",
      type: "enum",
      default: "auto",
      options: [
        { value: "auto", label: t("settings_cliConfig_optAuto") },
        { value: "always", label: t("settings_cliConfig_optAlways") },
        { value: "never", label: t("settings_cliConfig_optNever") },
      ],
    },
    // Appearance
    {
      key: "theme",
      label: t("settings_cliConfig_cliThemeLabel"),
      description: t("settings_cliConfig_cliThemeDesc"),
      group: "appearance",
      type: "enum",
      default: "dark",
      options: [
        { value: "dark", label: t("settings_cliConfig_optDark") },
        { value: "light", label: t("settings_cliConfig_optLight") },
        { value: "light-high-contrast", label: t("settings_cliConfig_optHighContrast") },
      ],
    },
    {
      key: "prefersReducedMotion",
      label: t("settings_cliConfig_reduceMotionLabel"),
      description: t("settings_cliConfig_reduceMotionDesc"),
      group: "appearance",
      type: "boolean",
      default: false,
    },
    {
      key: "language",
      label: t("settings_cliConfig_responseLangLabel"),
      description: t("settings_cliConfig_responseLangDesc"),
      group: "appearance",
      type: "string",
      default: undefined,
    },
    {
      key: "outputStyle",
      label: t("settings_cliConfig_outputStyleLabel"),
      description: t("settings_cliConfig_outputStyleDesc"),
      group: "appearance",
      type: "string",
      default: undefined,
    },
    // Advanced
    {
      key: "autoConnectIde",
      label: t("settings_cliConfig_autoConnectIdeLabel"),
      description: t("settings_cliConfig_autoConnectIdeDesc"),
      group: "advanced",
      type: "boolean",
      default: false,
    },
    {
      key: "promptSuggestionsEnabled",
      label: t("settings_cliConfig_promptSuggestionsLabel"),
      description: t("settings_cliConfig_promptSuggestionsDesc"),
      group: "advanced",
      type: "boolean",
      default: true,
    },
    {
      key: "spinnerTipsEnabled",
      label: t("settings_cliConfig_spinnerTipsLabel"),
      description: t("settings_cliConfig_spinnerTipsDesc"),
      group: "advanced",
      type: "boolean",
      default: true,
    },
    {
      key: "codeDiffFooterEnabled",
      label: t("settings_cliConfig_codeDiffFooterLabel"),
      description: t("settings_cliConfig_codeDiffFooterDesc"),
      group: "advanced",
      type: "boolean",
      default: true,
    },
    {
      key: "prStatusFooterEnabled",
      label: t("settings_cliConfig_prStatusFooterLabel"),
      description: t("settings_cliConfig_prStatusFooterDesc"),
      group: "advanced",
      type: "boolean",
      default: true,
    },
    {
      key: "autoUpdatesChannel",
      label: t("settings_cliConfig_updateChannelLabel"),
      description: t("settings_cliConfig_updateChannelDesc"),
      group: "advanced",
      type: "enum",
      default: undefined,
      options: [
        { value: "latest", label: t("settings_cliConfig_optLatest") },
        { value: "stable", label: t("settings_cliConfig_optStable") },
      ],
    },
    {
      key: "preferredNotifChannel",
      label: t("settings_cliConfig_notifChannelLabel"),
      description: t("settings_cliConfig_notifChannelDesc"),
      group: "advanced",
      type: "enum",
      default: "auto",
      options: [
        { value: "auto", label: t("settings_cliConfig_optAuto") },
        { value: "iterm2", label: t("settings_cliConfig_optIterm2") },
        { value: "terminal_bell", label: t("settings_cliConfig_optTerminalBell") },
      ],
    },
  ];

  const behaviorSettings = CLI_CONFIG_SETTINGS.filter((s) => s.group === "behavior");
  const appearanceSettings = CLI_CONFIG_SETTINGS.filter((s) => s.group === "appearance");
  const advancedSettings = CLI_CONFIG_SETTINGS.filter((s) => s.group === "advanced");

  function getCliConfigValue(key: string, def: CliConfigSettingDef): unknown {
    return key in cliConfig ? cliConfig[key] : def.default;
  }

  function isProjectOverride(key: string): boolean {
    return key in projectCliConfig;
  }

  async function saveCliConfigPatch(key: string, value: unknown) {
    dbg("settings", "saveCliConfigPatch", { key, value });
    try {
      cliConfig = await api.updateCliConfig({ [key]: value ?? null });
    } catch (e) {
      dbgWarn("settings", "saveCliConfigPatch error", e);
    }
  }

  export async function loadCliConfig() {
    if (cliConfigLoading) return;
    cliConfigLoading = true;
    cliConfigError = "";
    try {
      cliConfig = await api.getCliConfig();
      const cwd = localStorage.getItem("ocv:project-cwd") || "";
      if (cwd) {
        projectCliConfig = await api.getProjectCliConfig(cwd);
      }
      cliConfigLoaded = true;
      dbg("settings", "cliConfig loaded", {
        keys: Object.keys(cliConfig).length,
        projectKeys: Object.keys(projectCliConfig).length,
      });
    } catch (e) {
      cliConfigError = String(e);
      dbgWarn("settings", "loadCliConfig error", e);
    } finally {
      cliConfigLoading = false;
    }
  }
</script>

{#if cliConfigLoading && !cliConfigLoaded}
  <div class="flex items-center justify-center py-12">
    <div
      class="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"
    ></div>
    <span class="ml-3 text-sm text-muted-foreground">{t("settings_cliConfig_loading")}</span>
  </div>
{:else if cliConfigError}
  <Card class="p-6">
    <p class="text-sm text-red-400">
      {t("settings_cliConfig_loadFailed", { error: cliConfigError })}
    </p>
    <button
      class="mt-3 rounded-md border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
      onclick={() => {
        cliConfigLoaded = false;
        loadCliConfig();
      }}
    >
      {t("settings_cliConfig_retry")}
    </button>
  </Card>
{:else}
  <div class="space-y-6">
    <!-- Behavior -->
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_cliConfig_behavior")}
      </h2>
      {#each behaviorSettings as def (def.key)}
        <div class="flex items-center justify-between gap-4 py-1">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium">{def.label}</p>
              {#if isProjectOverride(def.key)}
                <span
                  class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20"
                >
                  {t("settings_cliConfig_projectOverride")}
                </span>
              {/if}
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">{def.description}</p>
          </div>
          {#if def.type === "boolean"}
            <button
              aria-label={def.label}
              class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 {getCliConfigValue(
                def.key,
                def,
              ) === true
                ? 'bg-primary'
                : 'bg-neutral-700'}"
              onclick={() => {
                const current = getCliConfigValue(def.key, def);
                const next = current === true ? false : true;
                saveCliConfigPatch(def.key, next);
                cliConfig = { ...cliConfig, [def.key]: next };
              }}
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 {getCliConfigValue(
                  def.key,
                  def,
                ) === true
                  ? 'translate-x-6'
                  : 'translate-x-1'}"
              ></span>
            </button>
          {:else if def.type === "enum" && def.options}
            <div class="flex rounded-full border border-border bg-muted/40 p-0.5 gap-0.5 shrink-0">
              {#each def.options as opt (opt.value)}
                <button
                  type="button"
                  class="rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 select-none
                    {getCliConfigValue(def.key, def) === opt.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'}"
                  onclick={() => {
                    saveCliConfigPatch(def.key, opt.value);
                    cliConfig = { ...cliConfig, [def.key]: opt.value };
                  }}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </Card>

    <!-- Appearance -->
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_cliConfig_appearance")}
      </h2>
      {#each appearanceSettings as def (def.key)}
        <div class="flex items-center justify-between gap-4 py-1">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium">{def.label}</p>
              {#if isProjectOverride(def.key)}
                <span
                  class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20"
                >
                  {t("settings_cliConfig_projectOverride")}
                </span>
              {/if}
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">{def.description}</p>
          </div>
          {#if def.type === "boolean"}
            <button
              aria-label={def.label}
              class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 {getCliConfigValue(
                def.key,
                def,
              ) === true
                ? 'bg-primary'
                : 'bg-neutral-700'}"
              onclick={() => {
                const current = getCliConfigValue(def.key, def);
                const next = current === true ? false : true;
                saveCliConfigPatch(def.key, next);
                cliConfig = { ...cliConfig, [def.key]: next };
              }}
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 {getCliConfigValue(
                  def.key,
                  def,
                ) === true
                  ? 'translate-x-6'
                  : 'translate-x-1'}"
              ></span>
            </button>
          {:else if def.type === "enum" && def.options}
            <div class="flex rounded-full border border-border bg-muted/40 p-0.5 gap-0.5 shrink-0">
              {#each def.options as opt (opt.value)}
                <button
                  type="button"
                  class="rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 select-none
                    {getCliConfigValue(def.key, def) === opt.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'}"
                  onclick={() => {
                    saveCliConfigPatch(def.key, opt.value);
                    cliConfig = { ...cliConfig, [def.key]: opt.value };
                  }}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          {:else if def.type === "string"}
            <input
              class="w-40 shrink-0 rounded-md border bg-transparent px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none"
              value={getCliConfigValue(def.key, def) ?? ""}
              placeholder={def.label}
              onblur={(e) => {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val) {
                  saveCliConfigPatch(def.key, val);
                  cliConfig = { ...cliConfig, [def.key]: val };
                } else {
                  saveCliConfigPatch(def.key, null);
                  const next = { ...cliConfig };
                  delete next[def.key];
                  cliConfig = next;
                }
              }}
            />
          {/if}
        </div>
      {/each}
    </Card>

    <!-- Advanced -->
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_cliConfig_advanced")}
      </h2>
      {#each advancedSettings as def (def.key)}
        <div class="flex items-center justify-between gap-4 py-1">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium">{def.label}</p>
              {#if isProjectOverride(def.key)}
                <span
                  class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20"
                >
                  {t("settings_cliConfig_projectOverride")}
                </span>
              {/if}
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">{def.description}</p>
          </div>
          {#if def.type === "boolean"}
            <button
              aria-label={def.label}
              class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 {getCliConfigValue(
                def.key,
                def,
              ) === true
                ? 'bg-primary'
                : 'bg-neutral-700'}"
              onclick={() => {
                const current = getCliConfigValue(def.key, def);
                const next = current === true ? false : true;
                saveCliConfigPatch(def.key, next);
                cliConfig = { ...cliConfig, [def.key]: next };
              }}
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 {getCliConfigValue(
                  def.key,
                  def,
                ) === true
                  ? 'translate-x-6'
                  : 'translate-x-1'}"
              ></span>
            </button>
          {:else if def.type === "enum" && def.options}
            <div class="flex rounded-full border border-border bg-muted/40 p-0.5 gap-0.5 shrink-0">
              {#each def.options as opt (opt.value)}
                <button
                  type="button"
                  class="rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 select-none
                    {getCliConfigValue(def.key, def) === opt.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'}"
                  onclick={() => {
                    saveCliConfigPatch(def.key, opt.value);
                    cliConfig = { ...cliConfig, [def.key]: opt.value };
                  }}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </Card>

    <!-- Footer note -->
    <p class="text-[10px] text-muted-foreground px-1">
      {t("settings_cliConfig_footer")}
    </p>
  </div>
{/if}
