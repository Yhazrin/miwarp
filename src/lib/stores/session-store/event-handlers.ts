/**
 * BusEvent reducer chain extracted from SessionStore.
 *
 * Contains `_reduceMessage`, `_reduceTool`, the default switch cases
 * (`session_init`, `run_state`, `permission_prompt`, `raw`), and the
 * top-level `_reduce` dispatcher.
 *
 * All functions take a `ReduceStore` parameter that captures the store
 * surface needed by reducers — the SessionStore class satisfies this
 * interface structurally.
 *
 * @module event-handlers
 */
import type { BusEvent, BusToolItem, HookEvent, TimelineEntry, CliCommand } from "$lib/types";
import type { SessionPhase } from "../types";
import type { ReduceCtx } from "../reducers/types";
import type { SessionStoreReducers } from "../reducers/types";
import { REDUCERS } from "../reducers";
import { eventTs, eventTsMs } from "$lib/utils/event-ts";
import { uuid } from "$lib/utils/uuid";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { dispatchLiveBusSound } from "$lib/services/sound-feedback-service";
import { updateInstalledVersion } from "../cli-info.svelte";
import { dedupeMcpServersByName } from "$lib/utils/mcp";
import { LS_CLI_VERSION } from "$lib/utils/storage-keys";
import * as api from "$lib/api";
import * as snapshotCache from "$lib/utils/snapshot-cache";
import {
  findParentToolIdx,
  appendToSubTimeline,
  updateSubTimelineTool,
  accumulateJsonInput,
} from "./timeline-helpers";

// ── CLI permission mode normalization ──
const CLI_PERM_MODE_ALIASES: Record<string, string> = {
  delegate: "acceptEdits",
};

function normalizePermissionMode(mode: string): string {
  return CLI_PERM_MODE_ALIASES[mode] ?? mode;
}

// ── Extended store interface for the reduce chain ──

/**
 * Extends SessionStoreReducers with additional fields and methods needed
 * by the reduce chain but not by the domain-specific reducers.
 */
export interface ReduceStore extends SessionStoreReducers {
  // Override readonly properties that the reduce chain needs to write in live mode
  streamingText: string;
  thinkingText: string;
  error: string;
  _clearTimeoutError(): void;
  _clearStreamingState(ctx: ReduceCtx | null): void;
  thinkingStartMs: number;
  thinkingEndMs: number;
  _patchAssistantContentIfEmpty(ctx: ReduceCtx | null, messageId: string, content: string): boolean;
  _appendSubTimelineStreamingDelta(
    parentToolUseId: string,
    field: "content" | "thinkingText",
    text: string,
    ctx: ReduceCtx | null,
  ): void;
  _extractSubTimelineThinking(parentToolUseId: string, ctx: ReduceCtx | null): string | undefined;
  _removeSubTimelineStreamingEntry(parentToolUseId: string, ctx: ReduceCtx | null): void;
  _extractSubTimelineStreamingContent(parentToolUseId: string, ctx: ReduceCtx | null): string;
  previousPermissionMode: string;
  pendingPermissionModeOverride: string | null;
  pendingClearContextPlan: string | null;
  // Override return types from void to boolean for the reduce chain
  _updateSubTimelineTool(
    parentToolUseId: string,
    childToolUseId: string,
    updater: (old: BusToolItem) => BusToolItem,
    ctx: ReduceCtx | null,
  ): boolean;
  _updateToolInAnySubTimeline(
    toolUseId: string,
    updater: (old: BusToolItem) => BusToolItem,
    ctx: ReduceCtx | null,
  ): boolean;
}

// ── Helpers ──

function getTl(ctx: ReduceCtx | null, store: ReduceStore): TimelineEntry[] {
  return ctx ? ctx.tl : store.timeline;
}

function getHe(ctx: ReduceCtx | null, store: ReduceStore): HookEvent[] {
  return ctx ? ctx.he : store.tools;
}

function getSeenMsg(ctx: ReduceCtx | null, store: ReduceStore): Set<string> {
  return ctx ? ctx.seenMessageIds : store._seenMessageIds;
}

function getSeenTool(ctx: ReduceCtx | null, store: ReduceStore): Set<string> {
  return ctx ? ctx.seenToolIds : store._seenToolIds;
}

// ── Message/Streaming reducer ──

/**
 * Handle message/streaming events: message_delta, thinking_delta, tool_input_delta,
 * message_complete. Returns true if the event was handled.
 */
export function reduceMessage(ev: BusEvent, ctx: ReduceCtx | null, store: ReduceStore): boolean {
  const tl = getTl(ctx, store);
  const seenMsg = getSeenMsg(ctx, store);

  switch (ev.type) {
    case "message_delta": {
      store._clearTimeoutError();
      if (ev.parent_tool_use_id) {
        store._appendSubTimelineStreamingDelta(ev.parent_tool_use_id, "content", ev.text, ctx);
        return true;
      }
      if (store.thinkingStartMs && !store.thinkingEndMs) {
        store.thinkingEndMs = eventTsMs(ev);
      }
      if (ctx) ctx.streamText += ev.text;
      else store.streamingText += ev.text;
      return true;
    }
    case "thinking_delta": {
      store._clearTimeoutError();
      if (ev.parent_tool_use_id) {
        store._appendSubTimelineStreamingDelta(ev.parent_tool_use_id, "thinkingText", ev.text, ctx);
        return true;
      }
      if (!store.thinkingStartMs) store.thinkingStartMs = eventTsMs(ev);
      if (ctx) ctx.thinkingText += ev.text;
      else store.thinkingText += ev.text;
      return true;
    }
    case "tool_input_delta": {
      if (ev.parent_tool_use_id) {
        const pIdx = findParentToolIdx(
          tl,
          ctx ? ctx.toolTlIndex : store._toolTlIndex,
          ev.parent_tool_use_id,
        );
        if (pIdx >= 0) {
          updateSubTimelineTool(
            tl,
            ctx ? ctx.toolTlIndex : store._toolTlIndex,
            ev.parent_tool_use_id,
            ev.tool_use_id,
            (t) => {
              const accum = accumulateJsonInput(t as Record<string, unknown>, ev.partial_json);
              return { ...t, ...accum } as typeof t;
            },
          );
        }
        return true;
      }
      const tIdx = store._findToolIdx(ctx, ev.tool_use_id);
      if (tIdx >= 0) {
        const old = tl[tIdx] as Extract<TimelineEntry, { kind: "tool" }>;
        const accum = accumulateJsonInput(old.tool as Record<string, unknown>, ev.partial_json);
        const updated: TimelineEntry = {
          ...old,
          tool: { ...old.tool, ...accum } as typeof old.tool,
        };
        if (ctx) ctx.tl[tIdx] = updated;
        else {
          const u = [...store.timeline];
          u[tIdx] = updated;
          store.timeline = u;
        }
      }
      return true;
    }
    case "message_complete": {
      const savedStreaming = ctx ? ctx.streamText : store.streamingText;
      const finalText = ev.text && ev.text.length > 0 ? ev.text : savedStreaming;
      if (seenMsg.has(ev.message_id)) {
        store._patchAssistantContentIfEmpty(ctx, ev.message_id, finalText);
        if (ev.parent_tool_use_id)
          store._removeSubTimelineStreamingEntry(ev.parent_tool_use_id, ctx);
        if (!ev.parent_tool_use_id) store._clearStreamingState(ctx);
        return true;
      }
      const existingAssistant = tl.find((e) => e.kind === "assistant" && e.id === ev.message_id);
      if (existingAssistant) {
        store._patchAssistantContentIfEmpty(ctx, ev.message_id, finalText);
        if (ev.parent_tool_use_id)
          store._removeSubTimelineStreamingEntry(ev.parent_tool_use_id, ctx);
        seenMsg.add(ev.message_id);
        if (!ev.parent_tool_use_id) store._clearStreamingState(ctx);
        return true;
      }
      seenMsg.add(ev.message_id);
      if (ev.parent_tool_use_id) {
        const subThinking = store._extractSubTimelineThinking(ev.parent_tool_use_id, ctx);
        const subStreaming = store._extractSubTimelineStreamingContent(ev.parent_tool_use_id, ctx);
        const subFinalText = finalText.trim() ? finalText : subStreaming;
        store._removeSubTimelineStreamingEntry(ev.parent_tool_use_id, ctx);
        const entry: TimelineEntry = {
          kind: "assistant",
          id: ev.message_id,
          anchorId: ev.message_id,
          content: subFinalText,
          ts: eventTs(ev),
          ...(ev.model ? { model: ev.model } : {}),
          ...(subThinking ? { thinkingText: subThinking } : {}),
        };
        const parentIdx = findParentToolIdx(
          tl,
          ctx ? ctx.toolTlIndex : store._toolTlIndex,
          ev.parent_tool_use_id,
        );
        if (parentIdx >= 0) {
          if (ctx) {
            appendToSubTimeline(ctx.tl, parentIdx, entry);
          } else {
            const cloned = [...store.timeline];
            appendToSubTimeline(cloned, parentIdx, entry);
            store.timeline = cloned;
          }
          return true;
        }
        store._pushTimeline(ctx, entry);
        return true;
      }
      const savedThinking = ctx ? ctx.thinkingText : store.thinkingText;
      store._clearStreamingState(ctx);
      const entry: TimelineEntry = {
        kind: "assistant",
        id: ev.message_id,
        anchorId: ev.message_id,
        content: finalText,
        ts: eventTs(ev),
        ...(ev.model ? { model: ev.model } : {}),
        ...(savedThinking ? { thinkingText: savedThinking } : {}),
      };
      store._pushTimeline(ctx, entry);
      return true;
    }
    default:
      return false;
  }
}

// ── Tool lifecycle reducer ──

/**
 * Handle tool lifecycle events: tool_start, tool_end. Returns true if handled.
 */
export function reduceTool(
  ev: BusEvent,
  ctx: ReduceCtx | null,
  store: ReduceStore,
  replayOnly: boolean,
): boolean {
  const tl = getTl(ctx, store);
  const he = getHe(ctx, store);
  const seenTool = getSeenTool(ctx, store);

  switch (ev.type) {
    case "tool_start": {
      store._clearTimeoutError();
      if (seenTool.has(ev.tool_use_id)) return true;
      seenTool.add(ev.tool_use_id);
      if (ev.parent_tool_use_id) {
        const parentIdx = store._findParentToolIdx(ctx, ev.parent_tool_use_id);
        if (parentIdx >= 0) {
          const subEntry: TimelineEntry = {
            kind: "tool",
            id: ev.tool_use_id,
            anchorId: ev.tool_use_id,
            tool: {
              tool_use_id: ev.tool_use_id,
              tool_name: ev.tool_name,
              input: (ev.input as Record<string, unknown>) ?? {},
              status: "running",
            },
            ts: eventTs(ev),
          };
          if (ctx) {
            appendToSubTimeline(ctx.tl, parentIdx, subEntry);
          } else {
            const cloned = [...store.timeline];
            appendToSubTimeline(cloned, parentIdx, subEntry);
            store.timeline = cloned;
          }
          return true;
        }
      }
      if (store._findToolIdx(ctx, ev.tool_use_id) >= 0) return true;
      const tlEntry: TimelineEntry = {
        kind: "tool",
        id: ev.tool_use_id,
        anchorId: ev.tool_use_id,
        tool: {
          tool_use_id: ev.tool_use_id,
          tool_name: ev.tool_name,
          input: (ev.input as Record<string, unknown>) ?? {},
          status: "running",
        },
        ts: eventTs(ev),
      };
      store._pushTimeline(ctx, tlEntry);
      if (!store._isStreamMode(ctx)) {
        const heEntry: HookEvent = {
          run_id: ev.run_id,
          hook_type: "PreToolUse",
          tool_name: ev.tool_name,
          tool_input: ev.input as Record<string, unknown>,
          status: "running",
          timestamp: new Date().toISOString(),
        };
        (heEntry as Record<string, unknown>).tool_use_id = ev.tool_use_id;
        store._pushHookEntry(ctx, heEntry);
      }
      return true;
    }
    case "tool_end": {
      if (!replayOnly) dispatchLiveBusSound(ev);
      const isAskUser = ev.tool_name === "AskUserQuestion";
      const resolvedStatus =
        isAskUser && ev.status === "error"
          ? ("ask_pending" as const)
          : ev.status === "error"
            ? ("error" as const)
            : ("success" as const);
      if (ev.parent_tool_use_id) {
        if (
          store._updateSubTimelineTool(
            ev.parent_tool_use_id,
            ev.tool_use_id,
            (t) => ({
              ...t,
              status: resolvedStatus,
              output: ev.output as Record<string, unknown>,
              duration_ms: ev.duration_ms,
              tool_name: ev.tool_name || t.tool_name,
              tool_use_result: ev.tool_use_result as Record<string, unknown> | undefined,
            }),
            ctx,
          )
        )
          return true;
      }
      const tIdx = store._findToolIdx(ctx, ev.tool_use_id);
      if (tIdx >= 0) {
        const old = tl[tIdx] as Extract<TimelineEntry, { kind: "tool" }>;
        const updated: TimelineEntry = {
          ...old,
          tool: {
            ...old.tool,
            status: resolvedStatus,
            output: ev.output as Record<string, unknown>,
            duration_ms: ev.duration_ms,
            tool_name: ev.tool_name || old.tool.tool_name,
            tool_use_result: ev.tool_use_result as Record<string, unknown> | undefined,
          },
        };
        if (ctx) ctx.tl[tIdx] = updated;
        else {
          const u = [...store.timeline];
          u[tIdx] = updated;
          store.timeline = u;
        }
      }
      if (!replayOnly && ev.status !== "error" && !ev.parent_tool_use_id) {
        if (ev.tool_name === "EnterPlanMode") {
          store.previousPermissionMode = store.permissionMode || "default";
          store.permissionMode = "plan";
        } else if (ev.tool_name === "ExitPlanMode" && store.previousPermissionMode) {
          if (store.pendingPermissionModeOverride) {
            store.permissionMode = store.pendingPermissionModeOverride;
            store.pendingPermissionModeOverride = null;
          } else {
            store.permissionMode = store.previousPermissionMode;
          }
          store.previousPermissionMode = "";
          if (store.pendingClearContextPlan === "__pending__") {
            const toolResult = ev.tool_use_result as Record<string, unknown> | undefined;
            const plan =
              (ev.output as Record<string, unknown> | undefined)?.plan || toolResult?.plan;
            if (plan && typeof plan === "string") store.pendingClearContextPlan = plan;
            else store.pendingClearContextPlan = null;
          }
        }
      }
      if (!isAskUser && !store._isStreamMode(ctx)) {
        const hIdx = store._findHeIdxByStatus(ctx, ev.tool_use_id, "running");
        if (hIdx >= 0) {
          const updatedHe: HookEvent = {
            ...he[hIdx],
            status: "done",
            hook_type: "PostToolUse",
            tool_name: ev.tool_name || he[hIdx].tool_name,
            tool_output: ev.output as Record<string, unknown>,
          };
          if (ctx) ctx.he[hIdx] = updatedHe;
          else {
            const u = [...store.tools];
            u[hIdx] = updatedHe;
            store.tools = u;
          }
        }
      }
      return true;
    }
    default:
      return false;
  }
}

// ── Default switch cases (session_init, run_state, permission_prompt, raw) ──

/**
 * Handle events not covered by message/tool reducers or the registry.
 * This is the "default" branch of the original _reduce switch.
 */
export function reduceDefault(
  ev: BusEvent,
  ctx: ReduceCtx | null,
  store: ReduceStore,
  replayOnly: boolean,
): boolean {
  switch (ev.type) {
    case "session_init": {
      if (ev.model) {
        if (ctx) {
          ctx.model = ev.model;
        } else if (!store.run?.model) {
          store._setModel(ev.model);
        }
      }
      if (ev.session_id) {
        if (ctx) ctx.sessionId = ev.session_id;
        else if (store.run) {
          dbg("store", "session_init: updating session_id", {
            old: store.run.session_id,
            new: ev.session_id,
          });
          store.run = { ...store.run, session_id: ev.session_id };
        }
      }
      if (ev.slash_commands && ev.slash_commands.length > 0) {
        store.sessionCommands = ev.slash_commands.map((c: unknown) =>
          typeof c === "string"
            ? { name: c, description: "", aliases: [] as string[] }
            : {
                name: (c as CliCommand).name,
                description: (c as CliCommand).description,
                aliases: (c as CliCommand).aliases ?? [],
              },
        );
      }
      if (ev.mcp_servers && ev.mcp_servers.length > 0) {
        store.mcpServers = dedupeMcpServersByName(ev.mcp_servers);
      }
      if (ev.claude_code_version) {
        store.cliVersion = ev.claude_code_version;
        if (!replayOnly) {
          updateInstalledVersion(ev.claude_code_version);
          try {
            localStorage.setItem(LS_CLI_VERSION, ev.claude_code_version);
          } catch {
            /* ignore */
          }
        }
      }
      const normalizedPermMode = ev.permissionMode
        ? normalizePermissionMode(ev.permissionMode)
        : undefined;
      if (normalizedPermMode && !store.permissionModeSetByUser) {
        store.permissionMode = normalizedPermMode;
      } else if (normalizedPermMode && store.permissionModeSetByUser) {
        dbg("store", "session_init permissionMode skipped — user already set", {
          cliValue: normalizedPermMode,
          userValue: store.permissionMode,
        });
        if (!ctx && store.run?.id && normalizedPermMode !== store.permissionMode) {
          dbg("store", "resync permissionMode to CLI after compaction", {
            mode: store.permissionMode,
          });
          api.setPermissionMode(store.run.id, store.permissionMode).catch((e) => {
            dbgWarn("store", "permissionMode resync failed", e);
          });
        }
      }
      if (ev.fast_mode_state) store.fastModeState = ev.fast_mode_state;
      if (ev.apiKeySource) store.apiKeySource = ev.apiKeySource;
      if (ev.agents && ev.agents.length > 0) store.availableAgents = ev.agents;
      if (ev.skills && ev.skills.length > 0) store.availableSkills = ev.skills;
      if (ev.plugins) store.availablePlugins = ev.plugins;
      store.sessionCwd = ev.cwd ?? "";
      store.sessionTools = ev.tools ?? [];
      store.outputStyle = ev.output_style ?? "";
      store.sessionInitReceived = true;
      dbg("store", "session_init: cli verbose fields", {
        cliVersion: store.cliVersion,
        permissionMode: store.permissionMode,
        fastModeState: store.fastModeState,
        apiKeySource: store.apiKeySource,
        agents: store.availableAgents.length,
        skills: store.availableSkills.length,
        plugins: store.availablePlugins.length,
        sessionCwd: store.sessionCwd,
        sessionTools: store.sessionTools.length,
        outputStyle: store.outputStyle,
      });
      return true;
    }

    case "run_state": {
      if (!replayOnly) dispatchLiveBusSound(ev);
      if (!replayOnly) {
        if (ev.state === "running" || ev.state === "spawning") {
          const newPhase: SessionPhase = ev.state === "spawning" ? "spawning" : "running";
          if (ctx) ctx.phase = newPhase;
          else store._setPhase(newPhase);
          if (!ctx && store.run) {
            snapshotCache
              .deleteSnapshot(store.run.id)
              .catch((e) => dbgWarn("snapshot", "delete failed", e));
          }
        } else if (ev.state === "idle") {
          if (ctx) ctx.phase = "idle";
          else store._setPhase("idle");
        } else {
          const termPhase = ev.state as SessionPhase;
          if (ctx) ctx.phase = termPhase;
          else {
            store._setPhase(termPhase);
            if (store.run) {
              const snapId = store.run.id;
              api
                .getRun(snapId)
                .then((r) => {
                  if (store.run?.id === snapId) store.run = r;
                  import("$lib/services/notification-listener")
                    .then((m) => m.cacheRun(r))
                    .catch((e) => dbgWarn("store", "cacheRun after terminal failed:", e));
                })
                .catch((e) => dbgWarn("store", "getRun after terminal state failed:", e));
            }
          }
        }
        if (ev.state === "running" || ev.state === "idle") {
          if (ctx) ctx.runStatus = ev.state;
          else if (store.run) store.run = { ...store.run, status: ev.state };
        }
      }
      if (!replayOnly && ev.error && ev.state !== "stopped" && !store._stopping) {
        if (ctx) ctx.error = ev.error;
        else store.error = ev.error;
      }
      if (ev.state === "idle") {
        store._resolveStaleTools(
          (t) =>
            t.status === "permission_prompt" ||
            (t.status === "running" && !!t.permission_request_id),
          ctx,
        );
        store._materializeOrphanStreamingOnIdle(ctx, ev, replayOnly, () => getTl(ctx, store));
        if (!replayOnly) {
          store._clearStreamingState(ctx);
          store._needsIdleHealthCheck = true;
        }
        dbg("store", "run_state idle", {
          runId: ev.run_id,
          streamingTextLen: ctx ? ctx.streamText.length : store.streamingText.length,
          timelineLen: getTl(ctx, store).length,
        });
        if (!ctx && !replayOnly && store.run) {
          if (store._lastProcessedSeq > store._lastSnapshotSeq) {
            store._saveSnapshotToIdb(store.run.id);
            store._lastSnapshotSeq = store._lastProcessedSeq;
          }
        }
      }
      if (ev.state === "spawning") {
        store._resolveStaleTools(
          (t) =>
            t.status === "permission_denied" ||
            t.status === "permission_prompt" ||
            (t.status === "running" && !!t.permission_request_id),
          ctx,
        );
      }
      if (
        ev.state === "idle" ||
        ev.state === "spawning" ||
        ev.state === "completed" ||
        ev.state === "failed" ||
        ev.state === "stopped"
      ) {
        if (store.pendingElicitations.size > 0) {
          dbg("store", "run_state clearing stale elicitations", {
            state: ev.state,
            count: store.pendingElicitations.size,
          });
          store.pendingElicitations = new Map();
        }
      }
      return true;
    }

    case "permission_prompt": {
      if (!replayOnly) dispatchLiveBusSound(ev);
      dbg("store", "permission_prompt received", {
        tool_use_id: ev.tool_use_id,
        request_id: ev.request_id,
        tool_name: ev.tool_name,
        parent: ev.parent_tool_use_id,
        batch: !!ctx,
      });
      if (ev.parent_tool_use_id) {
        if (
          store._updateSubTimelineTool(
            ev.parent_tool_use_id,
            ev.tool_use_id,
            (t) => ({
              ...t,
              status: "permission_prompt" as const,
              permission_request_id: ev.request_id,
              ...(ev.suggestions && ev.suggestions.length > 0
                ? { suggestions: ev.suggestions }
                : {}),
            }),
            ctx,
          )
        ) {
          return true;
        }
        dbgWarn(
          "store",
          "subagent permission_prompt: not found in subTimeline, fallback to main timeline",
          { parent: ev.parent_tool_use_id, tool: ev.tool_use_id },
        );
      }
      const tl = getTl(ctx, store);
      const tIdx = store._findToolIdx(ctx, ev.tool_use_id);
      if (tIdx >= 0) {
        const old = tl[tIdx] as Extract<TimelineEntry, { kind: "tool" }>;
        const updated: TimelineEntry = {
          ...old,
          tool: {
            ...old.tool,
            status: "permission_prompt",
            permission_request_id: ev.request_id,
            ...(ev.suggestions && ev.suggestions.length > 0 ? { suggestions: ev.suggestions } : {}),
          },
        };
        if (ctx) {
          ctx.tl[tIdx] = updated;
        } else {
          const u = [...store.timeline];
          u[tIdx] = updated;
          store.timeline = u;
        }
        dbg("store", "permission_prompt: updated existing entry", {
          tIdx,
          tool_use_id: ev.tool_use_id,
          request_id: ev.request_id,
        });
      } else {
        const foundInSub = store._updateToolInAnySubTimeline(
          ev.tool_use_id,
          (t) => ({
            ...t,
            status: "permission_prompt" as const,
            permission_request_id: ev.request_id,
            ...(ev.suggestions && ev.suggestions.length > 0 ? { suggestions: ev.suggestions } : {}),
          }),
          ctx,
        );
        if (!foundInSub) {
          dbg("store", "permission_prompt: creating synthetic entry", {
            tool_use_id: ev.tool_use_id,
            request_id: ev.request_id,
            tool_name: ev.tool_name,
          });
          const tlEntry: TimelineEntry = {
            kind: "tool",
            id: ev.tool_use_id,
            anchorId: ev.tool_use_id,
            tool: {
              tool_use_id: ev.tool_use_id,
              tool_name: ev.tool_name,
              input: ev.tool_input as Record<string, unknown>,
              status: "permission_prompt",
              permission_request_id: ev.request_id,
              ...(ev.suggestions && ev.suggestions.length > 0
                ? { suggestions: ev.suggestions }
                : {}),
            },
            ts: eventTs(ev),
          };
          store._pushTimeline(ctx, tlEntry);
        } else {
          dbg("store", "permission_prompt: updated in subTimeline", {
            tool_use_id: ev.tool_use_id,
            request_id: ev.request_id,
          });
        }
      }
      return true;
    }

    case "raw": {
      const rawText = typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data);
      if (rawText && (ev.source === "claude_stdout_text" || ev.source === "claude_stderr")) {
        const rawId = uuid();
        const entry: TimelineEntry = {
          kind: "assistant",
          id: rawId,
          anchorId: rawId,
          content: `\`[${ev.source}]\` ${rawText}`,
          ts: new Date().toISOString(),
        };
        store._pushTimeline(ctx, entry);
      } else {
        store.rawFallbackCount++;
        dbgWarn("store", "raw fallback event:", ev.source, rawText?.slice(0, 100));
        if (store.strictMode) {
          throw new Error(`[STRICT] raw fallback event: source=${ev.source}`);
        }
      }
      return true;
    }

    case "session_recovering":
    case "session_recovered":
    case "protocol_desync":
    case "governor_budget_exceeded":
      return true;

    default:
      return false;
  }
}

// ── Top-level dispatcher ──

/**
 * Core reducer: apply a single bus event. When ctx is null, mutates $state directly.
 * replayOnly=true skips phase and error assignments (used during resume replay).
 */
export function runReduce(
  ev: BusEvent,
  ctx: ReduceCtx | null,
  store: ReduceStore,
  replayOnly: boolean,
): void {
  // Delegate to domain-specific reducers
  if (reduceMessage(ev, ctx, store)) return;
  if (reduceTool(ev, ctx, store, replayOnly)) return;

  // Delegate to registered domain reducers
  const fn = REDUCERS[ev.type as keyof typeof REDUCERS];
  if (fn) {
    fn(ev, ctx, store as unknown as Parameters<typeof fn>[2], replayOnly);
    return;
  }

  // Default switch cases
  if (reduceDefault(ev, ctx, store, replayOnly)) return;

  // Truly unknown event
  store.unknownEventCount++;
  dbgWarn("store", "unknown bus event type:", (ev as Record<string, unknown>).type);
  if (store.strictMode) {
    throw new Error(`[STRICT] unknown event type: ${(ev as Record<string, unknown>).type}`);
  }
}
