<script lang="ts">
  /**
   * PermissionPanel: pure projection of the coordinator's state. No
   * race-prone busy flags; each row's `state` comes from the
   * coordinator. Stale / cancelled / failed rows show a typed message
   * + Retry (when retryable) instead of allowing further input.
   *
   * The panel owns presentation; the coordinator owns lifecycle.
   */
  import type { BusToolItem, PermissionSuggestion } from "$lib/types";
  import { getToolColor } from "$lib/utils/tool-colors";
  import { getToolDetail, formatSuggestionLabel } from "$lib/utils/tool-rendering";
  import { isAbsolutePath } from "$lib/utils/format";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import type {
    PermissionCoordinator,
    PermissionDecision,
    PermissionEvent,
    PermissionSnapshot,
  } from "$lib/chat/permission-coordinator";

  type PendingItem = { tool: BusToolItem; requestId: string };

  let {
    pendingTools,
    onPermissionRespond,
    onRetry,
    coordinator,
  }: {
    pendingTools: PendingItem[];
    onPermissionRespond: (
      requestId: string,
      behavior: "allow" | "deny",
      updatedPermissions?: PermissionSuggestion[],
      updatedInput?: Record<string, unknown>,
      denyMessage?: string,
      interrupt?: boolean,
    ) => void | Promise<void>;
    onRetry?: (requestId: string) => void | Promise<void>;
    coordinator: PermissionCoordinator;
  } = $props();

  // Per-card state projection. Keyed by requestId so that re-ordering
  // and arrival/departure do not leak state across rows.
  let snapshots = $state<Record<string, PermissionSnapshot>>({});

  // Subscribe once and reduce into `snapshots`. The unsubscribe is
  // called automatically when the component is destroyed by Svelte 5.
  $effect(() => {
    const unsubscribe = coordinator.subscribe((event: PermissionEvent) => {
      snapshots = {
        ...snapshots,
        [event.requestId]: {
          runId: event.runId,
          requestId: event.requestId,
          toolName: event.toolName,
          state: event.state,
          failure: event.failure,
          decidedAt: event.at,
        },
      };
    });
    return () => unsubscribe();
  });

  function rowState(requestId: string): PermissionSnapshot["state"] | "pending" {
    return snapshots[requestId]?.state ?? "pending";
  }

  function rowFailure(requestId: string) {
    return snapshots[requestId]?.failure;
  }

  function isBusy(requestId: string): boolean {
    return rowState(requestId) === "submitting";
  }

  function isStuck(requestId: string): boolean {
    const s = rowState(requestId);
    return s === "stale" || s === "cancelled" || s === "expired";
  }

  function isFailed(requestId: string): boolean {
    return rowState(requestId) === "failed";
  }

  function showActions(requestId: string): boolean {
    const s = rowState(requestId);
    // Hide action buttons when the row is in a terminal non-resumable
    // state. `failed` keeps Retry so the user can re-issue; `stale` /
    // `cancelled` / `expired` cannot recover from this row.
    return s === "pending" || s === "submitting" || s === "failed";
  }

  async function respondSingle(
    requestId: string,
    behavior: "allow" | "deny",
    updatedPermissions: PermissionSuggestion[] | undefined = undefined,
    updatedInput: Record<string, unknown> | undefined = undefined,
    denyMessage: string | undefined = undefined,
    interrupt: boolean | undefined = undefined,
  ) {
    if (isBusy(requestId) || isStuck(requestId)) return;
    dbg("PermissionPanel", "respondSingle", { requestId, behavior });
    try {
      await onPermissionRespond(
        requestId,
        behavior,
        updatedPermissions,
        updatedInput,
        denyMessage,
        interrupt,
      );
    } catch (e) {
      // The coordinator already moved the row to `failed` and recorded
      // the typed error. The toast / banner layer surfaces it; we log
      // only the breadcrumb here.
      dbgWarn("PermissionPanel", "respondSingle failed", {
        requestId,
        error: String(e),
      });
    }
  }

  async function retryRow(requestId: string) {
    if (!onRetry) return;
    dbg("PermissionPanel", "retry", { requestId });
    try {
      await onRetry(requestId);
    } catch (e) {
      dbgWarn("PermissionPanel", "retry failed", { requestId, error: String(e) });
    }
  }

  // Batch actions only fire against the stable snapshot of rows that
  // are NOT already in a non-actionable state. Each row is dispatched
  // through the coordinator independently so partial failure leaves
  // the remaining rows intact.
  let actionableRows = $derived(pendingTools.filter((item) => showActions(item.requestId)));

  let isSingle = $derived(pendingTools.length === 1);

  async function allowAll() {
    if (actionableRows.length === 0) return;
    dbg("PermissionPanel", "allowAll", { count: actionableRows.length });
    const snapshot = [...actionableRows];
    await Promise.allSettled(
      snapshot.map((item) => respondSingle(item.requestId, "allow", undefined, item.tool.input)),
    );
  }

  async function denyAll() {
    if (actionableRows.length === 0) return;
    dbg("PermissionPanel", "denyAll", { count: actionableRows.length });
    const snapshot = [...actionableRows];
    await Promise.allSettled(snapshot.map((item) => respondSingle(item.requestId, "deny")));
  }
</script>

{#if pendingTools.length > 0}
  <div class="fixed bottom-0 left-0 right-0 z-[99999] flex justify-center pb-5 pointer-events-auto">
    <div class="w-full chat-content-width pb-2 pt-1">
      <div
        class="rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-background shadow-lg animate-fade-in"
      >
        {#if isSingle}
          {@const item = pendingTools[0]}
          {@const style = getToolColor(item.tool.tool_name)}
          {@const detail = getToolDetail(item.tool.input)}
          {@const isPath = !!(detail && isAbsolutePath(detail))}
          {@const busy = isBusy(item.requestId)}
          {@const stuck = isStuck(item.requestId)}
          {@const failed = isFailed(item.requestId)}
          {@const failure = rowFailure(item.requestId)}
          <div class="px-4 py-3">
            <div class="flex items-center gap-2 mb-2">
              <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}">
                <svg
                  class="h-3 w-3 {style.text}"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d={style.icon} /></svg
                >
              </div>
              <span class="text-xs font-medium text-foreground"
                >{t("inline_permissionRequired")}</span
              >
              {#if busy}
                <div class="h-3 w-3 shrink-0">
                  <Spinner
                    size="xs"
                    class="!h-2.5 !w-2.5 border-[hsl(var(--miwarp-status-warning)/0.3)] border-t-[hsl(var(--miwarp-status-warning))]"
                  />
                </div>
              {/if}
            </div>
            <p class="text-sm text-foreground mb-1">
              {t("inline_claudeWantsToUse")} <strong>{item.tool.tool_name}</strong>
            </p>
            {#if detail}
              <p
                class="text-xs text-muted-foreground mb-2 truncate"
                style:direction={isPath ? "rtl" : undefined}
                style:text-align={isPath ? "left" : undefined}
              >
                {#if isPath}<bdi>{detail}</bdi>{:else}{detail}{/if}
              </p>
            {/if}

            {#if stuck}
              <p class="text-[11px] text-muted-foreground/80 mb-1">
                {t("perm_stale", { tool: item.tool.tool_name })}
              </p>
            {:else if failed && failure}
              <p class="text-[11px] text-miwarp-status-error mb-1">
                {t("perm_failed", { code: failure.code, message: failure.message })}
              </p>
            {/if}

            {#if showActions(item.requestId)}
              <div class="flex gap-2">
                <button
                  type="button"
                  aria-busy={busy}
                  class="rounded-md bg-miwarp-status-success px-4 py-1.5 text-xs font-medium text-miwarp-accent-on-accent hover:opacity-80 transition-all disabled:opacity-50"
                  disabled={busy || stuck}
                  onclick={() => respondSingle(item.requestId, "allow", undefined, item.tool.input)}
                  >{t("common_allow")}</button
                >
                <button
                  type="button"
                  aria-busy={busy}
                  class="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-all disabled:opacity-50"
                  disabled={busy || stuck}
                  onclick={() => respondSingle(item.requestId, "deny")}>{t("common_deny")}</button
                >
                <button
                  type="button"
                  aria-busy={busy}
                  class="rounded-md border border-[hsl(var(--miwarp-status-error)/0.3)] bg-[hsl(var(--miwarp-status-error)/0.1)] px-3 py-1.5 text-xs font-medium text-miwarp-status-error hover:bg-miwarp-status-error/20 transition-all disabled:opacity-50"
                  disabled={busy || stuck}
                  onclick={() =>
                    respondSingle(item.requestId, "deny", undefined, undefined, undefined, true)}
                  >{t("common_denyAndStop")}</button
                >
                {#if failed && onRetry}
                  <button
                    type="button"
                    class="rounded-md border border-miwarp-status-info/40 bg-miwarp-status-info/10 px-3 py-1.5 text-xs font-medium text-miwarp-status-info hover:bg-miwarp-status-info/20 transition-all disabled:opacity-50"
                    disabled={busy}
                    onclick={() => retryRow(item.requestId)}>{t("perm_retry")}</button
                  >
                {/if}
              </div>
              {#if item.tool.suggestions && item.tool.suggestions.length > 0}
                <div
                  class="flex flex-wrap gap-2 mt-2 pt-2 border-t border-[hsl(var(--miwarp-status-warning)/0.2)]"
                >
                  {#each item.tool.suggestions as suggestion}
                    {@const label = formatSuggestionLabel(
                      suggestion,
                      t as (key: string, params?: Record<string, string>) => string,
                    )}
                    <button
                      type="button"
                      class="rounded-md border border-miwarp-status-info/30 bg-miwarp-status-info/10 px-3 py-1.5 text-xs font-medium text-miwarp-status-info hover:bg-miwarp-status-info/10 transition-all disabled:opacity-50"
                      disabled={busy || stuck}
                      onclick={() =>
                        respondSingle(item.requestId, "allow", [suggestion], item.tool.input)}
                      >{label}</button
                    >
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        {:else}
          <div class="px-4 py-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <Spinner
                  size="xs"
                  class="!h-2.5 !w-2.5 border-[hsl(var(--miwarp-status-warning)/0.3)] border-t-[hsl(var(--miwarp-status-warning))]"
                />
                <span class="text-xs font-medium text-foreground">
                  {t("perm_nPermissions", { count: String(pendingTools.length) })}
                </span>
              </div>
            </div>

            <div class="max-h-48 overflow-y-auto space-y-1 mb-3">
              {#each pendingTools as item (item.requestId)}
                {@const style = getToolColor(item.tool.tool_name)}
                {@const detail = getToolDetail(item.tool.input)}
                {@const isPath = !!(detail && isAbsolutePath(detail))}
                {@const busy = isBusy(item.requestId)}
                {@const stuck = isStuck(item.requestId)}
                {@const failed = isFailed(item.requestId)}
                {@const failure = rowFailure(item.requestId)}
                <div
                  class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30 transition-colors group"
                >
                  <div class="flex h-4 w-4 shrink-0 items-center justify-center rounded {style.bg}">
                    <svg
                      class="h-2.5 w-2.5 {style.text}"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"><path d={style.icon} /></svg
                    >
                  </div>
                  <span class="text-xs font-medium text-foreground w-14 shrink-0 truncate">
                    {item.tool.tool_name}
                  </span>
                  <span
                    class="text-xs text-muted-foreground flex-1 min-w-0 truncate"
                    style:direction={isPath ? "rtl" : undefined}
                    style:text-align={isPath ? "left" : undefined}
                  >
                    {#if isPath}<bdi>{detail}</bdi>{:else}{detail}{/if}
                  </span>
                  <div class="flex items-center gap-1 shrink-0">
                    {#if failed && onRetry}
                      <button
                        type="button"
                        class="rounded px-2 py-0.5 text-[10px] font-medium text-miwarp-status-info hover:bg-miwarp-status-info/10 transition-all disabled:opacity-50"
                        disabled={busy}
                        onclick={() => retryRow(item.requestId)}>{t("perm_retry")}</button
                      >
                    {:else if stuck}
                      <span class="text-[10px] text-muted-foreground/70"
                        >{t("perm_staleShort")}</span
                      >
                    {:else}
                      <button
                        type="button"
                        class="rounded px-2 py-0.5 text-[10px] font-medium bg-miwarp-status-success/80 text-miwarp-accent-on-accent hover:opacity-80 transition-all disabled:opacity-50"
                        disabled={busy || stuck}
                        onclick={() =>
                          respondSingle(item.requestId, "allow", undefined, item.tool.input)}
                        >{t("common_allow")}</button
                      >
                      <button
                        type="button"
                        class="rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-miwarp-status-error hover:bg-[hsl(var(--miwarp-status-error)/0.1)] transition-all disabled:opacity-50"
                        disabled={busy || stuck}
                        onclick={() => respondSingle(item.requestId, "deny")}
                        title={t("common_deny")}>&times;</button
                      >
                    {/if}
                  </div>
                  {#if failed && failure}
                    <div class="basis-full text-[10px] text-miwarp-status-error/80 pl-1">
                      {t("perm_failed", { code: failure.code, message: failure.message })}
                    </div>
                  {/if}
                </div>
                {#if item.tool.suggestions && item.tool.suggestions.length > 0 && !stuck && !failed}
                  <div class="flex flex-wrap gap-1.5 ml-8 mb-1">
                    {#each item.tool.suggestions as suggestion}
                      {@const label = formatSuggestionLabel(
                        suggestion,
                        t as (key: string, params?: Record<string, string>) => string,
                      )}
                      <button
                        type="button"
                        class="rounded border border-miwarp-status-info/30 bg-miwarp-status-info/10 px-2 py-0.5 text-[10px] font-medium text-miwarp-status-info hover:bg-miwarp-status-info/10 transition-all disabled:opacity-50"
                        disabled={busy || stuck}
                        onclick={() =>
                          respondSingle(item.requestId, "allow", [suggestion], item.tool.input)}
                        >{label}</button
                      >
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>

            <div class="flex gap-2 pt-2 border-t border-[hsl(var(--miwarp-status-warning)/0.2)]">
              <button
                type="button"
                class="rounded-md bg-miwarp-status-success px-4 py-1.5 text-xs font-medium text-miwarp-accent-on-accent hover:opacity-80 transition-all disabled:opacity-50"
                disabled={actionableRows.length === 0}
                onclick={allowAll}
                >{t("perm_allowAll", { count: String(actionableRows.length) })}</button
              >
              <button
                type="button"
                class="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-all disabled:opacity-50"
                disabled={actionableRows.length === 0}
                onclick={denyAll}>{t("perm_denyAll")}</button
              >
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
