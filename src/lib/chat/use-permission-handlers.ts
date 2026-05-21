import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { isPlanFilePath, planFileName, extractPlanContent } from "$lib/utils/tool-rendering";
import { resolvePermissionOptimistic } from "$lib/utils/resolve-permission";
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

  async function handleToolApprove(toolName: string): Promise<void> {
    if (!store.run) return;
    setApproving(true);
    dbg("chat", "approving tool", { runId: store.run.id, toolName });
    try {
      await api.approveSessionTool(store.run.id, toolName);
    } catch (e) {
      dbgWarn("chat", "approve failed:", e);
      store.error = String(e);
    } finally {
      setTimeout(() => {
        setApproving(false);
      }, 3000);
    }
  }

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
    dbg("chat", "inline permission respond", {
      runId,
      requestId,
      behavior,
      updatedPermissions,
      updatedInput,
      denyMessage,
      interrupt,
    });
    try {
      if (behavior === "allow" && updatedPermissions) {
        const modePerm = updatedPermissions.find((p) => p.type === "setMode");
        if (modePerm && modePerm.mode) {
          store.pendingPermissionModeOverride = modePerm.mode;
          dbg("chat", "set pendingPermissionModeOverride", { mode: modePerm.mode });
        }
      }

      await api.respondPermission(
        runId,
        requestId,
        behavior,
        updatedPermissions,
        updatedInput,
        denyMessage,
        interrupt,
      );
      resolvePermissionOptimistic(store, runId, requestId, behavior);
    } catch (e) {
      dbgWarn("chat", "permission respond failed:", e);
      if (behavior === "deny") {
        resolvePermissionOptimistic(store, runId, requestId, "deny");
      }
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

    try {
      store.pendingPermissionModeOverride = "bypassPermissions";
      await api.respondPermission(
        runId,
        requestId,
        "allow",
        [{ type: "setMode", mode: "bypassPermissions", destination: "session" }],
        exitPlanEntry.tool.input,
      );
      resolvePermissionOptimistic(store, runId, requestId, "allow");
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
    const cwd = localStorage.getItem("ocv:project-cwd") || "";
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

    try {
      store.pendingPermissionModeOverride = "acceptEdits";
      store.pendingClearContextPlan = "__pending__";

      await api.respondPermission(
        runId,
        requestId,
        "allow",
        [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
        exitPlanEntry.tool.input,
      );
      resolvePermissionOptimistic(store, runId, requestId, "allow");

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

      await api.interruptSession(runId).catch(() => {});
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
  };
}
