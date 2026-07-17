/**
 * Permission handling functions extracted from SessionStore.
 *
 * Contains permission scan, resolveAskQuestion, answerToolQuestion,
 * and unified permission resolution.
 *
 * @module permission-handler
 */
import * as api from "$lib/api";
import type { BusToolItem, HookEvent, TimelineEntry } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

// ── Store interface ──

export interface PermissionHandlerAPI {
  timeline: TimelineEntry[];
  tools: HookEvent[];
  useStreamSession: boolean;
  sessionAlive: boolean;
  run: { id: string } | null;
  error: string;
  _findToolIdx(ctx: null, toolUseId: string): number;
  _findHeIdx(ctx: null, toolUseId: string): number;
  pendingElicitations: Map<string, unknown>;
}

// ── Permission scan ──

export interface PermissionScan {
  timelineRef: TimelineEntry[];
  hasPending: boolean;
  hasInline: boolean;
  pendingTools: Array<{ tool: BusToolItem; requestId: string }>;
}

export function getPermissionScanImpl(
  store: PermissionHandlerAPI,
  cached: PermissionScan | null,
): PermissionScan {
  if (cached && cached.timelineRef === store.timeline) {
    return cached;
  }
  let hasPending = false;
  let hasInline = false;
  const toolMap = new Map<string, BusToolItem>();

  const walk = (entries: TimelineEntry[]) => {
    for (const entry of entries) {
      if (entry.kind !== "tool") continue;
      if (entry.tool.status === "permission_prompt" && entry.tool.permission_request_id) {
        hasPending = true;
        const name = entry.tool.tool_name;
        if (name === "AskUserQuestion" || name === "ExitPlanMode") {
          hasInline = true;
        } else {
          const rid = entry.tool.permission_request_id;
          toolMap.delete(rid);
          toolMap.set(rid, entry.tool);
        }
      }
      if (entry.subTimeline) walk(entry.subTimeline);
    }
  };
  walk(store.timeline);

  return {
    timelineRef: store.timeline,
    hasPending,
    hasInline,
    pendingTools: Array.from(toolMap, ([requestId, tool]) => ({ tool, requestId })),
  };
}

// ── resolveAskQuestion ──

export function resolveAskQuestionImpl(
  store: PermissionHandlerAPI,
  toolUseId: string,
  answer: string,
): void {
  dbg("store", "resolveAskQuestion", { toolUseId, answer });
  const tIdx = store._findToolIdx(null, toolUseId);
  if (tIdx >= 0) {
    const old = store.timeline[tIdx] as Extract<TimelineEntry, { kind: "tool" }>;
    const u = [...store.timeline];
    u[tIdx] = { ...old, tool: { ...old.tool, status: "success", output: { answer } } };
    store.timeline = u;
  }
  // Mirror to tools[] only in non-stream mode
  if (!store.useStreamSession) {
    const hIdx = store._findHeIdx(null, toolUseId);
    if (hIdx >= 0) {
      const u = [...store.tools];
      u[hIdx] = { ...u[hIdx], status: "done", hook_type: "PostToolUse" };
      store.tools = u;
    }
  }
}

// ── answerToolQuestion ──

export async function answerToolQuestionImpl(
  store: PermissionHandlerAPI & {
    resolveAskQuestion(toolUseId: string, answer: string): void;
  },
  toolUseId: string,
  answer: string,
): Promise<void> {
  if (!store.run) return;
  dbg("store", "tool answer", { toolUseId, answer });
  // Transition UI immediately
  store.resolveAskQuestion(toolUseId, answer);
  try {
    // Send the user's answer as a follow-up message.
    if (store.sessionAlive) {
      await api.sendSessionMessage(store.run.id, answer);
    } else {
      dbgWarn("store", "session not alive for tool answer, skipping send");
    }
  } catch (e) {
    dbgWarn("store", "tool answer failed:", e);
    store.error = String(e);
    throw e;
  }
}

// ── _resolvePermission ──

export function resolvePermissionImpl(
  store: { timeline: TimelineEntry[] },
  action: "allow" | "deny",
  requestId: string,
): void {
  dbg("store", `resolvePermission${action === "allow" ? "Allow" : "Deny"}`, { requestId });
  const targetStatus = action === "allow" ? ("running" as const) : ("permission_denied" as const);
  const skipAsk = action === "allow";
  let changed = false;
  const u = [...store.timeline];
  for (let i = 0; i < u.length; i++) {
    const entry = u[i];
    if (entry.kind !== "tool") continue;
    if (
      entry.tool.status === "permission_prompt" &&
      entry.tool.permission_request_id === requestId
    ) {
      if (!(skipAsk && entry.tool.tool_name === "AskUserQuestion")) {
        u[i] = { ...entry, tool: { ...entry.tool, status: targetStatus } };
        changed = true;
      }
    }
    if (entry.subTimeline) {
      let subChanged = false;
      const newSub = [...entry.subTimeline];
      for (let j = 0; j < newSub.length; j++) {
        const sub = newSub[j];
        if (
          sub.kind === "tool" &&
          sub.tool.status === "permission_prompt" &&
          sub.tool.permission_request_id === requestId &&
          !(skipAsk && sub.tool.tool_name === "AskUserQuestion")
        ) {
          newSub[j] = { ...sub, tool: { ...sub.tool, status: targetStatus } };
          subChanged = true;
        }
      }
      if (subChanged) {
        u[i] = { ...u[i], subTimeline: newSub } as TimelineEntry;
        changed = true;
      }
    }
  }
  if (changed) store.timeline = u;
}
