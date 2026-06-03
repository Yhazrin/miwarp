<script lang="ts">
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import MiPopover from "$lib/ui/MiPopover.svelte";
  import type { AuthOverview, PlatformCredential } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import {
    buildPlatformList,
    findCredential,
    PRESET_CATEGORIES,
  } from "$lib/utils/platform-presets";
  import { dbg } from "$lib/utils/debug";
  import { MIWARP_MENU_PANEL_CLASS } from "$lib/ui/miwarp-surfaces";

  let {
    authOverview = null,
    authSourceLabel = "",
    authSourceCategory = "unknown",
    apiKeySource = "",
    hasRun = false,
    authMode = "",
    platformCredentials = [],
    platformId = "anthropic",
    onAuthModeChange,
    onPlatformChange,
    variant = "default",
    localProxyStatuses = {} as Record<string, { running: boolean; needsAuth: boolean }>,
  }: {
    authOverview?: AuthOverview | null;
    authSourceLabel?: string;
    authSourceCategory?: string;
    apiKeySource?: string;
    hasRun?: boolean;
    authMode?: string;
    platformCredentials?: PlatformCredential[];
    platformId?: string;
    onAuthModeChange?: (mode: string) => void;
    onPlatformChange?: (platformId: string) => void;
    variant?: "default" | "hero";
    localProxyStatuses?: Record<string, { running: boolean; needsAuth: boolean }>;
  } = $props();

  let open = $state(false);

  const BADGE_COLORS: Record<string, string> = {
    login: "bg-[hsl(var(--miwarp-status-success)/0.15)] text-miwarp-status-success",
    env_key: "bg-miwarp-status-info/10 text-miwarp-status-info",
    none: "bg-miwarp-status-warning/15 text-miwarp-status-warning",
    other: "bg-foreground/10 text-foreground/60",
  };

  let badgeColor = $derived(BADGE_COLORS[authSourceCategory] ?? "");

  let platforms = $derived(buildPlatformList(platformCredentials));

  let groupedPlatforms = $derived.by(() => {
    const groups: { id: string; label: string; items: typeof platforms }[] = [];
    for (const cat of PRESET_CATEGORIES) {
      const items = platforms.filter((p) => p.category === cat.id);
      if (items.length > 0) groups.push({ id: cat.id, label: cat.label, items });
    }
    const categorized = new Set(PRESET_CATEGORIES.map((c) => c.id));
    const uncategorized = platforms.filter((p) => !categorized.has(p.category ?? ""));
    if (uncategorized.length > 0)
      groups.push({ id: "other", label: "Other", items: uncategorized });
    return groups;
  });

  let preSessionLabel = $derived.by(() => {
    if (!authOverview) return "";
    if (authOverview.auth_mode === "cli") return t("auth_cliAuth");
    const p = platforms.find((pl) => pl.id === platformId);
    return p?.name ?? authOverview.app_platform_name ?? t("auth_appApiKey");
  });

  let preSessionDotColor = $derived.by(() => {
    if (!authOverview) return "bg-muted-foreground/30";
    if (authOverview.auth_mode === "cli") {
      return authOverview.cli_login_available || authOverview.cli_has_api_key
        ? "bg-miwarp-status-success"
        : "bg-miwarp-status-warning";
    }
    const selectedPreset = platforms.find((p) => p.id === platformId);
    if (selectedPreset?.category === "local") {
      const ps = localProxyStatuses?.[platformId];
      if (ps?.running && !ps.needsAuth) return "bg-miwarp-status-success";
      if (ps?.running && ps.needsAuth) return "bg-miwarp-status-warning";
      return "bg-muted-foreground/30";
    }
    const hasCred = !!findCredential(platformCredentials, platformId)?.api_key;
    return hasCred ? "bg-miwarp-status-success" : "bg-miwarp-status-warning";
  });

  let loadingLabel = $derived.by(() => {
    if (authMode === "cli") return t("auth_cliAuth");
    if (authMode === "api") return t("auth_appApiKey");
    return "";
  });

  let triggerClass = $derived(
    variant === "hero"
      ? "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground"
      : "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-accent data-[state=open]:border-border/60 data-[state=open]:bg-accent",
  );

  function selectMode(mode: string) {
    if (mode !== "api") open = false;
    onAuthModeChange?.(mode);
  }

  function selectPlatform(id: string) {
    dbg("auth-badge", "selectPlatform", { id });
    open = false;
    onPlatformChange?.(id);
    if (authOverview?.auth_mode !== "api") {
      onAuthModeChange?.("api");
    }
  }
</script>

{#if hasRun && authSourceLabel}
  <span
    class="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium {badgeColor}"
    title={t("statusbar_authTitle", { source: apiKeySource })}
  >
    {authSourceLabel}
  </span>
{:else if !hasRun && authOverview}
  <MiPopover bind:open contentClass={MIWARP_MENU_PANEL_CLASS} sideOffset={4}>
    {#snippet trigger({ props })}
      <button
        {...props}
        type="button"
        class="{triggerClass} {props.class ?? ''}"
        title={t("auth_sourceLabel")}
      >
        <span class="inline-block h-1.5 w-1.5 rounded-full {preSessionDotColor}"></span>
        {preSessionLabel}
        <Icon
          name="chevron-down"
          size="xs"
          class="text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180"
        />
      </button>
    {/snippet}
    {#snippet children()}
      <div class="space-y-1 p-2">
        <p
          class="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60"
        >
          {t("settings_auth_modeLabel")}
        </p>

        <button
          type="button"
          class="flex w-full items-start gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors hover:bg-accent {authOverview.auth_mode ===
          'cli'
            ? 'bg-accent'
            : ''}"
          onclick={() => selectMode("cli")}
        >
          <span class="mt-0.5 inline-block h-3.5 w-3.5 shrink-0">
            {#if authOverview.auth_mode === "cli"}
              <svg
                class="h-3.5 w-3.5 text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" fill="currentColor" />
              </svg>
            {:else}
              <svg
                class="h-3.5 w-3.5 text-muted-foreground/50"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10" />
              </svg>
            {/if}
          </span>
          <div class="flex-1 text-left">
            <p class="text-xs font-medium">{t("auth_cliAuth")}</p>
            {#if authOverview.cli_login_available}
              <p class="text-[10px] text-miwarp-status-success">
                <span
                  class="mr-0.5 inline-block h-1 w-1 rounded-full bg-miwarp-status-success align-middle"
                ></span>
                {t("auth_loggedIn")}{authOverview.cli_login_account
                  ? `: ${authOverview.cli_login_account}`
                  : ""}
              </p>
            {:else}
              <p class="text-[10px] text-muted-foreground">
                <span
                  class="mr-0.5 inline-block h-1 w-1 rounded-full bg-muted-foreground/40 align-middle"
                ></span>
                {t("auth_notLoggedIn")}
              </p>
            {/if}
            {#if authOverview.cli_has_api_key}
              <p class="text-[10px] text-miwarp-status-success">
                <span
                  class="mr-0.5 inline-block h-1 w-1 rounded-full bg-miwarp-status-success align-middle"
                ></span>
                {t("auth_cliKeyHint", { hint: authOverview.cli_api_key_hint ?? "" })}
              </p>
            {/if}
            {#if authOverview.cli_login_available && authOverview.cli_has_api_key}
              <p class="mt-0.5 text-[10px] italic text-muted-foreground/70">
                {t("auth_cliPriorityHint")}
              </p>
            {/if}
          </div>
        </button>

        <div class="rounded-sm {authOverview.auth_mode === 'api' ? 'bg-accent' : ''}">
          <button
            type="button"
            class="flex w-full items-start gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors hover:bg-accent"
            onclick={() => selectMode("api")}
          >
            <span class="mt-0.5 inline-block h-3.5 w-3.5 shrink-0">
              {#if authOverview.auth_mode === "api"}
                <svg
                  class="h-3.5 w-3.5 text-primary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="10" /><circle
                    cx="12"
                    cy="12"
                    r="4"
                    fill="currentColor"
                  />
                </svg>
              {:else}
                <svg
                  class="h-3.5 w-3.5 text-muted-foreground/50"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="10" />
                </svg>
              {/if}
            </span>
            <div class="flex-1 text-left">
              <p class="text-xs font-medium">
                {t("auth_appApiKey")}
                {#if authOverview.app_platform_name}
                  <span class="font-normal text-muted-foreground">
                    [{authOverview.app_platform_name}]
                  </span>
                {/if}
              </p>
              {#if authOverview.app_has_credentials}
                <p class="text-[10px] text-miwarp-status-success">
                  <span
                    class="mr-0.5 inline-block h-1 w-1 rounded-full bg-miwarp-status-success align-middle"
                  ></span>
                  {t("auth_loggedIn")}
                </p>
              {:else}
                <p class="text-[10px] text-miwarp-status-warning">
                  <span
                    class="mr-0.5 inline-block h-1 w-1 rounded-full bg-miwarp-status-warning align-middle"
                  ></span>
                  {t("prompt_noPlatformKey")}
                </p>
              {/if}
            </div>
          </button>

          {#if authOverview.auth_mode === "api"}
            <div class="space-y-0.5 pb-2 pl-8">
              {#each groupedPlatforms as group (group.label)}
                <p
                  class="px-1 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {group.label}
                </p>
                {#each group.items as platform (platform.id)}
                  {@const isLocal = platform.category === "local"}
                  {@const lps = isLocal ? localProxyStatuses?.[platform.id] : undefined}
                  {@const hasCred = !!findCredential(platformCredentials, platform.id)?.api_key}
                  {@const isSelected = platform.id === platformId}
                  <button
                    type="button"
                    class="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs transition-colors hover:bg-accent/70"
                    onclick={() => selectPlatform(platform.id)}
                  >
                    <span
                      class="inline-block h-1 w-1 shrink-0 rounded-full {isLocal
                        ? lps?.running && !lps.needsAuth
                          ? 'bg-miwarp-status-success'
                          : lps?.running && lps.needsAuth
                            ? 'bg-miwarp-status-warning'
                            : 'bg-muted-foreground/30'
                        : hasCred
                          ? 'bg-miwarp-status-success'
                          : 'bg-muted-foreground/30'}"
                    ></span>
                    <span
                      class="min-w-0 flex-1 truncate text-left {isSelected
                        ? 'font-medium text-foreground'
                        : 'text-foreground/80'}">{platform.name}</span
                    >
                    {#if isSelected}
                      <Icon name="check" size="xs" class="shrink-0 text-primary" />
                    {/if}
                  </button>
                {/each}
              {/each}
            </div>
          {/if}
        </div>

        <button
          type="button"
          class="flex w-full items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onclick={() => {
            open = false;
            goto("/settings");
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
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
            />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {t("auth_configureInSettings")}
        </button>
      </div>
    {/snippet}
  </MiPopover>
{:else if !hasRun && loadingLabel}
  <span
    class="inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-muted-foreground/70"
  >
    <span class="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/30"></span>
    {loadingLabel}
  </span>
{/if}
