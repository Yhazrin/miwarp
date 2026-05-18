<script lang="ts">
  /**
   * Connection/Platform settings tab.
   * Extracted from settings/+page.svelte to reduce file complexity.
   */
  import * as api from "$lib/api";
  import type { useConnectionPlatform } from "$lib/composables/use-connection-platform.svelte";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";
  import Input from "$lib/components/Input.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import {
    isCustomPlatform,
    findCredential,
    expandModelsToTiers,
  } from "$lib/utils/platform-presets";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    conn: ReturnType<typeof useConnectionPlatform>;
    saveGeneralPatch: (patch: Record<string, unknown>) => void;
    generalSaved: boolean;
    openSetupWizard: () => void;
  }

  let { conn, saveGeneralPatch, generalSaved, openSetupWizard }: Props = $props();
</script>

<div class="space-y-6">
  <!-- Authentication -->
  <Card class="p-6 space-y-5">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_general_connection")}
      </h2>
      {#if generalSaved}
        <span class="text-xs text-emerald-500 flex items-center gap-1 animate-fade-in">
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
          >
          {t("settings_general_saved")}
        </span>
      {/if}
    </div>

    <!-- Auth Mode selector: 2-way radio -->
    <div>
      <span class="text-sm font-medium mb-2 block">{t("settings_auth_modeLabel")}</span>
      <div class="mt-1 grid grid-cols-2 gap-3">
        <button
          class="flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-all duration-150
      {conn.authMode === 'cli'
            ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
            : 'hover:bg-accent hover:border-ring/30'}"
          onclick={() => {
            conn.authMode = "cli";
            saveGeneralPatch({
              auth_mode: "cli",
              anthropic_base_url: null,
              active_platform_id: null,
              auth_env_var: null,
            });
            api.removeCliApiKey().catch(() => {});
            api
              .getAuthOverview()
              .then((ov) => (conn.authOverview = ov))
              .catch(() => {});
          }}
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
            <svg
              class="h-5 w-5 text-emerald-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path
                d="M7 11V7a5 5 0 0 1 10 0v4"
              />
            </svg>
          </div>
          <span class="font-medium">{t("auth_cliAuth")}</span>
          <span class="text-[10px] text-muted-foreground text-center"
            >{t("settings_auth_modeCliDesc")}</span
          >
        </button>
        <button
          class="flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-all duration-150
      {conn.authMode === 'api'
            ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
            : 'hover:bg-accent hover:border-ring/30'}"
          onclick={() => {
            conn.authMode = "api";
            saveGeneralPatch({ auth_mode: "api" });
            api
              .getAuthOverview()
              .then((ov) => (conn.authOverview = ov))
              .catch(() => {});
          }}
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/10">
            <svg
              class="h-5 w-5 text-violet-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
              />
            </svg>
          </div>
          <span class="font-medium">{t("auth_appApiKey")}</span>
          <span class="text-[10px] text-muted-foreground text-center"
            >{t("settings_auth_modeAppDesc")}</span
          >
        </button>
      </div>
    </div>

    <!-- CLI Auth details (expanded when auth_mode = cli) -->
    {#if conn.authMode === "cli"}
      <div class="space-y-4 rounded-lg border border-border/50 p-4">
        <!-- CLI Login status -->
        <div>
          <h3 class="text-sm font-medium mb-1">{t("settings_auth_cliLoginTitle")}</h3>
          <p class="text-xs text-muted-foreground mb-2">
            {t("settings_auth_cliLoginDesc")}
          </p>
          {#if conn.authOverview?.cli_login_available}
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span class="text-xs text-emerald-500">
                {t("auth_loggedIn")}{conn.authOverview.cli_login_account
                  ? `: ${conn.authOverview.cli_login_account}`
                  : ""}
              </span>
            </div>
          {:else}
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-muted-foreground/40"></span>
                <span class="text-xs text-muted-foreground">{t("auth_notLoggedIn")}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={conn.cliLoginLoading}
                  onclick={() => {
                    conn.cliLoginLoading = true;
                    conn.cliLoginError = "";
                    api
                      .runClaudeLogin()
                      .then((success) => {
                        if (success) {
                          api
                            .getAuthOverview()
                            .then((ov) => (conn.authOverview = ov))
                            .catch(() => {});
                        } else {
                          conn.cliLoginError = t("setup_loginFailed");
                        }
                      })
                      .catch((e) => {
                        conn.cliLoginError = String(e);
                      })
                      .finally(() => {
                        conn.cliLoginLoading = false;
                      });
                  }}
                >
                  {#if conn.cliLoginLoading}
                    <span class="flex items-center gap-1.5">
                      <Spinner size="xs" class="text-foreground/30" />
                      {t("settings_auth_cliLoginBtn")}
                    </span>
                  {:else}
                    {t("settings_auth_cliLoginBtn")}
                  {/if}
                </Button>
              </div>
              {#if conn.cliLoginError}
                <div class="rounded border border-red-500/30 bg-red-500/5 px-2 py-1">
                  <p class="text-xs text-red-500">{conn.cliLoginError}</p>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- CLI API Key (read-only) -->
        <div>
          <h3 class="text-sm font-medium mb-1">{t("settings_auth_cliApiKeyTitle")}</h3>
          {#if conn.authOverview?.cli_has_api_key}
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span class="text-xs text-emerald-500"
                >{t("auth_cliKeyHint", {
                  hint: conn.authOverview.cli_api_key_hint ?? "",
                })}</span
              >
            </div>
            <p class="mt-1 text-[10px] text-muted-foreground/70 italic">
              {#if conn.authOverview.cli_api_key_source === "settings"}
                {t("settings_auth_cliApiKeySourceSettings")}
              {:else if conn.authOverview.cli_api_key_source === "env"}
                {t("settings_auth_cliApiKeySourceEnv")}
              {:else if conn.authOverview.cli_api_key_source?.startsWith("shell_config:")}
                {t("settings_auth_cliApiKeySourceShell", {
                  path: conn.authOverview.cli_api_key_source.slice(13),
                })}
              {/if}
            </p>
          {:else}
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-muted-foreground/40"></span>
              <span class="text-xs text-muted-foreground">{t("settings_auth_cliApiKeyNotSet")}</span
              >
            </div>
            <p class="mt-1 text-[10px] text-muted-foreground/70 italic">
              {t("settings_auth_cliApiKeyEditHint")}
            </p>
          {/if}
        </div>

        <!-- Priority hint -->
        {#if conn.authOverview?.cli_login_available && conn.authOverview?.cli_has_api_key}
          <p class="text-[10px] text-muted-foreground/70 italic">
            {t("auth_cliPriorityHint")}
          </p>
        {/if}
      </div>
    {/if}

    {#if conn.authMode === "api"}
      <div class="space-y-4 rounded-lg border border-border/50 p-4">
        <div>
          <h3 class="text-sm font-medium mb-1">{t("settings_auth_appApiKeyTitle")}</h3>
          <p class="text-xs text-muted-foreground mb-3">
            {t("settings_auth_appApiKeyDesc")}
          </p>
        </div>
        <!-- Platform selector -->
        <div>
          <span class="text-sm font-medium mb-1.5 block">{t("settings_general_platform")}</span>
          <!-- Platform grid (always visible) -->
          <div class="grid grid-cols-4 gap-1.5">
            {#each conn.platformList.filter((p) => p.id !== "custom") as preset (preset.id)}
              <button
                class="flex flex-col gap-0 rounded-md p-2 text-left transition-colors relative group
            {conn.selectedPlatformId === preset.id
                  ? 'bg-primary/10 ring-1 ring-primary'
                  : 'bg-muted/40 hover:bg-muted/70'}"
                onclick={() => conn.applyPlatformPreset(preset)}
              >
                <span class="text-xs font-medium truncate">{preset.name}</span>
                <span class="text-[10px] text-muted-foreground truncate">{preset.description}</span>
                {#if isCustomPlatform(preset.id)}
                  <span
                    role="button"
                    tabindex="0"
                    class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5 cursor-pointer"
                    onclick={(e: MouseEvent) => {
                      e.stopPropagation();
                      conn.deleteCustomEndpoint(preset.id);
                    }}
                    onkeydown={(e: KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        conn.deleteCustomEndpoint(preset.id);
                      }
                    }}
                    title={t("settings_general_deleteCustom")}
                  >
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
                    >
                  </span>
                {/if}
                {#if preset.category === "local"}
                  {@const ps = conn.localProxyStatuses[preset.id]}
                  <span
                    class="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full {ps?.running &&
                    !ps.needsAuth
                      ? 'bg-green-500'
                      : ps?.running && ps.needsAuth
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground/30'}"
                    title={ps?.running && !ps.needsAuth
                      ? t("settings_local_running")
                      : ps?.running && ps.needsAuth
                        ? t("settings_local_needsAuth")
                        : t("settings_local_notDetected")}
                  ></span>
                {:else if findCredential(conn.platformCredentials, preset.id)?.api_key}
                  <span
                    class="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-green-500"
                    title="Key saved"
                  ></span>
                {/if}
              </button>
            {/each}
            <!-- Add Custom -->
            <button
              class="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 p-2 text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-muted/40 transition-colors"
              onclick={() => conn.addCustomEndpoint()}
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><path d="M12 5v14" /><path d="M5 12h14" /></svg
              >
              <span class="text-[10px]">{t("settings_general_addCustom")}</span>
            </button>
          </div>
        </div>

        {#if conn.selectedPlatform?.category === "local"}
          <!-- Local proxy status card -->
          <div class="rounded-lg border p-4 space-y-3">
            <div class="flex items-center gap-2">
              {#if conn.localProxyChecking}
                <span class="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
                <span class="text-sm">{t("settings_local_checking")}</span>
              {:else if conn.localProxyStatus?.running && !conn.localProxyStatus.needsAuth}
                <span class="h-2 w-2 rounded-full bg-green-500"></span>
                <span class="text-sm font-medium">{t("settings_local_running")}</span>
              {:else if conn.localProxyStatus?.running && conn.localProxyStatus.needsAuth}
                <span class="h-2 w-2 rounded-full bg-amber-500"></span>
                <span class="text-sm font-medium">{t("settings_local_needsAuth")}</span>
              {:else}
                <span class="h-2 w-2 rounded-full bg-muted-foreground/30"></span>
                <span class="text-sm">{t("settings_local_notDetected")}</span>
              {/if}
              <button
                class="ml-auto rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onclick={conn.checkLocalProxy}>{t("settings_local_refresh")}</button
              >
            </div>
            <p class="text-xs text-muted-foreground font-mono">{conn.anthropicBaseUrl}</p>
            {#if conn.localProxyStatus && !conn.localProxyStatus.running}
              <p class="text-xs text-amber-500">
                {conn.selectedPlatform.setup_hint
                  ? t(conn.selectedPlatform.setup_hint as Parameters<typeof t>[0])
                  : t("settings_local_startHint", { name: conn.selectedPlatform.name })}
              </p>
            {/if}
            {#if conn.selectedPlatform.docs_url}
              <a
                href={conn.selectedPlatform.docs_url}
                target="_blank"
                class="text-xs text-primary hover:underline"
              >
                {t("settings_local_viewDocs")} →
              </a>
            {/if}
          </div>

          <!-- Advanced settings toggle -->
          <button
            class="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onclick={() => (conn.localAdvancedOpen = !conn.localAdvancedOpen)}
          >
            {conn.localAdvancedOpen ? "▾" : "▸"}
            {t("settings_local_advanced")}
          </button>
        {/if}

        {#if conn.selectedPlatform?.category !== "local" || conn.localAdvancedOpen}
          <!-- Custom endpoint: Name + Auth Type -->
          {#if isCustomPlatform(conn.selectedPlatformId ?? "")}
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="text-sm font-medium mb-1.5 block"
                  >{t("settings_general_customNameLabel")}</label
                >
                <Input
                  value={findCredential(conn.platformCredentials, conn.selectedPlatformId ?? "")
                    ?.name ?? ""}
                  placeholder={t("settings_general_customNamePlaceholder")}
                  class="mt-1 text-xs"
                  onblur={(e) => {
                    const target = e.currentTarget as HTMLInputElement | null;
                    if (!target) return;
                    const val = target.value.trim();
                    if (conn.selectedPlatformId) {
                      conn._upsertCredential(conn.selectedPlatformId, {
                        name: val || "Custom",
                      });
                      saveGeneralPatch({
                        platform_credentials: conn.platformCredentials,
                      });
                    }
                  }}
                />
              </div>
              <div>
                <label class="text-sm font-medium mb-1.5 block"
                  >{t("settings_general_authType")}</label
                >
                <div class="mt-1 flex rounded-md border border-input overflow-hidden">
                  <button
                    class="px-3 py-1.5 text-xs font-medium transition-colors {(findCredential(
                      conn.platformCredentials,
                      conn.selectedPlatformId ?? '',
                    )?.auth_env_var ?? 'ANTHROPIC_AUTH_TOKEN') === 'ANTHROPIC_AUTH_TOKEN'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'}"
                    onclick={() => {
                      if (conn.selectedPlatformId) {
                        conn._upsertCredential(conn.selectedPlatformId, {
                          auth_env_var: "ANTHROPIC_AUTH_TOKEN",
                        });
                        saveGeneralPatch({
                          platform_credentials: conn.platformCredentials,
                        });
                      }
                    }}>{t("settings_bearer")}</button
                  >
                  <button
                    class="px-3 py-1.5 text-xs font-medium transition-colors border-l border-input {(findCredential(
                      conn.platformCredentials,
                      conn.selectedPlatformId ?? '',
                    )?.auth_env_var ?? 'ANTHROPIC_AUTH_TOKEN') === 'ANTHROPIC_API_KEY'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'}"
                    onclick={() => {
                      if (conn.selectedPlatformId) {
                        conn._upsertCredential(conn.selectedPlatformId, {
                          auth_env_var: "ANTHROPIC_API_KEY",
                        });
                        saveGeneralPatch({
                          platform_credentials: conn.platformCredentials,
                        });
                      }
                    }}>x-api-key</button
                  >
                </div>
              </div>
            </div>
          {/if}

          <!-- API Key input -->
          <div>
            <label class="text-sm font-medium mb-1.5 block" for="api-key"
              >{t("settings_general_apiKey")}</label
            >
            <div class="mt-1 flex gap-2">
              <div class="flex-1 relative">
                <Input
                  bind:value={conn.anthropicApiKey}
                  placeholder={conn.selectedPlatform?.key_placeholder ?? "<your-api-key>"}
                  type={conn.showApiKey ? "text" : "password"}
                  class="font-mono text-xs"
                  onblur={() => conn.persistCurrentPlatform()}
                />
              </div>
              <button
                class="rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
                onclick={() => (conn.showApiKey = !conn.showApiKey)}
              >
                {conn.showApiKey ? t("settings_general_hide") : t("settings_general_show")}
              </button>
              {#if conn.selectedPlatform?.category !== "local"}
                {@const cred = findCredential(
                  conn.platformCredentials,
                  conn.selectedPlatformId ?? "",
                )}
                {@const authEnvVar =
                  cred?.auth_env_var || conn.selectedPlatform?.auth_env_var || "ANTHROPIC_API_KEY"}
                {@const [presetOpusTest, presetSonnetTest] = expandModelsToTiers(
                  conn.selectedPlatform?.models,
                )}
                {@const testModel =
                  conn.modelSonnet.trim() ||
                  conn.modelOpus.trim() ||
                  presetSonnetTest ||
                  presetOpusTest ||
                  ""}
                {@const isCustom = isCustomPlatform(conn.selectedPlatformId ?? "")}
                {@const noKey = !conn.anthropicApiKey}
                {@const noUrl = isCustom && !conn.anthropicBaseUrl.trim()}
                {@const disableReason = noKey
                  ? t("settings_apiTest_noKey")
                  : noUrl
                    ? t("settings_apiTest_noUrl")
                    : ""}
                <button
                  class="rounded-md border px-3 py-2 text-xs transition-colors {disableReason ||
                  conn.apiTestLoading
                    ? 'text-muted-foreground/50 cursor-not-allowed'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
                  disabled={!!disableReason || conn.apiTestLoading}
                  title={disableReason || ""}
                  onclick={async () => {
                    const myRequestId = ++conn.apiTestRequestId;
                    const myPlatformId = conn.selectedPlatformId;
                    conn.apiTestLoading = true;
                    conn.apiTestResult = null;
                    dbg("settings", "testApi start", {
                      platform: myPlatformId,
                      model: testModel,
                      authEnvVar,
                      reqId: myRequestId,
                    });
                    try {
                      const result = await api.testApiConnectivity(
                        conn.anthropicApiKey,
                        conn.anthropicBaseUrl,
                        authEnvVar,
                        testModel,
                      );
                      if (myRequestId !== conn.apiTestRequestId) return;
                      if (myPlatformId !== conn.selectedPlatformId) return;
                      conn.apiTestResult = result;
                      if (result.success) {
                        dbg("settings", "testApi success", {
                          latencyMs: result.latencyMs,
                        });
                      } else {
                        dbgWarn("settings", "testApi error", result.error);
                      }
                    } catch (e) {
                      if (
                        myRequestId !== conn.apiTestRequestId ||
                        myPlatformId !== conn.selectedPlatformId
                      )
                        return;
                      conn.apiTestResult = {
                        success: false,
                        latencyMs: 0,
                        error: String(e),
                        partial: false,
                      };
                      dbgWarn("settings", "testApi error", e);
                    } finally {
                      if (myRequestId === conn.apiTestRequestId) conn.apiTestLoading = false;
                    }
                  }}
                >
                  {t("settings_apiTest")}
                </button>
              {/if}
            </div>
            <!-- API test result -->
            {#if conn.apiTestLoading}
              <div class="mt-1.5 flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
                <span class="text-xs text-muted-foreground">{t("settings_apiTest_testing")}</span>
              </div>
            {:else if conn.apiTestResult?.success && conn.apiTestResult.partial}
              <div class="mt-1.5 flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-full bg-green-500"></span>
                <span class="text-xs text-green-600 dark:text-green-400"
                  >{t("settings_apiTest_partial", {
                    latency: String(conn.apiTestResult.latencyMs),
                  })}</span
                >
              </div>
            {:else if conn.apiTestResult?.success}
              <div class="mt-1.5 flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-full bg-green-500"></span>
                <span class="text-xs text-green-600 dark:text-green-400"
                  >{t("settings_apiTest_success", {
                    latency: String(conn.apiTestResult.latencyMs),
                  })}</span
                >
              </div>
            {:else if conn.apiTestResult && !conn.apiTestResult.success}
              <div class="mt-1.5 flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-full bg-red-500"></span>
                <span class="text-xs text-red-600 dark:text-red-400"
                  >{conn.apiTestResult.error ?? t("settings_apiTest_failed")}</span
                >
              </div>
            {:else if conn.selectedPlatform?.id === "ollama"}
              <p class="mt-1 text-xs text-muted-foreground">{t("setup_noKeyNeeded")}</p>
            {:else}
              <p class="mt-1 text-xs text-muted-foreground">
                {t("settings_general_apiKeyStored")}
              </p>
            {/if}
          </div>

          <!-- Base URL (only show for custom or direct editing) -->
          <div>
            <label class="text-sm font-medium mb-1.5 block" for="base-url"
              >{t("settings_general_baseUrl")}</label
            >
            <Input
              bind:value={conn.anthropicBaseUrl}
              placeholder="https://api.anthropic.com"
              class="mt-1 font-mono text-xs"
              disabled={conn.selectedPlatformId !== null &&
                conn.selectedPlatformId !== "anthropic" &&
                conn.selectedPlatform?.category !== "local" &&
                !isCustomPlatform(conn.selectedPlatformId ?? "")}
              onblur={() => conn.persistCurrentPlatform()}
            />
            <p class="mt-1 text-xs text-muted-foreground">
              {#if conn.selectedPlatform && conn.selectedPlatform.auth_env_var === "ANTHROPIC_AUTH_TOKEN"}
                {t("setup_authTypeBearer")}
              {:else if conn.selectedPlatform && conn.selectedPlatform.auth_env_var === "ANTHROPIC_API_KEY"}
                {t("setup_authTypeApiKey")}
              {:else}
                {t("settings_general_baseUrlHelp")}
              {/if}
            </p>
          </div>

          <!-- Models (3-tier: Opus / Sonnet / Haiku) -->
          {@const [presetOpus, presetSonnet, presetHaiku] = expandModelsToTiers(
            conn.selectedPlatform?.models,
          )}
          {@const phOpus = presetOpus || t("settings_general_modelsPlaceholder")}
          {@const phSonnet = presetSonnet || t("settings_general_modelsPlaceholder")}
          {@const phHaiku = presetHaiku || t("settings_general_modelsPlaceholder")}
          <div>
            <label class="text-sm font-medium mb-1.5 block">{t("settings_general_models")}</label>
            <div class="mt-1 space-y-1.5">
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground w-24 shrink-0 text-right"
                  >{t("settings_general_modelOpus")}</span
                >
                <Input
                  bind:value={conn.modelOpus}
                  placeholder={phOpus}
                  class="flex-1 font-mono text-xs"
                  onblur={() => conn.persistCurrentPlatform()}
                />
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground w-24 shrink-0 text-right font-medium"
                  >{t("settings_general_modelSonnet")}</span
                >
                <Input
                  bind:value={conn.modelSonnet}
                  placeholder={phSonnet}
                  class="flex-1 font-mono text-xs"
                  onblur={() => conn.persistCurrentPlatform()}
                />
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground w-24 shrink-0 text-right"
                  >{t("settings_general_modelHaiku")}</span
                >
                <Input
                  bind:value={conn.modelHaiku}
                  placeholder={phHaiku}
                  class="flex-1 font-mono text-xs"
                  onblur={() => conn.persistCurrentPlatform()}
                />
              </div>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
              {t("settings_general_modelsHelp")}
            </p>
          </div>

          <!-- Extra Environment Variables -->
          <div>
            <label class="text-sm font-medium mb-1.5 block" for="extra-env-section">
              {t("settings_general_extraEnv")}
            </label>
            {#each conn.platformExtraEnv as envVar, i}
              <div class="flex gap-1.5 mt-1.5">
                <Input
                  bind:value={envVar.key}
                  placeholder={t("settings_general_envKeyPlaceholder")}
                  class="flex-1 font-mono text-xs"
                  oninput={() => conn.markExtraEnvTouched()}
                  onblur={() => conn.persistCurrentPlatform()}
                  onpaste={(e: ClipboardEvent) => conn.handleEnvKeyPaste(e, i)}
                />
                <Input
                  bind:value={envVar.value}
                  placeholder={t("settings_general_envValuePlaceholder")}
                  class="flex-1 font-mono text-xs"
                  oninput={() => conn.markExtraEnvTouched()}
                  onblur={() => conn.persistCurrentPlatform()}
                />
                <button
                  class="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label={t("settings_remote_delete")}
                  onclick={() => {
                    conn.platformExtraEnv = conn.platformExtraEnv.filter((_, idx) => idx !== i);
                    conn.markExtraEnvTouched();
                    conn.persistCurrentPlatform();
                  }}
                >
                  <svg
                    class="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            {/each}
            <button
              class="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onclick={() => {
                conn.platformExtraEnv = [...conn.platformExtraEnv, { key: "", value: "" }];
              }}
            >
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 5v14" /><path d="M5 12h14" />
              </svg>
              {t("settings_general_addEnvVar")}
            </button>
            <p class="mt-1 text-xs text-muted-foreground">
              {t("settings_general_extraEnvHelp")}
            </p>
          </div>
        {/if}
      </div>
    {/if}
  </Card>

  <!-- Setup Wizard button -->
  <div class="flex items-center justify-between rounded-lg border border-border p-4">
    <div>
      <p class="text-sm font-medium">{t("settings_general_setupWizard")}</p>
      <p class="text-xs text-muted-foreground">{t("settings_general_setupWizardDesc")}</p>
    </div>
    <button
      class="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      onclick={openSetupWizard}>{t("settings_general_runWizard")}</button
    >
  </div>
</div>
