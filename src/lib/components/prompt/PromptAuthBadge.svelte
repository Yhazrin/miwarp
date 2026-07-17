<script lang="ts">
  import type { AuthOverview, PlatformCredential } from "$lib/types";

  let {
    authOverview: _authOverview,
    authSourceLabel,
    authSourceCategory: _authSourceCategory,
    apiKeySource: _apiKeySource,
    hasRun: _hasRun = false,
    authMode: _authMode,
    platformCredentials: _platformCredentials,
    platformId: _platformId,
    onAuthModeChange: _onAuthModeChange,
    onPlatformChange: _onPlatformChange,
    localProxyStatuses: _localProxyStatuses,
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
    onPlatformChange?: (id: string) => void;
    localProxyStatuses?: Record<string, { running: boolean; needsAuth: boolean }>;
  } = $props();
</script>

{#if authSourceLabel}
  <span class="rounded bg-miwarp-bg-secondary px-1.5 py-0.5 text-[10px] text-miwarp-text-secondary">
    {authSourceLabel}
  </span>
{/if}
