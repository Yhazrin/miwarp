/**
 * Permission handlers: thin facade that the chat page wires into the UI
 * tree. All real lifecycle work is delegated to the singleton
 * {@link PermissionCoordinator} (see `permission-coordinator.ts`).
 *
 * The handlers exist for two reasons:
 *  1. To bridge the coordinator's typed API to the page's reactive
 *     surface (runId resolution, setApproving flag, goto/tick for
 *     ExitPlanMode continuation).
 *  2. To host the legacy ExitPlanMode / AskUserQuestion special paths
 *     that pre-date the coordinator and are still routed through the
 *     IPC `respond_permission` channel.
 *
 * Breadcrumb policy: this file logs ONLY `runId`, `requestId`,
 * `toolName`, `decisionKind`, and (on failure) `code`. Tool input,
 * suggestion payloads, deny messages, and other user content are
 * explicitly NOT logged.
 */
import * as api from "$lib/api";
import { LS_PROJECT_CWD } from "$lib/utils/storage-keys";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { isPlanFilePath, planFileName, extractPlanContent } from "$lib/utils/tool-rendering";
import { clearAttention } from "$lib/stores/attention-store.svelte";
import { getPermissionCoordinator } from "$lib/chat/permission-coordinator-instance";
import { isDenyDecision } from "$lib/chat/permission-coordinator/identity";
import { isPermanentAllowBlocked } from "$lib/chat/utils/permission-mode-contract";
import { permissionError } from "$lib/chat/permission-error";
import type { PermissionCoordinator, PermissionDecision } from "$lib/chat/permission-coordinator";
import type { PermissionSuggestion } from "$lib/types";
import type { SessionStore } from "$lib/stores/session-store.svelte";

export interface PermissionHandlerContext {
  store: SessionStore;
  timelineIdIndex: Map<string, number>;
  setApproving: (v: boolean) => void;
  goto: (path: string, opts?: { replaceState?: boolean }) => void;
  tick: () => Promise<void>;
}

export function createPermissionHandlers(ctx: PermissionHandlerContext) {
  const { store, timelineIdIndex, setApproving, goto, tick } = ctx;
  const coordinator = getPermissionCoordinator();

  let approveTimer: ReturnType<typeof setTimeout> | null = null;

  async function handleToolApprove(toolName: string): Promise<void> {
    if (!store.run) return;
    if (approveTimer) {
      clearTimeout(approveTimer);
      approveTimer = null;
    }
    setApproving(true);
    dbg("chat", "approving tool", { runId: store.run.id, toolName });
    try {
      await api.approveSessionTool(store.run.id, toolName);
    } catch (e) {
      dbgWarn("chat", "approve failed:", e);
      store.error = String(e);
    } finally {
      approveTimer = setTimeout(() => {
        setApproving(false);
        approveTimer = null;
      }, 3000);
    }
  }

  /**
   * Generic permission respond. Captures runId at click time; the
   * coordinator is the only owner of the request lifecycle.
   */
  async function handlePermissionRespond(
    requestId: string,
    behavior: "allow" | "deny",
    updatedPermissions?: PermissionSuggestion[],
    updatedInput?: Record<string, unknown>,
    denyMessage?: string,
    interrupt?: boolean,
  ): Promise<void> {
    if (!store.run || !store.sessionAlive) return;
    const runId = store.run.id;
    const toolName = lookupToolName(store, requestId) ?? "unknown";

    if (behavior === "allow" && updatedPermissions) {
      const modePerm = updatedPermissions.find((p) => p.type === "setMode");
      if (modePerm && modePerm.mode) {
        store.pendingPermissionModeOverride = modePerm.mode;
        dbg("chat", "set pendingPermissionModeOverride", { mode: modePerm.mode });
      }
    }

    const decision: PermissionDecision = buildDecision(
      behavior,
      interrupt,
      updatedPermissions,
      updatedInput,
      denyMessage,
    );

    if (behavior === "allow" && isPermanentAllowBlocked(toolName)) {
      const failure = permissionError.dangerBlocked(toolName);
      dbgWarn("chat", "permanent allow blocked by policy", {
        runId,
        requestId,
        toolName,
        code: failure.code,
      });
      // Surface typed error: the card transitions to failed with a
      // Retry CTA. The user has to either re-issue as allow-once or
      // pick a different mode.
      try {
        await coordinator.respond({
          runId,
          requestId,
          toolName,
          decision,
          transport: () => Promise.resolve(),
        });
      } catch {
        // Coordinator already moved the card to failed; nothing more.
      }
      throw failure;
    }

    const transport = () =>
      api.respondPermission(
        runId,
        requestId,
        behavior,
        decisionRules(updatedPermissions),
        updatedInput ?? undefined,
        denyMessage ?? undefined,
        interrupt ?? undefined,
        toolName,
      );

    try {
      await coordinator.respond({
        runId,
        requestId,
        toolName,
        decision,
        transport,
      });
      // Optimistic clear only fires after the coordinator confirms a
      // terminal `allowed` / `denied`. On failure the card transitions
      // to `failed` and stays put so the user can Retry.
      resolveAttention(runId, requestId, decision);
      optimisticResolve(store, runId, requestId, decision);
    } catch (e) {
      dbgWarn("chat", "permission respond failed:", { runId, requestId, error: String(e) });
      store.error = String(e);
      throw e;
    }
  }

  async function handleElicitationRespond(
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): Promise<void> {
    if (!store.run || !store.sessionAlive) return;
    const runId = store.run.id;
    dbg("chat", "elicitation respond", { runId, requestId, action });
    try {
      await api.respondElicitation(runId, requestId, action, content);
      const { resolveElicitationOptimistic } = await import("$lib/utils/resolve-elicitation");
      resolveElicitationOptimistic(store, runId, requestId);
    } catch (e) {
      dbgWarn("chat", "elicitation respond failed:", e);
      store.error = String(e);
    }
  }

  function getPlanContentForExitPlan(
    entryId: string,
  ): { content: string; fileName: string } | null {
    const idx = timelineIdIndex.get(entryId);
    if (idx == null) {
      dbgWarn("chat", "ExitPlanMode entry not found in timeline index", { id: entryId });
      return null;
    }
    const result = extractPlanContent(store.timeline, idx);
    if (result) return result;
    const entry = store.timeline[idx];
    if (entry?.kind === "tool" && entry.tool.status === "success") {
      const toolResult = entry.tool.tool_use_result as
        | { plan?: string; filePath?: string }
        | undefined;
      if (toolResult?.plan && typeof toolResult.plan === "string") {
        const fp = String(toolResult.filePath ?? "");
        const name = isPlanFilePath(fp) ? (planFileName(fp) ?? "plan") : "plan";
        return { content: toolResult.plan, fileName: name };
      }
    }
    return null;
  }

  async function handleExitPlanBypass(): Promise<void> {
    if (!store.run) return;
    const runId = store.run.id;
    dbg("chat", "ExitPlanMode: bypass approvals");

    const exitPlanEntry = store.timeline.find(
      (e) =>
        e.kind === "tool" &&
        e.tool.tool_name === "ExitPlanMode" &&
        e.tool.status === "permission_prompt" &&
        e.tool.permission_request_id,
    );
    if (!exitPlanEntry || exitPlanEntry.kind !== "tool") return;
    const requestId = exitPlanEntry.tool.permission_request_id!;
    const toolName = "ExitPlanMode";

    try {
      store.pendingPermissionModeOverride = "bypassPermissions";
      const rules: PermissionSuggestion[] = [
        { type: "setMode", mode: "bypassPermissions", destination: "session" },
      ];
      const decision: PermissionDecision = {
        kind: "allow-set-mode",
        rules,
        toolInput: exitPlanEntry.tool.input,
      };
      await coordinator.respond({
        runId,
        requestId,
        toolName,
        decision,
        transport: () =>
          api.respondPermission(
            runId,
            requestId,
            "allow",
            rules,
            exitPlanEntry.tool.input ?? undefined,
            undefined,
            undefined,
            toolName,
          ),
      });
      resolveAttention(runId, requestId, decision);
      optimisticResolve(store, runId, requestId, decision);
      dbg("chat", "ExitPlanMode: bypass response sent");
    } catch (e) {
      dbgWarn("chat", "ExitPlanMode bypass failed:", e);
      store.pendingPermissionModeOverride = null;
      store.error = String(e);
      throw e;
    }
  }

  async function handleExitPlanClearContext(): Promise<void> {
    if (!store.run) return;
    const runId = store.run.id;
    const cwd = localStorage.getItem(LS_PROJECT_CWD) || "";
    dbg("chat", "ExitPlanMode: clear context + auto-accept");

    const exitPlanEntry = store.timeline.find(
      (e) =>
        e.kind === "tool" &&
        e.tool.tool_name === "ExitPlanMode" &&
        e.tool.status === "permission_prompt" &&
        e.tool.permission_request_id,
    );
    if (!exitPlanEntry || exitPlanEntry.kind !== "tool") return;
    const requestId = exitPlanEntry.tool.permission_request_id!;
    const toolName = "ExitPlanMode";

    try {
      store.pendingPermissionModeOverride = "acceptEdits";
      store.pendingClearContextPlan = "__pending__";

      const rules: PermissionSuggestion[] = [
        { type: "setMode", mode: "acceptEdits", destination: "session" },
      ];
      const decision: PermissionDecision = {
        kind: "allow-set-mode",
        rules,
        toolInput: exitPlanEntry.tool.input,
      };
      await coordinator.respond({
        runId,
        requestId,
        toolName,
        decision,
        transport: () =>
          api.respondPermission(
            runId,
            requestId,
            "allow",
            rules,
            exitPlanEntry.tool.input ?? undefined,
            undefined,
            undefined,
            toolName,
          ),
      });
      resolveAttention(runId, requestId, decision);
      optimisticResolve(store, runId, requestId, decision);

      let planContent: string | null = null;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (store.pendingClearContextPlan && store.pendingClearContextPlan !== "__pending__") {
          planContent = store.pendingClearContextPlan;
          break;
        }
      }
      store.pendingClearContextPlan = null;

      if (!planContent) {
        dbgWarn("chat", "ExitPlanMode: timed out waiting for plan content");
        return;
      }

      await api
        .interruptSession(runId)
        .catch((e) => dbg("permission", "interrupt failed (session may have ended):", e));
      await api.stopSession(runId);
      dbg("chat", "ExitPlanMode: session stopped");

      const planPrompt = `Implement the following plan:\n\n${planContent}`;
      await goto("/chat", { replaceState: true });
      await tick();
      const newRunId = await store.startSession(planPrompt, cwd, [], "acceptEdits");
      await goto(`/chat?run=${newRunId}`, { replaceState: true });
      dbg("chat", "ExitPlanMode: new session started", { newRunId });
    } catch (e) {
      dbgWarn("chat", "ExitPlanMode clear context failed:", e);
      store.pendingClearContextPlan = null;
      store.error = String(e);
      throw e;
    }
  }

  async function handleHookCallbackRespond(
    requestId: string,
    decision: "allow" | "deny",
  ): Promise<void> {
    if (!store.run) return;
    dbg("chat", "hook callback respond", { runId: store.run.id, requestId, decision });
    try {
      await api.respondHookCallback(store.run.id, requestId, decision);
      store.hookEvents = store.hookEvents.map((h) =>
        h.request_id === requestId
          ? { ...h, status: decision === "allow" ? ("allowed" as const) : ("denied" as const) }
          : h,
      );
    } catch (e) {
      dbgWarn("chat", "hook callback respond failed:", e);
      store.error = String(e);
    }
  }

  return {
    handleToolApprove,
    handlePermissionRespond,
    handleElicitationRespond,
    getPlanContentForExitPlan,
    handleExitPlanClearContext,
    handleExitPlanBypass,
    handleHookCallbackRespond,
    /** Exposed for the chat page to read coordinator state. */
    permissionCoordinator: coordinator,
  };
}

// ── helpers ──

function lookupToolName(store: SessionStore, requestId: string): string | null {
  const walk = (entries: typeof store.timeline): string | null => {
    for (const entry of entries) {
      if (entry.kind === "tool") {
        if (entry.tool.permission_request_id === requestId) return entry.tool.tool_name;
        if (entry.subTimeline) {
          const found = walk(entry.subTimeline);
          if (found) return found;
        }
      }
    }
    return null;
  };
  return walk(store.timeline);
}

function buildDecision(
  behavior: "allow" | "deny",
  interrupt: boolean | undefined,
  updatedPermissions: PermissionSuggestion[] | undefined,
  updatedInput: Record<string, unknown> | undefined,
  denyMessage: string | undefined,
): PermissionDecision {
  if (behavior === "allow") {
    const perms = updatedPermissions ?? [];
    const hasSetMode = perms.some((p) => p?.type === "setMode" && p.mode);
    if (hasSetMode) {
      return { kind: "allow-set-mode", rules: perms, toolInput: updatedInput };
    }
    if (perms.length > 0) {
      return { kind: "allow-with-rules", rules: perms, toolInput: updatedInput };
    }
    return { kind: "allow-once", toolInput: updatedInput };
  }
  if (interrupt) return { kind: "deny-stop", message: denyMessage };
  return { kind: "deny", message: denyMessage };
}

function decisionRules(
  updatedPermissions?: PermissionSuggestion[],
): PermissionSuggestion[] | undefined {
  if (!updatedPermissions || updatedPermissions.length === 0) return undefined;
  return updatedPermissions;
}

function resolveAttention(runId: string, requestId: string, decision: PermissionDecision): void {
  clearAttention(runId, "permission");
  if (isDenyDecision(decision)) {
    clearAttention(runId, "ask");
  }
}

function optimisticResolve(
  store: SessionStore,
  runId: string,
  requestId: string,
  decision: PermissionDecision,
): void {
  if (isDenyDecision(decision)) {
    store.resolvePermissionDeny(requestId);
  } else {
    store.resolvePermissionAllow(requestId);
  }
}
;
