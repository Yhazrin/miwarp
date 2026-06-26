<script lang="ts">
  /**
   * Provider Connections — surfaces platform credentials + the active
   * platform id from UserSettings, and links to the providers tab in /settings.
   * Pure read-only summary; editing lives in the providers settings tab.
   */
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { UserSettings, PlatformCredential } from "$lib/types";
  import Icon from "$lib/components/Icon.svelte";
  import PersonalSection from "./PersonalSection.svelte";

  let { settings }: { settings: UserSettings } = $props();

  function lk(key: string, params?: Record<string, string>): string {
    return t(key as MessageKey, params);
  }

  const credentials = $derived(settings.platform_credentials ?? []);
  const activeId = $derived(settings.active_platform_id ?? "");
  const activeCred = $derived<PlatformCredential | undefined>(
    activeId ? credentials.find((c) => c.platform_id === activeId) : undefined,
  );
</script>

<PersonalSection
  icon="plug"
  eyebrow={lk("personal_section_providers_eyebrow")}
  title={lk("personal_section_providers_title")}
  description={lk("personal_section_providers_desc")}
>
  {#snippet action()}
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onclick={() => goto("/settings?tab=providers")}
    >
      {lk("personal_openProviders")}
      <Icon name="external-link" size="xs" />
    </button>
  {/snippet}

  {#if credentials.length === 0}
    <div class="rounded-lg border border-dashed border-border/60 p-4 text-center">
      <p class="text-sm text-muted-foreground">{lk("personal_providers_empty")}</p>
    </div>
  {:else}
    <ul class="space-y-1.5">
      {#each credentials as cred (cred.platform_id)}
        <li
          class="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/40 px-3 py-2"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-foreground">{cred.platform_id}</span>
              {#if cred.platform_id === activeId}
                <span
                  class="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary"
                >
                  {lk("personal_providers_active")}
                </span>
              {/if}
            </div>
            {#if cred.base_url}
              <p class="truncate text-xs text-muted-foreground">{cred.base_url}</p>
            {/if}
          </div>
          {#if cred.api_key}
            <Icon name="check" size="sm" class="text-emerald-500" />
          {:else}
            <Icon name="triangle-alert" size="sm" class="text-amber-500" />
          {/if}
        </li>
      {/each}
    </ul>
    {#if activeCred}
      <p class="text-xs text-muted-foreground/80">
        {lk("personal_providers_activeHint", { id: activeCred.platform_id })}
      </p>
    {/if}
  {/if}
</PersonalSection>
