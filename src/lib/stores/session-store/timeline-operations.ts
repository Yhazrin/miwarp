/**
 * Timeline and nested-tool operations owned by SessionStore.
 *
 * Keeping these mutations together makes the reducer-facing surface explicit
 * without coupling the core store to the details of sub-timeline updates.
 */
import type {
  Attachment,
  BusEvent,
  BusToolItem,
  HookEvent,
  TaskRun,
  TimelineEntry,
} from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { eventTs } from "$lib/utils/event-ts";
import { uuid } from "$lib/utils/uuid";
import type { UsageState } from "../types";
import { timelineAttachments } from "../session/timeline-projection";
import type { ReduceCtx } from "../reducers/types";
import {
  appendSubTimelineStreamingDelta,
  appendToSubTimeline,
  extractSubTimelineStreamingContent,
  extractSubTimelineThinking,
  findHeIdx,
  findHeIdxByStatus,
  findParentToolIdx,
  findToolIdx,
  patchAssistantContentIfEmpty,
  removeSubTimelineStreamingEntry,
  updateSubTimelineTool,
  updateToolInAnySubTimeline,
  accumulateJsonInput,
} from "./timeline-helpers";

/**
 * Stateful reducer helpers factored out of SessionStore. The subclass owns
 * reactive fields; this base owns only mutation algorithms and their
 * invariants for main timelines and nested subagent timelines.
 */
export abstract class SessionStoreTimelineOperations {
  abstract timeline: TimelineEntry[];
  abstract streamingText: string;
  abstract thinkingText: string;
  abstract thinkingStartMs: number;
  abstract thinkingEndMs: number;
  abstract tools: HookEvent[];
  abstract usage: UsageState;
  abstract run: TaskRun | null;
  protected abstract _toolTlIndex: Map<string, number>;
  protected abstract _toolHeIndex: Map<string, number>;
  protected abstract _lastProcessedSeq: number;
  protected abstract _needsIdleHealthCheck: boolean;
  abstract recoverFromEventLog(notice?: string): Promise<void>;

  /** Append a timeline entry and update the first-match tool index. */
  _pushTimeline(ctx: ReduceCtx | null, entry: TimelineEntry): void {
    if (ctx) {
      ctx.tl.push(entry);
      if (entry.kind === "tool" && !ctx.toolTlIndex.has(entry.id)) {
        ctx.toolTlIndex.set(entry.id, ctx.tl.length - 1);
      }
      return;
    }

    this.timeline = [...this.timeline, entry];
    if (entry.kind === "tool" && !this._toolTlIndex.has(entry.id)) {
      this._toolTlIndex.set(entry.id, this.timeline.length - 1);
    }
  }

  /** Push an optimistic user message and return its ID for rollback. */
  _pushOptimisticUser(content: string, attachments?: Attachment[]): string {
    const id = uuid();
    this._pushTimeline(null, {
      kind: "user",
      id,
      anchorId: id,
      content,
      ts: new Date().toISOString(),
      ...(attachments && attachments.length > 0
        ? { attachments: timelineAttachments(attachments) }
        : {}),
    });
    return id;
  }

  _removeOptimisticUser(entryId: string): void {
    this.timeline = this.timeline.filter((entry) => entry.id !== entryId);
  }

  /** Append hook event and update the first-match hook index. */
  _pushHookEntry(ctx: ReduceCtx | null, heEntry: HookEvent): void {
    const toolUseId = (heEntry as Record<string, unknown>).tool_use_id as string | undefined;
    if (ctx) {
      ctx.he.push(heEntry);
      if (toolUseId && !ctx.toolHeIndex.has(toolUseId)) {
        ctx.toolHeIndex.set(toolUseId, ctx.he.length - 1);
      }
      return;
    }

    this.tools = [...this.tools, heEntry];
    if (toolUseId && !this._toolHeIndex.has(toolUseId)) {
      this._toolHeIndex.set(toolUseId, this.tools.length - 1);
    }
  }

  _findToolIdx(ctx: ReduceCtx | null, toolUseId: string): number {
    return findToolIdx(
      ctx ? ctx.tl : this.timeline,
      ctx ? ctx.toolTlIndex : this._toolTlIndex,
      toolUseId,
    );
  }

  _findHeIdx(ctx: ReduceCtx | null, toolUseId: string): number {
    return findHeIdx(
      ctx ? ctx.he : this.tools,
      ctx ? ctx.toolHeIndex : this._toolHeIndex,
      toolUseId,
    );
  }

  _findHeIdxByStatus(ctx: ReduceCtx | null, toolUseId: string, status: string): number {
    return findHeIdxByStatus(
      ctx ? ctx.he : this.tools,
      ctx ? ctx.toolHeIndex : this._toolHeIndex,
      toolUseId,
      status,
    );
  }

  _findParentToolIdx(ctx: ReduceCtx | null, parentToolUseId: string): number {
    return findParentToolIdx(
      ctx ? ctx.tl : this.timeline,
      ctx ? ctx.toolTlIndex : this._toolTlIndex,
      parentToolUseId,
    );
  }

  _updateToolInAnySubTimeline(
    toolUseId: string,
    updater: (old: BusToolItem) => BusToolItem,
    ctx: ReduceCtx | null,
  ): boolean {
    if (ctx) return updateToolInAnySubTimeline(ctx.tl, toolUseId, updater);

    const timeline = [...this.timeline];
    const updated = updateToolInAnySubTimeline(timeline, toolUseId, updater);
    if (updated) this.timeline = timeline;
    return updated;
  }

  _appendToSubTimeline(
    _tl: TimelineEntry[],
    parentIdx: number,
    entry: TimelineEntry,
    ctx: ReduceCtx | null,
  ): void {
    if (ctx) {
      appendToSubTimeline(ctx.tl, parentIdx, entry);
      return;
    }
    const timeline = [...this.timeline];
    appendToSubTimeline(timeline, parentIdx, entry);
    this.timeline = timeline;
  }

  _updateSubTimelineTool(
    parentToolUseId: string,
    childToolUseId: string,
    updater: (old: BusToolItem) => BusToolItem,
    ctx: ReduceCtx | null,
  ): boolean {
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    if (ctx) return updateSubTimelineTool(ctx.tl, index, parentToolUseId, childToolUseId, updater);

    const timeline = [...this.timeline];
    const updated = updateSubTimelineTool(
      timeline,
      index,
      parentToolUseId,
      childToolUseId,
      updater,
    );
    if (updated) this.timeline = timeline;
    return updated;
  }

  _appendSubTimelineStreamingDelta(
    parentToolUseId: string,
    field: "content" | "thinkingText",
    text: string,
    ctx: ReduceCtx | null,
  ): void {
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    if (ctx) {
      appendSubTimelineStreamingDelta(ctx.tl, index, parentToolUseId, field, text);
      return;
    }
    const timeline = [...this.timeline];
    appendSubTimelineStreamingDelta(timeline, index, parentToolUseId, field, text);
    this.timeline = timeline;
  }

  _extractSubTimelineThinking(parentToolUseId: string, ctx: ReduceCtx | null): string | undefined {
    return extractSubTimelineThinking(
      ctx ? ctx.tl : this.timeline,
      ctx ? ctx.toolTlIndex : this._toolTlIndex,
      parentToolUseId,
    );
  }

  _removeSubTimelineStreamingEntry(parentToolUseId: string, ctx: ReduceCtx | null): void {
    const index = ctx ? ctx.toolTlIndex : this._toolTlIndex;
    if (ctx) {
      removeSubTimelineStreamingEntry(ctx.tl, index, parentToolUseId);
      return;
    }
    const timeline = [...this.timeline];
    removeSubTimelineStreamingEntry(timeline, index, parentToolUseId);
    this.timeline = timeline;
  }

  _extractSubTimelineStreamingContent(parentToolUseId: string, ctx: ReduceCtx | null): string {
    return extractSubTimelineStreamingContent(
      ctx ? ctx.tl : this.timeline,
      ctx ? ctx.toolTlIndex : this._toolTlIndex,
      parentToolUseId,
    );
  }

  _clearStreamingState(ctx: ReduceCtx | null): void {
    if (ctx) {
      ctx.streamText = "";
      ctx.thinkingText = "";
    } else {
      this.streamingText = "";
      this.thinkingText = "";
    }
    this.thinkingStartMs = 0;
    this.thinkingEndMs = 0;
  }

  _patchAssistantContentIfEmpty(
    ctx: ReduceCtx | null,
    messageId: string,
    content: string,
  ): boolean {
    return patchAssistantContentIfEmpty(ctx ? ctx.tl : this.timeline, messageId, content);
  }

  _materializeOrphanStreamingOnIdle(
    ctx: ReduceCtx | null,
    ev: Extract<BusEvent, { type: "run_state" }>,
    replayOnly: boolean,
    getTl: () => TimelineEntry[],
  ): void {
    if (replayOnly) return;
    const streamText = ctx ? ctx.streamText : this.streamingText;
    const trimmed = streamText.trim();
    if (!trimmed) return;

    const lastAssistant = [...getTl()]
      .reverse()
      .find(
        (entry): entry is Extract<TimelineEntry, { kind: "assistant" }> =>
          entry.kind === "assistant",
      );
    if (lastAssistant && lastAssistant.content.trim() === trimmed) {
      dbg("store", "orphan streamingText dropped — already materialized in timeline", {
        runId: ev.run_id,
        len: streamText.length,
        messageId: lastAssistant.id,
      });
      this._clearStreamingState(ctx);
      return;
    }

    const id = `synthetic_assistant_${ev.run_id}_${this._lastProcessedSeq}`;
    if (getTl().some((entry) => entry.kind === "assistant" && entry.id === id)) {
      this._clearStreamingState(ctx);
      return;
    }
    dbgWarn("store", "orphan streamingText materialized on idle", {
      runId: ev.run_id,
      len: streamText.length,
      lastProcessedSeq: this._lastProcessedSeq,
    });
    this._pushTimeline(ctx, {
      kind: "assistant",
      id,
      anchorId: id,
      content: streamText,
      ts: eventTs(ev),
    });
    this._clearStreamingState(ctx);
  }

  _runIdleHealthCheckIfNeeded(): void {
    if (!this._needsIdleHealthCheck || !this.run) return;
    this._needsIdleHealthCheck = false;

    const lastAssistant = [...this.timeline]
      .reverse()
      .find(
        (entry): entry is Extract<TimelineEntry, { kind: "assistant" }> =>
          entry.kind === "assistant",
      );
    if (lastAssistant && !lastAssistant.content.trim() && this.usage.outputTokens > 0) {
      dbgWarn("store", "idle health: empty assistant with output tokens", {
        runId: this.run.id,
        messageId: lastAssistant.id,
        outputTokens: this.usage.outputTokens,
      });
      void this.recoverFromEventLog("Recovered from persisted event log");
      return;
    }

    if (this.streamingText.trim()) {
      dbgWarn("store", "idle health: orphan streamingText remains", {
        runId: this.run.id,
        len: this.streamingText.length,
      });
      this._materializeOrphanStreamingOnIdle(
        null,
        { type: "run_state", run_id: this.run.id, state: "idle" },
        false,
        () => this.timeline,
      );
    }
  }

  _updateSubTimelineToolInput(
    parentToolUseId: string,
    childToolUseId: string,
    partialJson: string,
    ctx: ReduceCtx | null,
  ): void {
    this._updateSubTimelineTool(
      parentToolUseId,
      childToolUseId,
      (tool) => ({ ...tool, ...accumulateJsonInput(tool as Record<string, unknown>, partialJson) }),
      ctx,
    );
  }
}
