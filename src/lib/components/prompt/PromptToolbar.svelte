<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import AgentSelector from "./AgentSelector.svelte";
  import AuthSourceBadge from "./AuthSourceBadge.svelte";
  import PermissionModePicker from "$lib/components/PermissionModePicker.svelte";
  import { IS_MAC } from "$lib/utils/platform";
  import { t } from "$lib/i18n/index.svelte";
  import * as api from "$lib/api";
  import type {
    AuthOverview,
    PlatformCredential,
  } from "$lib/types";

  let {
    // Left toolbar props
    compact = false,
    hasRun = false,
    agent = "claude",
    onAgentChange,
    showPermissionModeButton = true,
    permissionMode = "",
    onPermissionModeChange,
    fastModeState = "",
    onFastModeSwitch,
    showAuthBadge = true,
    authOverview = null as AuthOverview | null,
    authSourceLabel = "",
    authSourceCategory = "unknown",
    apiKeySource = "",
    authMode = "cli",
    platformCredentials = [] as PlatformCredential[],
    platformId = "anthropic",
    onPlatformChange,
    onAuthModeChange,
    localProxyStatuses = {} as Record<string, { running: boolean; needsAuth: boolean }>,
    hasStash = false,
    onRestoreStash,

    // Right toolbar props
    showTokenEstimateUi = false,
    tokenWarning = false,
    tokenEstimate = 0,
    tokenPercent = 0,
    contextWindow = 0,
    slashEnabled = false,
    slashBtnEl = $bindable<HTMLButtonElement | undefined>(undefined),
    openSlashMenuFromButton,
    fileInput = $bindable<HTMLInputElement | undefined>(undefined),
    handleFileSelect,
    pendingAttachmentCount = 0,
    running = false,
    onInterrupt,
    canSend = false,
    btwMode = false,
    onBtwSend,
    handleBtwSend,
    handleSend,
    onToggleBtwMode,
  }: {
    compact?: boolean;
    hasRun?: boolean;
    agent?: string;
    onAgentChange?: (agent: string) => void;
    showPermissionModeButton?: boolean;
    permissionMode?: string;
    onPermissionModeChange?: (mode: string) => void;
    fastModeState?: string;
    onFastModeSwitch?: (mode: "on" | "off") => void;
    showAuthBadge?: boolean;
    authOverview?: AuthOverview | null;
    authSourceLabel?: string;
    authSourceCategory?: string;
    apiKeySource?: string;
    authMode?: string;
    platformCredentials?: PlatformCredential[];
    platformId?: string;
    onPlatformChange?: (platformId: string) => void;
    onAuthModeChange?: (mode: string) => void;
    localProxyStatuses?: Record<string, { running: boolean; needsAuth: boolean }>;
    hasStash?: boolean;
    onRestoreStash?: () => void;
    showTokenEstimateUi?: boolean;
    tokenWarning?: boolean;
    tokenEstimate?: number;
    tokenPercent?: number;
    contextWindow?: number;
    slashEnabled?: boolean;
    slashBtnEl?: HTMLButtonElement;
    openSlashMenuFromButton?: () => void;
    fileInput?: HTMLInputElement;
    handleFileSelect?: (e: Event) => void;
    pendingAttachmentCount?: number;
    running?: boolean;
    onInterrupt?: () => void;
    canSend?: boolean;
    btwMode?: boolean;
    onBtwSend?: () => void;
    handleBtwSend?: () => void;
    handleSend?: () => void;
    onToggleBtwMode?: () => void;
  } = $props();
</script>

<!-- Left toolbar items -->
{#if !hasRun && onAgentChange}
  <AgentSelector value={agent} onchange={(a) => onAgentChange?.(a)} />
{/if}
{#if showPermissionModeButton && onPermissionModeChange}
  <PermissionModePicker
    {permissionMode}
    onchange={onPermissionModeChange}
    variant="input"
    placement="above"
  />
{:else if !hasRun}
  <div class="w-1"></div>
{/if}
{#if fastModeState === "on" || fastModeState === "ultracode"}
  <button
    type="button"
    class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider
      bg-[hsl(var(--miwarp-status-info)/0.15)] text-miwarp-status-info
      hover:bg-[hsl(var(--miwarp-status-info)/0.25)] transition-colors
      motion-running-pulse"
    title={t("prompt_fastModeActive")}
    onclick={() => onFastModeSwitch?.("off")}
  >
    <Icon name="zap" size="xs" class="shrink-0" />
    {#if !compact}
      <span>fast</span>
    {/if}
  </button>
{/if}
{#if showAuthBadge && !hasRun && !compact}
  <AuthSourceBadge
    {authOverview}
    {authSourceLabel}
    {authSourceCategory}
    {apiKeySource}
    {hasRun}
    {authMode}
    {platformCredentials}
    {platformId}
    {onAuthModeChange}
    {onPlatformChange}
    {localProxyStatuses}
  />
{/if}
{#if hasStash && onRestoreStash}
  <button
    type="button"
    class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[hsl(var(--miwarp-accent-violet)/0.15)] text-miwarp-accent-violet hover:bg-[hsl(var(--miwarp-accent-violet)/0.25)] transition-colors"
    title={t("prompt_stashRestore")}
    onclick={onRestoreStash}
  >
    <Icon name="refresh-cw" size="xs" />
    {#if !compact}
      {t("prompt_stashBadge")}
    {/if}
  </button>
{/if}

<!-- Divider -->
<div class="w-px h-4 bg-border/30 mx-0.5 shrink-0"></div>

<!-- Right toolbar items -->
{#if showTokenEstimateUi && !compact}
  <span
    class="text-[10px] tabular-nums px-1.5 shrink-0 {tokenWarning
      ? 'text-miwarp-status-warning'
      : 'text-muted-foreground/50'}"
    title={contextWindow > 0 ? t("prompt_tokenPercent", { pct: String(tokenPercent) }) : ""}
  >
    {t("prompt_tokenEstimate", { tokens: String(tokenEstimate) })}
    {#if contextWindow > 0}<span class="ml-0.5"
        >{t("prompt_tokenPercent", { pct: String(tokenPercent) })}</span
      >{/if}
    {#if tokenWarning}<Icon
        name="triangle-alert"
        size="xs"
        class="ml-0.5 inline text-miwarp-status-warning"
      />{/if}
  </span>
{/if}
{#if slashEnabled}
  <button
    type="button"
    bind:this={slashBtnEl}
    class="flex h-7 w-7 items-center justify-center rounded-full
      text-muted-foreground/60 hover:text-foreground hover:bg-accent/15 transition-colors"
    onclick={openSlashMenuFromButton}
    title={t("prompt_slashCommands")}
    aria-label={t("prompt_slashCommands")}
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
      <path d="M17 3 7 21" />
    </svg>
  </button>
{/if}
<input
  bind:this={fileInput}
  type="file"
  multiple
  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.rs,.svelte,.html,.css,.yaml,.yml,.toml,.xml,.sh,.sql,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.csv,.log,.docx,.xlsx"
  class="hidden"
  onchange={handleFileSelect}
/>
<button
  type="button"
  class="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-accent/15 transition-colors disabled:opacity-30"
  onclick={() => fileInput?.click()}
  disabled={pendingAttachmentCount >= 8}
  title={t("prompt_attachFiles")}
  aria-label={t("prompt_attachFiles")}
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
    <path
      d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
    />
  </svg>
</button>
{#if IS_MAC && !compact}
  <button
    type="button"
    class="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-accent/15 transition-colors disabled:opacity-30"
    onclick={() => api.captureScreenshot()}
    disabled={pendingAttachmentCount >= 8}
    title={t("prompt_screenshot")}
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
      <path
        d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
      />
      <circle cx="12" cy="13" r="3" />
    </svg>
  </button>
{/if}

{#if running && onInterrupt}
  {#if canSend}
    {@render sendButton(btwMode)}
  {/if}
  {#if onBtwSend}
    <button
      type="button"
      onclick={() => onToggleBtwMode?.()}
      title={t("promptInput_sideQuestion")}
      class="flex h-7 w-7 items-center justify-center rounded-full transition-colors {btwMode
        ? 'text-miwarp-status-info bg-miwarp-status-info/10'
        : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/15'}"
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
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </svg>
    </button>
  {/if}
  <button
    type="button"
    class="flex h-7 w-7 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
    onclick={onInterrupt}
    title={t("prompt_stop")}
  >
    <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  </button>
{:else}
  {@render sendButton(false)}
{/if}

{#snippet sendButton(btw: boolean)}
  {@const sendSizeClass = "h-7 w-7"}
  {@const sendIconSize = "sm"}
  {@const sendLookClass = canSend
    ? btw
      ? "bg-miwarp-status-info text-miwarp-accent-on-accent hover:opacity-90"
      : "bg-primary text-primary-foreground hover:bg-primary/90"
    : "bg-primary text-primary-foreground opacity-45 cursor-not-allowed"}
  <button
    type="button"
    class="flex shrink-0 items-center justify-center rounded-full transition-[opacity,background-color] duration-200 {sendSizeClass} {sendLookClass}"
    onclick={btw ? handleBtwSend : handleSend}
    disabled={!canSend}
    title={btw ? t("promptInput_sendSideQuestion") : t("prompt_send")}
    aria-label={btw ? t("promptInput_sendSideQuestion") : t("prompt_send")}
  >
    <Icon name="arrow-right" size={sendIconSize} />
  </button>
{/snippet}
