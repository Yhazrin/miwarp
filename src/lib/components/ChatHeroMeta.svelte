<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { dbg } from "$lib/utils/debug";
  import Icon from "$lib/components/Icon.svelte";
  import type { RemoteHost } from "$lib/types";

  interface Props {
    cliVersionInfo: { installed?: string } | null | undefined;
    channelLatest: string | undefined;
    remoteHosts: RemoteHost[];
    currentRemoteHostName: string | null;
    onTargetChange: (hostName: string | null) => void;
    onNavigate: (path: string) => void;
  }

  let {
    cliVersionInfo,
    channelLatest,
    remoteHosts,
    currentRemoteHostName,
    onTargetChange,
    onNavigate,
  }: Props = $props();

  let targetDropdownOpen = $state(false);

  let hasUpdate = $derived(
    !!(cliVersionInfo?.installed && channelLatest && cliVersionInfo.installed !== channelLatest),
  );
</script>

{#if cliVersionInfo?.installed}
  <button
    class="tabular-nums hover:text-muted-foreground transition-colors"
    onclick={() => onNavigate("/release-notes")}
  >
    {t("chat_cliVersion").replace("{version}", cliVersionInfo.installed)}
  </button>
  {#if hasUpdate}
    <span class="text-primary/70">·</span>
    <button
      class="text-primary/70 hover:text-primary transition-colors"
      onclick={() => onNavigate("/release-notes")}
      title={t("chat_cliUpdateAvailable").replace("{version}", channelLatest!)}
    >
      {t("chat_cliUpdateAvailable").replace("{version}", channelLatest!)}
    </button>
  {/if}
{/if}
{#if remoteHosts.length > 0}
  {#if cliVersionInfo?.installed}
    <span class="text-muted-foreground">·</span>
  {/if}
  <div class="relative inline-flex items-center">
    {#if targetDropdownOpen}
      <!-- Invisible backdrop to close dropdown on outside click -->
      <div
        class="fixed inset-0 z-40"
        role="presentation"
        onclick={() => (targetDropdownOpen = false)}
      ></div>
    {/if}
    <button
      class="inline-flex items-center gap-1 cursor-pointer text-xs {currentRemoteHostName
        ? 'text-[hsl(var(--miwarp-status-info)/0.7)] hover:text-miwarp-status-info'
        : 'text-muted-foreground hover:text-foreground'} transition-colors"
      onclick={() => (targetDropdownOpen = !targetDropdownOpen)}
    >
      <svg
        class="h-3 w-3 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect width="20" height="14" x="2" y="3" rx="2" /><line
          x1="8"
          y1="21"
          x2="16"
          y2="21"
        /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <span>{currentRemoteHostName || t("chat_local")}</span>
      <Icon name="chevron-down" size="xs" class="opacity-60" />
    </button>
    {#if targetDropdownOpen}
      <div
        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded-md border border-border bg-popover py-1 shadow-md z-50"
      >
        <button
          class="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs {!currentRemoteHostName
            ? 'text-foreground font-medium'
            : 'text-foreground/70 hover:bg-accent'} transition-colors"
          onclick={() => {
            onTargetChange(null);
            dbg("chat", "target changed", "local");
            targetDropdownOpen = false;
          }}
        >
          {t("chat_local")}
        </button>
        {#each remoteHosts as host (host.name)}
          <button
            class="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs {currentRemoteHostName ===
            host.name
              ? 'text-foreground font-medium'
              : 'text-foreground/70 hover:bg-accent'} transition-colors"
            onclick={() => {
              onTargetChange(host.name);
              dbg("chat", "target changed", host.name);
              targetDropdownOpen = false;
            }}
          >
            {host.name} ({host.user}@{host.host})
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
