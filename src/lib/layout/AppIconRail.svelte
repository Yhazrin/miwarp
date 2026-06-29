<script lang="ts">
  import { goto } from "$app/navigation";
  import WindowDragArea from "$lib/components/WindowDragArea.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { NAV_ITEMS } from "$lib/layout/navigation-model";
  import { themeStore } from "$lib/stores/theme-store.svelte";
  import { beginRouteTransition, endRouteTransition } from "$lib/utils/route-transition";

  interface Props {
    currentPath: string;
    getNavItemHref: (item: { path: string; icon: string }) => string;
    attentionQueueBadgeCount: number;
    sidebarVersion: string;
    sidebarVersionChecked: boolean;
    sidebarUpdateAvailable: boolean;
    onShowAbout: () => void;
  }

  let {
    currentPath,
    getNavItemHref,
    attentionQueueBadgeCount,
    sidebarVersion,
    sidebarVersionChecked,
    sidebarUpdateAvailable,
    onShowAbout,
  }: Props = $props();

  /** Settings lives in the rail footer — exclude from the scrollable nav list. */
  const railNavItems = NAV_ITEMS.filter((item) => item.path !== "/settings");

  const themeMode = $derived(themeStore.mode);
  const themeIsDark = $derived(themeStore.isDark);

  const themeModeTitle = $derived(
    themeIsDark
      ? t("layout_themeTitle_dark")
      : themeMode === "system"
        ? t("layout_themeTitle_system", { default: t("layout_themeTitle_light") })
        : t("layout_themeTitle_light"),
  );
</script>

<div class="sidebar-icon-rail flex w-[44px] flex-col items-center">
  <div class="relative w-full shrink-0 h-[var(--miwarp-titlebar-band)]" aria-hidden="true">
    <WindowDragArea class="absolute inset-0" />
  </div>

  <nav class="flex flex-1 flex-col items-center gap-1 py-2 pt-2">
    {#each railNavItems as item, idx (item.path)}
      {#if idx > 0 && item.group !== railNavItems[idx - 1].group}
        <div class="my-1 h-px w-5 bg-border/40"></div>
      {/if}
      {@const isActive = currentPath.startsWith(item.path)}
      <a
        href={getNavItemHref(item)}
        class="relative flex h-9 w-9 items-center justify-center rounded-md transition-all duration-150 no-underline active:scale-95
                {isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'hover:bg-sidebar-accent/50 text-sidebar-foreground'}"
        title={item.label()}
      >
        {#if isActive}
          <span class="absolute left-0 top-1.5 h-5 w-[3px] rounded-r-full bg-primary"></span>
        {/if}
        {#if item.icon === "message"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg
          >
        {:else if item.icon === "folder"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path
              d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
            /></svg
          >
        {:else if item.icon === "layout"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path
              d="M9 21V9"
            /></svg
          >
        {:else if item.icon === "monitor"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path
              d="M12 17v4"
            /></svg
          >
        {:else if item.icon === "clock"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg
          >
        {:else if item.icon === "circle-user"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="12" r="10" /><circle cx="12" cy="10" r="3" /><path
              d="M7 20.66A8 8 0 0 1 12 18a8 8 0 0 1 5 2.66"
            /></svg
          >
        {:else if item.icon === "users"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle
              cx="9"
              cy="7"
              r="4"
            /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg
          >
        {:else if item.icon === "zap"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path
              d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
            /></svg
          >
        {:else if item.icon === "chart"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M3 3v18h18" /><path d="M7 16l4-4 4 4 5-7" /></svg
          >
        {:else if item.icon === "schedule"}
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg
          >
        {/if}
      </a>
    {/each}
  </nav>

  <div class="flex flex-col items-center gap-1 pb-2">
    {#if attentionQueueBadgeCount > 0}
      <span class="h-2 w-2 rounded-full bg-primary" title={String(attentionQueueBadgeCount)}></span>
    {/if}
    <button
      type="button"
      class="flex h-9 w-9 items-center justify-center rounded-md transition-colors cursor-pointer
              {sidebarUpdateAvailable
        ? 'text-miwarp-status-warning hover:text-[hsl(var(--miwarp-status-warning)/0.8)] hover:bg-[hsl(var(--miwarp-status-warning)/0.1)]'
        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
      title={sidebarUpdateAvailable
        ? t("sidebar_updateAvailableTitle", { version: sidebarVersion })
        : t("sidebar_updateCurrentTitle", { version: sidebarVersion })}
      onclick={onShowAbout}
      aria-label={t("settings_checkUpdate")}
    >
      {#if !sidebarVersionChecked}
        <svg class="h-3.5 w-3.5 animate-spin opacity-50" viewBox="0 0 24 24" fill="none">
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="3"
            stroke-dasharray="31.4"
            stroke-dashoffset="10"
            stroke-linecap="round"
          />
        </svg>
      {:else if sidebarUpdateAvailable}
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="16 12 12 8 8 12" />
          <line x1="12" y1="16" x2="12" y2="8" />
        </svg>
      {:else}
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      {/if}
    </button>
    <button
      type="button"
      class="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      title={t("nav_settings")}
      onclick={() => {
        beginRouteTransition();
        void goto("/settings").finally(endRouteTransition);
      }}
      aria-label={t("nav_settings")}
    >
      <svg
        class="h-[18px] w-[18px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path
          d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        /><circle cx="12" cy="12" r="3" /></svg
      >
    </button>
    <button
      type="button"
      class="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground active:scale-95"
      title={themeModeTitle}
      onclick={() => themeStore.cycleTheme()}
      aria-label={t("settings_toggleTheme")}
    >
      {#if themeMode === "system"}
        <!-- 昼夜拼接：上半月（昼）+ 下半月（夜），外圈 + 水平分隔线区分。
             跟 macOS System Settings / VS Code / GitHub 的 "Auto appearance" 同一 pattern。 -->
        <svg
          class="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <!-- sun: small disc + 4 short rays, upper half -->
          <circle cx="9.5" cy="6.5" r="1.6" fill="currentColor" stroke="none" />
          <line x1="9.5" y1="3" x2="9.5" y2="4.4" />
          <line x1="6.4" y1="6.5" x2="7.8" y2="6.5" />
          <line x1="7.2" y1="4.2" x2="8.2" y2="5.2" />
          <!-- moon: crescent, lower half -->
          <path
            d="M16 16.2 a4 4 0 1 0 0 4.6 a3 3 0 0 1 0 -4.6 z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      {:else if themeIsDark}
        <svg
          class="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg
        >
      {:else}
        <svg
          class="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><circle cx="12" cy="12" r="4" /><path
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
          /></svg
        >
      {/if}
    </button>
  </div>
</div>
