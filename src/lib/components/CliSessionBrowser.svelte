<script lang="ts">
  import { onMount } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { getTransport } from "$lib/transport";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { fmtRelative } from "$lib/i18n/format";
  import { cwdDisplayLabel } from "$lib/utils/format";
  import Icon from "$lib/components/Icon.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import type { CliSessionSummary, DiscoverResult, ImportResult, SyncResult } from "$lib/types";

  function invoke<T>(
    cmd: string,
    args: Record<string, unknown> | undefined = undefined,
  ): Promise<T> {
    return getTransport().invoke<T>(cmd, args);
  }

  let {
    cwd,
    onclose,
    onimported,
  }: {
    cwd: string;
    onclose: () => void;
    onimported: (runId: string) => void;
  } = $props();

  let sessions: CliSessionSummary[] = $state([]);
  let totalSessions = $state(0);
  let truncated = $state(false);
  let loading = $state(true);
  let searchQuery = $state("");
  let importingId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let warning = $state<string | null>(null);
  let importingAll = $state(false);
  let dialogEl: HTMLDivElement | undefined = $state();

  const isShowAll = $derived(!cwd || cwd === "/");
  let selectedProject = $state<string | null>(null);

  const projects = $derived.by(() => {
    const cwdMap = new Map<string, number>();
    for (const s of sessions) {
      if (s.cwd) {
        cwdMap.set(s.cwd, (cwdMap.get(s.cwd) ?? 0) + 1);
      }
    }
    return Array.from(cwdMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([path, count]) => ({ path, label: cwdDisplayLabel(path), count }));
  });

  const filtered = $derived.by(() => {
    let list = sessions;
    if (selectedProject) {
      list = list.filter((s) => s.cwd === selectedProject);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.firstPrompt.toLowerCase().includes(q) ||
          (s.model ?? "").toLowerCase().includes(q) ||
          (s.cwd ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  });

  const newCount = $derived(filtered.filter((s) => !s.alreadyImported).length);
  const importedCount = $derived(filtered.filter((s) => s.alreadyImported).length);

  const subtitleText = $derived.by(() => {
    if (isShowAll) {
      if (truncated) {
        return t("cliSync_foundTruncated", {
          shown: String(sessions.length),
          total: String(totalSessions),
        });
      }
      return `${t("cliSync_allProjects")} · ${t("cliSync_found", { count: String(sessions.length) })}`;
    }
    return `${cwdDisplayLabel(cwd)} · ${t("cliSync_found", { count: String(sessions.length) })}`;
  });

  function importCwd(session: CliSessionSummary): string {
    return session.cwd || cwd;
  }

  onMount(() => {
    discoverSessions();
    dialogEl?.focus();
  });

  async function discoverSessions() {
    loading = true;
    error = null;
    dbg("cli-browser", "discovering sessions", { cwd });
    try {
      const result = await invoke<DiscoverResult>("discover_cli_sessions", { cwd });
      sessions = result.sessions;
      totalSessions = result.total;
      truncated = result.truncated;
      dbg("cli-browser", "discovered", {
        count: sessions.length,
        total: totalSessions,
        truncated,
      });
    } catch (e) {
      const msg = String(e);
      dbgWarn("cli-browser", "discover failed", msg);
      error = msg;
    } finally {
      loading = false;
    }
  }

  async function importSession(session: CliSessionSummary) {
    if (importingId) return;
    importingId = session.sessionId;
    error = null;
    warning = null;
    const sessionCwd = importCwd(session);
    dbg("cli-browser", "importing session", { sessionId: session.sessionId, cwd: sessionCwd });
    try {
      const result = await invoke<ImportResult>("import_cli_session", {
        sessionId: session.sessionId,
        cwd: sessionCwd,
      });
      dbg("cli-browser", "import success", { runId: result.runId, events: result.eventsImported });
      if (result.usageIncomplete) {
        warning = t("cliSync_usageIncomplete");
      }
      await discoverSessions();
      onimported(result.runId);
    } catch (e) {
      const msg = String(e);
      dbgWarn("cli-browser", "import failed", msg);
      error = msg;
    } finally {
      importingId = null;
    }
  }

  async function syncSession(runId: string) {
    importingId = runId;
    error = null;
    warning = null;
    dbg("cli-browser", "syncing session", { runId });
    try {
      const result = await invoke<SyncResult>("sync_cli_session", { runId });
      dbg("cli-browser", "sync success", { newEvents: result.newEvents });
      if (result.usageIncomplete) {
        warning = t("cliSync_usageIncomplete");
      }
      await discoverSessions();
    } catch (e) {
      const msg = String(e);
      dbgWarn("cli-browser", "sync failed", msg);
      error = msg;
    } finally {
      importingId = null;
    }
  }

  async function importAllNew() {
    const newSessions = filtered.filter((s) => !s.alreadyImported);
    if (newSessions.length === 0) return;
    importingAll = true;
    error = null;
    warning = null;
    dbg("cli-browser", "importing all new", { count: newSessions.length });
    let lastRunId: string | null = null;
    let importedCountLocal = 0;
    try {
      for (const s of newSessions) {
        importingId = s.sessionId;
        const sessionCwd = importCwd(s);
        const result = await invoke<ImportResult>("import_cli_session", {
          sessionId: s.sessionId,
          cwd: sessionCwd,
        });
        dbg("cli-browser", "imported", { sessionId: s.sessionId, runId: result.runId });
        lastRunId = result.runId;
        importedCountLocal++;
        if (result.usageIncomplete) {
          warning = t("cliSync_usageIncomplete");
        }
      }
      await discoverSessions();
      if (lastRunId) {
        dbg("cli-browser", "import-all done, navigating", { importedCountLocal, lastRunId });
        onimported(lastRunId);
      }
    } catch (e) {
      const msg = String(e);
      dbgWarn("cli-browser", "import-all failed", msg);
      error = msg;
      await discoverSessions().catch((e) => dbgWarn("cli-browser", "fallback discover failed:", e));
    } finally {
      importingId = null;
      importingAll = false;
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleBackdropClick() {
    onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }

  const filterPillBase =
    "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all duration-150";
  const filterPillActive =
    "bg-primary/15 text-primary ring-1 ring-primary/25 shadow-[inset_0_1px_0_hsl(var(--miwarp-glass-border)/0.12)]";
  const filterPillIdle =
    "text-muted-foreground hover:bg-muted/60 hover:text-foreground ring-1 ring-transparent";

  const actionGhost =
    "rounded-lg border border-[hsl(var(--miwarp-glass-border)/0.2)] bg-[hsl(var(--miwarp-bg-elevated)/0.35)] px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-[hsl(var(--miwarp-glass-border)/0.35)] hover:bg-[hsl(var(--miwarp-bg-elevated)/0.55)] disabled:opacity-50";
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
  role="dialog"
  aria-modal="true"
  aria-labelledby="cli-sync-title"
  tabindex="-1"
  bind:this={dialogEl}
  onkeydown={handleKeydown}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-miwarp-overlay backdrop-blur-md"
    transition:fade={{ duration: 200 }}
    onclick={handleBackdropClick}
    onkeydown={(e) => {
      if (e.key === "Escape") onclose();
    }}
  ></div>

  <div
    class="relative z-10 flex max-h-[min(82vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[hsl(var(--miwarp-glass-border)/0.28)] shadow-[inset_0_1px_0_hsl(var(--miwarp-glass-border)/0.12)] backdrop-blur-2xl"
    style="background: hsl(var(--miwarp-bg-deep) / 0.94);"
    transition:fly={{ y: 12, duration: 220 }}
  >
    <!-- Header -->
    <div
      class="shrink-0 border-b border-[hsl(var(--miwarp-glass-border)/0.15)] bg-[hsl(var(--miwarp-bg-elevated)/0.25)] px-5 py-4"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20"
            aria-hidden="true"
          >
            <svg
              class="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path
                d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
              />
            </svg>
          </div>
          <div class="min-w-0">
            <h2
              id="cli-sync-title"
              class="text-[15px] font-semibold tracking-tight text-foreground"
            >
              {t("cliSync_title")}
            </h2>
            <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">{subtitleText}</p>
            {#if !loading && sessions.length > 0}
              <div class="mt-2 flex flex-wrap items-center gap-1.5">
                {#if newCount > 0}
                  <span
                    class="inline-flex items-center rounded-full bg-miwarp-status-info/12 px-2 py-0.5 text-[10px] font-medium tabular-nums text-miwarp-status-info ring-1 ring-miwarp-status-info/20"
                    title={t("cliSync_importAll", { count: String(newCount) })}
                  >
                    {newCount} · {t("cliSync_import")}
                  </span>
                {/if}
                {#if importedCount > 0}
                  <span
                    class="inline-flex items-center rounded-full bg-miwarp-status-success/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-miwarp-status-success ring-1 ring-miwarp-status-success/20"
                    title={t("cliSync_alreadyImported")}
                  >
                    {importedCount}
                  </span>
                {/if}
              </div>
            {/if}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40"
            onclick={() => discoverSessions()}
            disabled={loading}
            title={t("sidebar_refresh")}
            aria-label={t("sidebar_refresh")}
          >
            <Icon name="refresh-cw" size="sm" class={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            onclick={onclose}
            aria-label={t("common_close")}
          >
            <Icon name="x" size="md" />
          </button>
        </div>
      </div>

      {#if isShowAll && projects.length > 1}
        <div class="mt-3.5 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          <button
            type="button"
            class="{filterPillBase} {selectedProject === null ? filterPillActive : filterPillIdle}"
            onclick={() => (selectedProject = null)}
          >
            {t("cliSync_filterAll")} ({sessions.length})
          </button>
          {#each projects as proj (proj.path)}
            <button
              type="button"
              class="{filterPillBase} {selectedProject === proj.path
                ? filterPillActive
                : filterPillIdle}"
              onclick={() => (selectedProject = proj.path)}
              title={proj.path}
            >
              {proj.label} ({proj.count})
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Search -->
    <div class="shrink-0 border-b border-[hsl(var(--miwarp-glass-border)/0.12)] px-5 py-3">
      <div class="relative">
        <Icon
          name="search"
          class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70"
        />
        <input
          type="search"
          bind:value={searchQuery}
          placeholder={t("cliSync_searchPlaceholder")}
          onkeydown={(e) => {
            if (e.key === "Escape") searchQuery = "";
          }}
          class="w-full rounded-full border border-[hsl(var(--miwarp-glass-border)/0.2)] bg-[hsl(var(--miwarp-bg-elevated)/0.4)] py-2 pl-10 pr-9 text-sm text-foreground placeholder:text-muted-foreground/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
        {#if searchQuery}
          <button
            type="button"
            class="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground"
            onclick={() => (searchQuery = "")}
            aria-label={t("common_clear")}
          >
            <Icon name="x" size="xs" />
          </button>
        {/if}
      </div>
    </div>

    <!-- Session list -->
    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-3">
      {#if loading}
        <div class="flex flex-col items-center justify-center gap-3 py-16">
          <Spinner size="md" />
          <p class="text-xs text-muted-foreground">{t("common_loading")}</p>
        </div>
      {:else if error && sessions.length === 0}
        <EmptyState title={error} class="py-14 text-destructive">
          {#snippet iconComponent()}
            <div
              class="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/20"
            >
              <Icon name="triangle-alert" size="lg" />
            </div>
          {/snippet}
        </EmptyState>
      {:else if filtered.length === 0}
        <EmptyState title={t("cliSync_noSessions")} class="py-14">
          {#snippet iconComponent()}
            <div
              class="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground ring-1 ring-[hsl(var(--miwarp-glass-border)/0.15)]"
            >
              <Icon name="folder" size="lg" />
            </div>
          {/snippet}
        </EmptyState>
      {:else}
        <ul class="flex flex-col gap-2" role="list">
          {#each filtered as session (session.sessionId)}
            {@const isImporting = importingId === session.sessionId}
            {@const isImported = session.alreadyImported}
            <li>
              <article
                class="group rounded-xl border border-[hsl(var(--miwarp-glass-border)/0.18)] bg-[hsl(var(--miwarp-bg-elevated)/0.32)] p-3.5 transition-all duration-150 hover:border-[hsl(var(--miwarp-glass-border)/0.32)] hover:bg-[hsl(var(--miwarp-bg-elevated)/0.48)] hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)]"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="text-[11px] tabular-nums text-muted-foreground">
                        {fmtRelative(session.lastActivityAt)}
                      </span>
                      {#if isShowAll && !selectedProject && session.cwd}
                        <span
                          class="max-w-[160px] truncate rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          title={session.cwd}
                        >
                          {cwdDisplayLabel(session.cwd)}
                        </span>
                      {/if}
                      {#if session.model}
                        <span
                          class="ml-auto max-w-[120px] truncate rounded-md bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary/90"
                        >
                          {session.model}
                        </span>
                      {/if}
                    </div>
                    <p class="mt-1.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">
                      {session.firstPrompt || "\u2014"}
                    </p>
                    <div
                      class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground"
                    >
                      <span>{t("cliSync_messages", { count: String(session.messageCount) })}</span>
                      <span class="opacity-40" aria-hidden="true">·</span>
                      <span>{formatSize(session.fileSize)}</span>
                      {#if session.hasSubagents}
                        <span class="opacity-40" aria-hidden="true">·</span>
                        <span>{t("cliSync_subagents")}</span>
                      {/if}
                      {#if isImported && session.existingRunId}
                        <span class="opacity-40" aria-hidden="true">·</span>
                        <span class="font-medium text-miwarp-status-success">
                          {t("cliSync_alreadyImported")}
                        </span>
                      {/if}
                    </div>
                  </div>

                  <div
                    class="flex shrink-0 items-center gap-1 pt-0.5 opacity-95 transition-opacity group-hover:opacity-100"
                  >
                    {#if isImported && session.existingRunId}
                      <button
                        type="button"
                        class={actionGhost}
                        onclick={() => syncSession(session.existingRunId!)}
                        disabled={!!importingId}
                      >
                        {#if importingId === session.existingRunId}
                          <Spinner size="xs" />
                        {:else}
                          {t("cliSync_sync")}
                        {/if}
                      </button>
                      <button
                        type="button"
                        class="rounded-lg bg-primary/90 px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary disabled:opacity-50"
                        onclick={() => onimported(session.existingRunId!)}
                      >
                        {t("cliSync_open")}
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.5)] transition-colors hover:bg-primary/90 disabled:opacity-50"
                        onclick={() => importSession(session)}
                        disabled={!!importingId}
                      >
                        {#if isImporting}
                          <Spinner
                            size="xs"
                            class="border-primary-foreground/30 border-t-primary-foreground"
                          />
                        {:else}
                          {t("cliSync_import")}
                        {/if}
                      </button>
                    {/if}
                  </div>
                </div>
              </article>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Footer -->
    {#if !loading && filtered.length > 0}
      <div
        class="flex shrink-0 items-center justify-between gap-3 border-t border-[hsl(var(--miwarp-glass-border)/0.15)] bg-[hsl(var(--miwarp-bg-elevated)/0.2)] px-5 py-3"
      >
        {#if error}
          <p class="min-w-0 flex-1 truncate text-xs text-destructive">{error}</p>
        {:else if warning}
          <p class="min-w-0 flex-1 truncate text-xs text-miwarp-status-warning">{warning}</p>
        {:else}
          <p class="text-xs text-muted-foreground/70">
            {t("cliSync_found", { count: String(filtered.length) })}
          </p>
        {/if}
        {#if newCount > 0}
          <button
            type="button"
            class="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.55)] transition-colors hover:bg-primary/90 disabled:opacity-50"
            onclick={importAllNew}
            disabled={!!importingId || importingAll}
          >
            {#if importingAll}
              <span class="flex items-center gap-2">
                <Spinner
                  size="sm"
                  class="border-primary-foreground/30 border-t-primary-foreground"
                />
                {t("cliSync_importing")}
              </span>
            {:else}
              {t("cliSync_importAll", { count: String(newCount) })}
            {/if}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
