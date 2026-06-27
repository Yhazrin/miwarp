<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { t } from "$lib/i18n/index.svelte";
  import {
    LEGACY_TAB_MAP,
    SETTINGS_NAV_GROUPS,
    SETTINGS_TABS,
    type SettingsTabId,
    resolveTabId,
  } from "$lib/components/settings/tabs/registry";

  const settingsNavGroups = SETTINGS_NAV_GROUPS.map((g) => ({
    label: () => t(g.labelKey as Parameters<typeof t>[0]) ?? g.fallbackLabel,
    tabs: SETTINGS_TABS.filter((tab) => tab.groupId === g.id),
  }));

  const NEW_TO_LEGACY: Record<string, string> = Object.fromEntries(
    Object.entries(LEGACY_TAB_MAP).map(([legacy, next]) => [next, legacy]),
  ) as Record<string, string>;

  const activeTab = $derived(resolveTabId($page.url.searchParams.get("tab")));

  function legacyTabId(id: SettingsTabId): string {
    return NEW_TO_LEGACY[id] ?? id;
  }

  function setActiveTab(tabId: SettingsTabId) {
    const url = new URL($page.url);
    url.searchParams.set("tab", legacyTabId(tabId));
    void goto(`${url.pathname}?${url.searchParams.toString()}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });
  }
</script>

<nav class="sidebar-scroll flex flex-1 flex-col gap-5 overflow-y-auto px-2.5 pb-4 pt-4">
  {#each settingsNavGroups as group (group.label())}
    <section class="flex flex-col gap-1.5">
      <p class="px-2 text-[11px] font-medium leading-none text-sidebar-foreground/60">
        {group.label()}
      </p>
      <div class="flex flex-col gap-0.5">
        {#each group.tabs as tab (tab.id)}
          <button
            type="button"
            data-active={activeTab === tab.id ? "true" : undefined}
            class="flex min-h-[32px] w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors
              {activeTab === tab.id
              ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
              : 'font-normal text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
            onclick={() => setActiveTab(tab.id)}
          >
            <svg
              class="h-3.5 w-3.5 shrink-0 opacity-80"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d={tab.iconPath} />
            </svg>
            <span class="min-w-0 truncate"
              >{t(tab.labelKey as Parameters<typeof t>[0]) ?? tab.fallbackLabel}</span
            >
          </button>
        {/each}
      </div>
    </section>
  {/each}
</nav>
