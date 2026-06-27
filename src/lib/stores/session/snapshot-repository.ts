/**
 * SnapshotRepository — serialize / restore / persist the SessionStore state
 * snapshot to IndexedDB.
 *
 * Extracted from session-store (Worker-4 P0/P1/P2 refactor, item #3
 * "Snapshot Serialize/Restore"). Pure I/O + serialization. The store hands
 * us a read/write view via `store` so we can rehydrate primitives without
 * reaching into private fields.
 *
 * Invariants:
 * - Large `tool_use_result` fields (>SNAPSHOT_MAX_TOOL_RESULT bytes) are
 *   pruned to a `{_truncated, _size}` placeholder to keep snapshot size
 *   manageable.
 * - User message attachments have their `contentBase64` stripped on save
 *   (images/screenshots already cached separately).
 * - `permissionMode` is intentionally NOT persisted — it is a user-level
 *   preference, not a per-session snapshot field.
 * - Save is fire-and-forget on the idle callback queue; the caller must
 *   already have a generation guard.
 * - Restore performs shape validation; returns false on any mismatch.
 */

import { dbg, dbgWarn } from "$lib/utils/debug";
import * as snapshotCache from "$lib/utils/snapshot-cache";
import { dedupeMcpServersByName } from "$lib/utils/mcp";
import type { TimelineEntry, CliCommand, McpServerInfo, Attachment } from "$lib/types";
import type { UsageState, TurnUsage } from "$lib/stores/types";
import { backfillAnchorId } from "./timeline-projection";

/** Maximum tool_use_result size to serialize (bytes). */
export const SNAPSHOT_MAX_TOOL_RESULT = 50_000;

/**
 * Minimal structural view the repository needs to read from the live
 * SessionStore. Keeping this a structural type avoids the runtime
 * circular import session-store → repository → session-store. We type
 * the hookEvents/tools arrays loosely (`unknown[]`) because the store
 * declares them as `$state` defaults that svelte-check narrows more
 * strictly than this read-side contract needs.
 */
export interface SnapshotReadView {
  timeline: TimelineEntry[];
  tools: unknown[];
  hookEvents: unknown[];
  streamingText: string;
  thinkingText: string;
  model: string;
  usage: UsageState;
  turnUsages: TurnUsage[];
  _seenMessageIds: Set<string>;
  _seenToolIds: Set<string>;
  systemStatus: { status?: string } | null;
  authStatus: { is_authenticating: boolean; output: string[] } | null;
  cliVersion: string;
  fastModeState: string;
  apiKeySource: string;
  sessionCommands: CliCommand[];
  mcpServers: McpServerInfo[];
  sessionTools: string[];
  availableAgents: string[];
  availableSkills: string[];
  availablePlugins: unknown[];
  sessionCwd: string;
  outputStyle: string;
  sessionInitReceived: boolean;
  numTurns: number;
  durationMs: number;
  compactCount: number;
  microcompactCount: number;
  persistedFiles: unknown[];
  unknownEventCount: number;
  rawFallbackCount: number;
  taskNotifications: Map<string, unknown>;
  _lastProcessedSeq: number;
}

/**
 * Writable view for restore. The store's typed `$state` fields are
 * accessible through this surface; we write directly to keep one
 * `$state`-awareness boundary. Same looseness as SnapshotReadView for
 * the hook-shaped arrays.
 */
export interface SnapshotWriteView {
  timeline: TimelineEntry[];
  tools: unknown[];
  hookEvents: unknown[];
  streamingText: string;
  thinkingText: string;
  model: string;
  usage: UsageState;
  turnUsages: TurnUsage[];
  _seenMessageIds: Set<string>;
  _seenToolIds: Set<string>;
  systemStatus: { status?: string } | null;
  authStatus: { is_authenticating: boolean; output: string[] } | null;
  cliVersion: string;
  fastModeState: string;
  apiKeySource: string;
  sessionCommands: CliCommand[];
  mcpServers: McpServerInfo[];
  sessionTools: string[];
  availableAgents: string[];
  availableSkills: string[];
  availablePlugins: unknown[];
  sessionCwd: string;
  outputStyle: string;
  sessionInitReceived: boolean;
  numTurns: number;
  durationMs: number;
  compactCount: number;
  microcompactCount: number;
  persistedFiles: unknown[];
  unknownEventCount: number;
  rawFallbackCount: number;
  taskNotifications: Map<string, unknown>;
  _lastProcessedSeq: number;
  _toolTlIndex: Map<string, number>;
  _toolHeIndex: Map<string, number>;
}

/** Build a JSON snapshot of current store state. */
export function buildSnapshot(store: SnapshotReadView): string {
  const prunedTimeline = store.timeline.map((entry) => {
    if (entry.kind === "user" && entry.attachments?.length) {
      return {
        ...entry,
        attachments: (entry.attachments as Attachment[]).map((a) => ({
          name: a.name,
          type: a.type,
          size: a.size,
        })),
      };
    }
    if (entry.kind !== "tool") return entry;
    const tur = entry.tool.tool_use_result;
    if (tur && typeof tur === "object") {
      const size = JSON.stringify(tur).length;
      if (size > SNAPSHOT_MAX_TOOL_RESULT) {
        return {
          ...entry,
          tool: {
            ...entry.tool,
            tool_use_result: { _truncated: true, _size: size },
          },
        };
      }
    }
    return entry;
  });

  const obj: Record<string, unknown> = {
    timeline: prunedTimeline,
    tools: store.tools,
    hookEvents: store.hookEvents,
    streamingText: store.streamingText,
    thinkingText: store.thinkingText,
    model: store.model,
    usage: store.usage,
    turnUsages: store.turnUsages,
    _seenMessageIds: [...store._seenMessageIds],
    _seenToolIds: [...store._seenToolIds],
    systemStatus: store.systemStatus,
    authStatus: store.authStatus,
    cliVersion: store.cliVersion,
    // permissionMode intentionally excluded — user-level preference.
    fastModeState: store.fastModeState,
    apiKeySource: store.apiKeySource,
    sessionCommands: store.sessionCommands,
    mcpServers: store.mcpServers,
    sessionTools: store.sessionTools,
    availableAgents: store.availableAgents,
    availableSkills: store.availableSkills,
    availablePlugins: store.availablePlugins,
    sessionCwd: store.sessionCwd,
    outputStyle: store.outputStyle,
    sessionInitReceived: store.sessionInitReceived,
    numTurns: store.numTurns,
    durationMs: store.durationMs,
    compactCount: store.compactCount,
    microcompactCount: store.microcompactCount,
    persistedFiles: store.persistedFiles,
    unknownEventCount: store.unknownEventCount,
    rawFallbackCount: store.rawFallbackCount,
    taskNotifications: [...store.taskNotifications.entries()],
    _lastProcessedSeq: store._lastProcessedSeq,
  };
  return JSON.stringify(obj);
}

/** Parse snapshot body string. Returns parsed object or null if invalid JSON. */
export function parseSnapshotBody(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Apply a parsed snapshot object onto the store. Returns true on success. */
export function applySnapshot(
  store: SnapshotWriteView,
  bodyOrObj: string | Record<string, unknown>,
): boolean {
  try {
    const obj =
      typeof bodyOrObj === "string"
        ? (JSON.parse(bodyOrObj) as Record<string, unknown>)
        : bodyOrObj;
    if (!Array.isArray(obj.timeline) || typeof obj.usage !== "object" || obj.usage === null) {
      dbgWarn("snapshot", "apply:shape-fail", {
        hasTimeline: Array.isArray(obj.timeline),
        hasUsage: typeof obj.usage,
      });
      return false;
    }

    store.timeline = (obj.timeline as TimelineEntry[]).map(backfillAnchorId);
    store.tools = (obj.tools ?? []) as unknown[];
    store.hookEvents = (obj.hookEvents ?? []) as unknown[];
    store.streamingText = (obj.streamingText as string) ?? "";
    store.thinkingText = (obj.thinkingText as string) ?? "";
    store.model = (obj.model as string) ?? "";
    store.usage = obj.usage as UsageState;
    store.turnUsages = (obj.turnUsages ?? []) as TurnUsage[];
    store._seenMessageIds = new Set((obj._seenMessageIds ?? []) as string[]);
    store._seenToolIds = new Set((obj._seenToolIds ?? []) as string[]);

    store.systemStatus = (obj.systemStatus as { status?: string } | null) ?? null;
    store.authStatus =
      (obj.authStatus as { is_authenticating: boolean; output: string[] } | null) ?? null;
    store.cliVersion = (obj.cliVersion as string) ?? "";
    // permissionMode intentionally NOT restored.
    store.fastModeState = (obj.fastModeState as string) ?? "";
    store.apiKeySource = (obj.apiKeySource as string) ?? "";
    store.sessionCommands = (obj.sessionCommands ?? []) as CliCommand[];
    store.mcpServers = dedupeMcpServersByName((obj.mcpServers ?? []) as McpServerInfo[]);
    store.sessionTools = (obj.sessionTools ?? []) as string[];
    store.availableAgents = (obj.availableAgents ?? []) as string[];
    store.availableSkills = (obj.availableSkills ?? []) as string[];
    store.availablePlugins = (obj.availablePlugins ?? []) as unknown[];
    store.sessionCwd = (obj.sessionCwd as string) ?? "";
    store.outputStyle = (obj.outputStyle as string) ?? "";
    store.sessionInitReceived = (obj.sessionInitReceived as boolean) ?? false;
    store.numTurns = (obj.numTurns as number) ?? 0;
    store.durationMs = (obj.durationMs as number) ?? 0;
    store.compactCount = (obj.compactCount as number) ?? 0;
    store.microcompactCount = (obj.microcompactCount as number) ?? 0;
    store.persistedFiles = (obj.persistedFiles ?? []) as unknown[];
    store.unknownEventCount = (obj.unknownEventCount as number) ?? 0;
    store.rawFallbackCount = (obj.rawFallbackCount as number) ?? 0;
    store.taskNotifications = new Map((obj.taskNotifications ?? []) as Array<[string, unknown]>);
    store._lastProcessedSeq = (obj._lastProcessedSeq as number) ?? 0;

    // Rebuild runtime tool indexes from restored state.
    store._toolTlIndex.clear();
    for (let i = 0; i < store.timeline.length; i++) {
      const e = store.timeline[i];
      if (e.kind === "tool" && !store._toolTlIndex.has(e.id)) {
        store._toolTlIndex.set(e.id, i);
      }
    }
    store._toolHeIndex.clear();
    for (let i = 0; i < store.tools.length; i++) {
      const tid = (store.tools[i] as Record<string, unknown>).tool_use_id as string | undefined;
      if (tid && !store._toolHeIndex.has(tid)) store._toolHeIndex.set(tid, i);
    }

    dbg("snapshot", "apply:ok", { timeline: store.timeline.length });
    return true;
  } catch (err) {
    dbgWarn("snapshot", "apply:error", err);
    return false;
  }
}

export interface SaveSnapshotGuard {
  /** True when the load generation captured at save start is still current. */
  isStale(): boolean;
  /** True when the current run id still matches the captured id. */
  matchesRun(): boolean;
  /** Returns the current run status to compare with the captured one. */
  currentStatus(): string | undefined;
}

/**
 * Persist the current store state to IDB. Defers the JSON.stringify to the
 * next idle slot so it does not block `loadRun`. The caller is responsible
 * for the generation guard and for capturing `runStatus` before scheduling.
 */
export function saveSnapshotToIdb(
  store: SnapshotReadView,
  runId: string,
  runStatus: string,
  guard: SaveSnapshotGuard,
): void {
  const doSave = () => {
    if (guard.isStale() || !guard.matchesRun()) return;
    if (guard.currentStatus() !== runStatus) {
      dbg("snapshot", "save:skipped (status changed)", {
        runId,
        expected: runStatus,
        actual: guard.currentStatus(),
      });
      return;
    }
    const body = buildSnapshot(store);
    dbg("snapshot", "save", { runId, runStatus, bytes: body.length });
    snapshotCache
      .writeSnapshot(runId, runStatus, body)
      .catch((e) => dbgWarn("snapshot", "write failed", e));
  };
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(doSave, { timeout: 2000 });
  } else {
    setTimeout(doSave, 50);
  }
}
