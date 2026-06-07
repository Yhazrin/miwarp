<script lang="ts">
  /**
   * v1.0.6 follow-up: providers tab shell. Receives auth + credential
   * state via props from the orchestrator. The full inline form
   * (auth mode selector, platform credentials, model selectors, extra
   * env vars) is delegated to callbacks. Detailed sub-panels will be
   * extracted into PlatformCredentialsCard and similar in follow-up.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { PlatformCredential, UserSettings } from "$lib/types";
  import Card from "$lib/components/Card.svelte";

  let {
    settings,
    platformCredentials = [] as PlatformCredential[],
    selectedPlatformId = null as string | null,
    authMode = "cli",
    anthropicApiKey = "",
    anthropicBaseUrl = "",
    showApiKey = false,
    onSelectPlatform = async (_id: string) => {},
    onAuthModeChange = async (_mode: string) => {},
    onSaveApiAuth = async () => {},
  }: {
    settings: UserSettings | null;
    platformCredentials?: PlatformCredential[];
    selectedPlatformId?: string | null;
    authMode?: string;
    anthropicApiKey?: string;
    anthropicBaseUrl?: string;
    showApiKey?: boolean;
    onSelectPlatform?: (id: string) => Promise<void>;
    onAuthModeChange?: (mode: string) => Promise<void>;
    onSaveApiAuth?: () => Promise<void>;
  } = $props();
  function lk(key: string): string { return t(key as MessageKey); }

</script>

<div class="space-y-6">
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {lk("settings_connection_authMode")}
    </h2>
    <div class="flex flex-wrap gap-1">
      {#each ["cli", "api"] as mode (mode)}
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150
            {authMode === mode
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
          onclick={() => onAuthModeChange(mode)}
        >
          {mode === "cli" ? lk("settings_connection_cli") : lk("settings_connection_api")}
        </button>
      {/each}
    </div>
  </Card>

  {#if authMode === "api"}
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {lk("settings_connection_apiAuth")}
      </h2>
      <div class="flex flex-wrap gap-1">
        {#each platformCredentials as cred (cred.platform_id)}
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150
              {selectedPlatformId === cred.platform_id
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
            onclick={() => onSelectPlatform(cred.platform_id)}
          >
            {cred.platform_id}
          </button>
        {/each}
      </div>
      <input
        type={showApiKey ? "text" : "password"}
        value={anthropicApiKey}
        placeholder={lk("settings_connection_apiKey")}
        onblur={onSaveApiAuth}
        class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
      />
      <input
        type="url"
        value={anthropicBaseUrl}
        placeholder={lk("settings_connection_baseUrl")}
        onblur={onSaveApiAuth}
        class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono"
      />
    </Card>
  {/if}
</div>
