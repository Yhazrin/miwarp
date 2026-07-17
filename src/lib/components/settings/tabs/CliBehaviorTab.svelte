<script lang="ts">
  /**
   * v1.0.6 follow-up: extracted from settings +page.svelte's
   * `activeTab === "cli-config"` branch. Renders the 3 sub-cards
   * (Behavior / Appearance / Advanced) for the Claude Code CLI config,
   * with project override badges for keys overridden in
   * ~/.claude/settings.json.
   *
   * State is lifted to the orchestrator (+page.svelte) — see
   * `cliConfig` / `projectCliConfig` / `cliConfigLoaded` etc.
   * This component only consumes via props.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import { CLI_CONFIG_SETTINGS } from "$lib/utils/cli-config-settings";
  import type { CliConfigSettingDef, UserSettings } from "$lib/types";
  import Spinner from "$lib/components/Spinner.svelte";
  import Card from "$lib/components/Card.svelte";
  import SettingsFieldRow from "../_shared/SettingsFieldRow.svelte";
  import SettingsFieldEnum from "../_shared/SettingsFieldEnum.svelte";
  import SettingsFieldToggle from "../_shared/SettingsFieldToggle.svelte";
  import SettingsDoctorPanel from "../SettingsDoctorPanel.svelte";

  let {
    cliConfig = $bindable({} as Record<string, unknown>),
    projectCliConfig = {} as Record<string, unknown>,
    cliConfigLoaded = false,
    cliConfigLoading = false,
    cliConfigError = "",
    settings = null,
    onLoad = async () => {},
    onSavePatch = async (_key: string, _value: unknown) => {},
  }: {
    cliConfig?: Record<string, unknown>;
    projectCliConfig?: Record<string, unknown>;
    cliConfigLoaded?: boolean;
    cliConfigLoading?: boolean;
    cliConfigError?: string;
    settings?: UserSettings | null;
    onLoad?: () => Promise<void>;
    onSavePatch?: (key: string, value: unknown) => Promise<void>;
  } = $props();

  const behaviorSettings = $derived(CLI_CONFIG_SETTINGS.filter((s) => s.group === "behavior"));
  const appearanceSettings = $derived(CLI_CONFIG_SETTINGS.filter((s) => s.group === "appearance"));
  const advancedSettings = $derived(CLI_CONFIG_SETTINGS.filter((s) => s.group === "advanced"));

  function getCliConfigValue(key: string, def: CliConfigSettingDef): unknown {
    if (key in cliConfig) return cliConfig[key];
    return def.default;
  }

  function isProjectOverride(key: string): boolean {
    return key in projectCliConfig;
  }

  function _lk(key: string): string {
    return t(key as MessageKey);
  }

  async function toggle(key: string, def: CliConfigSettingDef) {
    const current = getCliConfigValue(key, def);
    const next = current === true ? false : true;
    await onSavePatch(key, next);
    cliConfig = { ...cliConfig, [key]: next };
  }

  function pickEnum(key: string, def: CliConfigSettingDef, value: string) {
    void onSavePatch(key, value).then(() => {
      cliConfig = { ...cliConfig, [key]: value };
    });
  }

  function commitString(key: string, def: CliConfigSettingDef, value: string) {
    const val = value.trim();
    if (val) {
      void onSavePatch(key, val).then(() => {
        cliConfig = { ...cliConfig, [key]: val };
      });
    } else {
      void onSavePatch(key, null).then(() => {
        const next = { ...cliConfig };
        delete next[key];
        cliConfig = next;
      });
    }
  }
</script>

{#if cliConfigLoading && !cliConfigLoaded}
  <div class="flex items-center justify-center py-12">
    <Spinner size="md" class="border-primary border-t-transparent" />
    <span class="ml-3 text-sm text-muted-foreground">{t("settings_cliConfig_loading")}</span>
  </div>
{:else if cliConfigError}
  <Card class="p-6">
    <p class="text-sm text-miwarp-status-error">
      {t("settings_cliConfig_loadFailed", { error: cliConfigError })}
    </p>
    <button
      type="button"
      class="mt-3 rounded-md border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
      onclick={onLoad}>{t("settings_cliConfig_retry")}</button
    >
  </Card>
{:else}
  <div class="space-y-6">
    <!-- Diagnostics + CLI version (reused by run_diagnostics which already
         fetches dist tags). Lives at the top so a one-click update is the
         first thing a user sees when troubleshooting. -->
    <SettingsDoctorPanel {settings} />

    <!-- Behavior -->
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_cliConfig_behavior")}
      </h2>
      {#each behaviorSettings as def (def.key)}
        <SettingsFieldRow
          label={def.label}
          description={def.description}
          overrideBadge={isProjectOverride(def.key) ? t("settings_cliConfig_projectOverride") : ""}
        >
          {#snippet children()}
            {#if def.type === "boolean"}
              <SettingsFieldToggle
                checked={getCliConfigValue(def.key, def) === true}
                onchange={() => toggle(def.key, def)}
              />
            {:else if def.type === "enum" && def.options}
              <SettingsFieldEnum
                value={String(getCliConfigValue(def.key, def) ?? "")}
                options={def.options}
                onchange={(v) => pickEnum(def.key, def, v)}
              />
            {/if}
          {/snippet}
        </SettingsFieldRow>
      {/each}
    </Card>

    <!-- Appearance -->
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_cliConfig_appearance")}
      </h2>
      {#each appearanceSettings as def (def.key)}
        <SettingsFieldRow
          label={def.label}
          description={def.description}
          overrideBadge={isProjectOverride(def.key) ? t("settings_cliConfig_projectOverride") : ""}
        >
          {#snippet children()}
            {#if def.type === "boolean"}
              <SettingsFieldToggle
                checked={getCliConfigValue(def.key, def) === true}
                onchange={() => toggle(def.key, def)}
              />
            {:else if def.type === "enum" && def.options}
              <SettingsFieldEnum
                value={String(getCliConfigValue(def.key, def) ?? "")}
                options={def.options}
                onchange={(v) => pickEnum(def.key, def, v)}
              />
            {:else if def.type === "string"}
              <input
                class="w-40 shrink-0 rounded-md border bg-transparent px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                value={String(getCliConfigValue(def.key, def) ?? "")}
                placeholder={def.label}
                onblur={(e) => commitString(def.key, def, (e.target as HTMLInputElement).value)}
              />
            {/if}
          {/snippet}
        </SettingsFieldRow>
      {/each}
    </Card>

    <!-- Advanced -->
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_cliConfig_advanced")}
      </h2>
      {#each advancedSettings as def (def.key)}
        <SettingsFieldRow
          label={def.label}
          description={def.description}
          overrideBadge={isProjectOverride(def.key) ? t("settings_cliConfig_projectOverride") : ""}
        >
          {#snippet children()}
            {#if def.type === "boolean"}
              <SettingsFieldToggle
                checked={getCliConfigValue(def.key, def) === true}
                onchange={() => toggle(def.key, def)}
              />
            {:else if def.type === "enum" && def.options}
              <SettingsFieldEnum
                value={String(getCliConfigValue(def.key, def) ?? "")}
                options={def.options}
                onchange={(v) => pickEnum(def.key, def, v)}
              />
            {/if}
          {/snippet}
        </SettingsFieldRow>
      {/each}
    </Card>

    <p class="text-[10px] text-muted-foreground px-1">
      {t("settings_cliConfig_footer")}
    </p>
  </div>
{/if}
