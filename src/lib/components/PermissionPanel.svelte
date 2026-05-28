<script lang="ts">
  import type { BusToolItem, PermissionSuggestion } from "$lib/types";
  import { getToolColor } from "$lib/utils/tool-colors";
  import { getToolDetail, formatSuggestionLabel } from "$lib/utils/tool-rendering";
  import { isAbsolutePath } from "$lib/utils/format";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";

  let {
    pendingTools,
    onPermissionRespond,
  }: {
    pendingTools: Array<{ tool: BusToolItem; requestId: string }>;
    onPermissionRespond: (
      requestId: string,
      behavior: "allow" | "deny",
      updatedPermissions?: PermissionSuggestion[],
      updatedInput?: Record<string, unknown>,
      denyMessage?: string,
      interrupt?: boolean,
    ) => void | Promise<void>;
  } = $props();

  // ── Submitting state (竞态防护) ──
  let submittingAll = $state(false);
  let submittingIds = $state(new Set<string>());

  function markSubmitting(requestId: string) {
    submittingIds = new Set([...submittingIds, requestId]);
  }
  function unmarkSubmitting(requestId: string) {
    const next = new Set(submittingIds);
    next.delete(requestId);
    submittingIds = next;
  }

  // ── Single-item actions ──

  async function respondSingle(
    requestId: string,
    behavior: "allow" | "deny",
    updatedPermissions?: PermissionSuggestion[],
    updatedInput?: Record<string, unknown>,
    denyMessage?: string,
    interrupt?: boolean,
  ) {
    if (submittingAll || submittingIds.has(requestId)) return;
    dbg("PermissionPanel", "respondSingle", { requestId, behavior });
    markSubmitting(requestId);
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
      dbgWarn("PermissionPanel", "respondSingle failed", { requestId, reason: e });
    } finally {
      unmarkSubmitting(requestId);
    }
  }

  // ── Batch actions ──

  async function allowAll() {
    if (submittingAll || submittingIds.size > 0) return;
    submittingAll = true;
    const snapshot = pendingTools.filter((item) => !submittingIds.has(item.requestId));
    dbg("PermissionPanel", "allowAll", { count: snapshot.length });
    const results = await Promise.allSettled(
      snapshot.map((item) =>
        onPermissionRespond(item.requestId, "allow", undefined, item.tool.input),
      ),
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        dbgWarn("PermissionPanel", "allowAll: one failed", {
          requestId: snapshot[i].requestId,
          reason: (results[i] as PromiseRejectedResult).reason,
        });
      }
    }
    submittingAll = false;
  }

  async function denyAll() {
    if (submittingAll || submittingIds.size > 0) return;
    submittingAll = true;
    const snapshot = pendingTools.filter((item) => !submittingIds.has(item.requestId));
    dbg("PermissionPanel", "denyAll", { count: snapshot.length });
    const results = await Promise.allSettled(
      snapshot.map((item) => onPermissionRespond(item.requestId, "deny")),
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        dbgWarn("PermissionPanel", "denyAll: one failed", {
          requestId: snapshot[i].requestId,
          reason: (results[i] as PromiseRejectedResult).reason,
        });
      }
    }
    submittingAll = false;
  }

  // ── Helpers ──
  let isSingle = $derived(pendingTools.length === 1);
</script>

{#if pendingTools.length > 0}
  <div class="fixed bottom-0 left-0 right-0 z-[99999] flex justify-center pb-5 pointer-events-auto">
    <div class="w-full chat-content-width pb-2 pt-1">
      <div class="rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-background shadow-lg animate-fade-in">
        {#if isSingle}
          <!-- Single permission: compact card -->
          {@const item = pendingTools[0]}
          {@const style = getToolColor(item.tool.tool_name)}
          {@const detail = getToolDetail(item.tool.input)}
          {@const isPath = !!(detail && isAbsolutePath(detail))}
          {@const busy = submittingAll || submittingIds.has(item.requestId)}
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
              <div class="h-3 w-3 shrink-0">
                <Spinner size="xs" class="!h-2.5 !w-2.5 border-[hsl(var(--miwarp-status-warning)/0.3)] border-t-[hsl(var(--miwarp-status-warning))]" />
              </div>
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
            <div class="flex gap-2">
              <button
                class="rounded-md bg-miwarp-status-success px-4 py-1.5 text-xs font-medium text-miwarp-accent-on-accent hover:opacity-80 transition-all disabled:opacity-50"
                disabled={busy}
                onclick={() => respondSingle(item.requestId, "allow", undefined, item.tool.input)}
                >{t("common_allow")}</button
              >
              <button
                class="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-all disabled:opacity-50"
                disabled={busy}
                onclick={() => respondSingle(item.requestId, "deny")}>{t("common_deny")}</button
              >
              <button
                class="rounded-md border border-[hsl(var(--miwarp-status-error)/0.3)] bg-[hsl(var(--miwarp-status-error)/0.1)] px-3 py-1.5 text-xs font-medium text-miwarp-status-error hover:bg-miwarp-status-error/20 transition-all disabled:opacity-50"
                disabled={busy}
                onclick={() =>
                  respondSingle(item.requestId, "deny", undefined, undefined, undefined, true)}
                >{t("common_denyAndStop")}</button
              >
            </div>
            {#if item.tool.suggestions && item.tool.suggestions.length > 0}
              <div class="flex flex-wrap gap-2 mt-2 pt-2 border-t border-[hsl(var(--miwarp-status-warning)/0.2)]">
                {#each item.tool.suggestions as suggestion}
                  {@const label = formatSuggestionLabel(
                    suggestion,
                    t as (key: string, params?: Record<string, string>) => string,
                  )}
                  <button
                    class="rounded-md border border-miwarp-status-info/30 bg-miwarp-status-info/10 px-3 py-1.5 text-xs font-medium text-miwarp-status-info hover:bg-miwarp-status-info/10 transition-all disabled:opacity-50"
                    disabled={busy}
                    onclick={() =>
                      respondSingle(item.requestId, "allow", [suggestion], item.tool.input)}
                    >{label}</button
                  >
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <!-- Multiple permissions: merged list -->
          <div class="px-4 py-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <Spinner size="xs" class="!h-2.5 !w-2.5 border-[hsl(var(--miwarp-status-warning)/0.3)] border-t-[hsl(var(--miwarp-status-warning))]" />
                <span class="text-xs font-medium text-foreground">
                  {t("perm_nPermissions", { count: String(pendingTools.length) })}
                </span>
              </div>
            </div>

            <!-- Scrollable list -->
            <div class="max-h-48 overflow-y-auto space-y-1 mb-3">
              {#each pendingTools as item (item.requestId)}
                {@const style = getToolColor(item.tool.tool_name)}
                {@const detail = getToolDetail(item.tool.input)}
                {@const isPath = !!(detail && isAbsolutePath(detail))}
                {@const busy = submittingAll || submittingIds.has(item.requestId)}
                <div
                  class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30 transition-colors group"
                >
                  <!-- Tool icon -->
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
                  <!-- Tool name -->
                  <span class="text-xs font-medium text-foreground w-14 shrink-0 truncate">
                    {item.tool.tool_name}
                  </span>
                  <!-- Detail -->
                  <span
                    class="text-xs text-muted-foreground flex-1 min-w-0 truncate"
                    style:direction={isPath ? "rtl" : undefined}
                    style:text-align={isPath ? "left" : undefined}
                  >
                    {#if isPath}<bdi>{detail}</bdi>{:else}{detail}{/if}
                  </span>
                  <!-- Per-row buttons -->
                  <div class="flex items-center gap-1 shrink-0">
                    <button
                      class="rounded px-2 py-0.5 text-[10px] font-medium bg-miwarp-status-success/80 text-miwarp-accent-on-accent hover:opacity-80 transition-all disabled:opacity-50"
                      disabled={busy}
                      onclick={() =>
                        respondSingle(item.requestId, "allow", undefined, item.tool.input)}
                      >{t("common_allow")}</button
                    >
                    <button
                      class="rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-miwarp-status-error hover:bg-[hsl(var(--miwarp-status-error)/0.1)] transition-all disabled:opacity-50"
                      disabled={busy}
                      onclick={() => respondSingle(item.requestId, "deny")}
                      title={t("common_deny")}>&times;</button
                    >
                  </div>
                </div>
                <!-- Suggestions for this tool (indented sub-row) -->
                {#if item.tool.suggestions && item.tool.suggestions.length > 0}
                  <div class="flex flex-wrap gap-1.5 ml-8 mb-1">
                    {#each item.tool.suggestions as suggestion}
                      {@const label = formatSuggestionLabel(
                        suggestion,
                        t as (key: string, params?: Record<string, string>) => string,
                      )}
                      <button
                        class="rounded border border-miwarp-status-info/30 bg-miwarp-status-info/10 px-2 py-0.5 text-[10px] font-medium text-miwarp-status-info hover:bg-miwarp-status-info/10 transition-all disabled:opacity-50"
                        disabled={busy}
                        onclick={() =>
                          respondSingle(item.requestId, "allow", [suggestion], item.tool.input)}
                        >{label}</button
                      >
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>

            <!-- Batch buttons -->
            <div class="flex gap-2 pt-2 border-t border-[hsl(var(--miwarp-status-warning)/0.2)]">
              <button
                class="rounded-md bg-miwarp-status-success px-4 py-1.5 text-xs font-medium text-miwarp-accent-on-accent hover:opacity-80 transition-all disabled:opacity-50"
                disabled={submittingAll || submittingIds.size > 0}
                onclick={allowAll}
                >{t("perm_allowAll", { count: String(pendingTools.length) })}</button
              >
              <button
                class="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-all disabled:opacity-50"
                disabled={submittingAll || submittingIds.size > 0}
                onclick={denyAll}>{t("perm_denyAll")}</button
              >
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
