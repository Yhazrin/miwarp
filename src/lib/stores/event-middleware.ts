/**
 * EventMiddleware: unified Tauri event listener management.
 *
 * - Registers Tauri event listeners once
 * - Routes events by run_id to the subscribed SessionStore
 * - Microbatches bus-events (16ms) to reduce reactive updates
 * - Pipe events go through handler callbacks (DOM-bound)
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { BusEvent, HookEvent } from "$lib/types";
import type { SessionStore } from "./session-store.svelte";
import { markAttention, clearAttention } from "./attention-store.svelte";
import { getTransport } from "$lib/transport";
import { t } from "$lib/i18n/index.svelte";
import {
  ProtocolQuarantineCoordinator,
  type ProtocolInspectResult,
  type ProtocolQuarantineAction,
} from "./protocol-quarantine";

// ── Handler interfaces (page-level DOM callbacks) ──

export interface PipeHandler {
  onDelta(delta: { text: string }): void;
  onDone(done: { ok: boolean; code: number; error?: string }): void;
}

export interface RunEventHandler {
  onRunEvent(event: { run_id: string; type: string; text: string }): void;
}

// ── Middleware ──

/** Event types that _trackAttention actually handles — all others are no-ops. */
const ATTENTION_EVENT_TYPES = new Set([
  "permission_prompt",
  "elicitation_prompt",
  "tool_end",
  "permission_denied",
  "control_cancelled",
  "user_message",
  "run_state",
  "session_recovering",
  "session_recovered",
  "session_lifecycle",
  "protocol_desync",
]);

export class EventMiddleware {
  private _unlisteners: (() => void)[] = [];
  private _subscriptions = new Map<string, SessionStore>();
  private _currentRunId: string | null = null;
  private _currentStore: SessionStore | null = null;

  // Handler callbacks (set by page component)
  private _pipeHandler: PipeHandler | null = null;
  private _runEventHandler: RunEventHandler | null = null;

  // Microbatch buffer for bus events
  private _batchBuffer = new Map<string, BusEvent[]>();
  private _hookBatchBuffer = new Map<string, HookEvent[]>();
  private _usageBatchBuffer = new Map<
    string,
    Array<{ run_id: string; input_tokens: number; output_tokens: number; cost: number }>
  >();
  private _flushScheduled = false;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _BATCH_INTERVAL = 16; // ~1 frame
  private _MAX_BUFFER_SIZE = 500; // per-run overflow threshold

  // Idempotent start guard
  private _started = false;

  // Single-flight guard for server-requested full reloads.
  private _reloadingRuns = new Set<string>();

  /** v1.0.9 Phase 1: protocol error quarantine before SessionStore apply. */
  private _protocolQuarantine = new ProtocolQuarantineCoordinator();

  // ── Lifecycle ──

  isStarted(): boolean {
    return this._started;
  }

  async start(): Promise<void> {
    if (this._started) {
      dbg("middleware", "start skipped (already started)");
      return;
    }
    this._started = true;
    dbg("middleware", "starting event listeners");
    const ul = this._unlisteners;

    const transport = getTransport();

    // Helper: register a single listener via transport (works for both Tauri + WS).
    // Transport.listen delivers payload directly (TauriTransport unwraps the envelope).
    // If one listener fails to register, the rest still get set up (partial degradation).
    const reg = async <T>(name: string, handler: (payload: T) => void) => {
      try {
        ul.push(await transport.listen<T>(name, handler));
      } catch (e) {
        dbgWarn("middleware", `failed to register listener for "${name}":`, e);
      }
    };

    // 1. Bus events (stream session mode) — microbatched
    await reg<BusEvent>("bus-event", (ev) => {
      dbg("middleware", "bus-event", { type: ev.type, run_id: ev.run_id });
      this._handleBusEvent(ev);
    });

    // 2. Chat delta (pipe mode)
    await reg<{ text: string }>("chat-delta", (payload) => {
      dbg("middleware", "chat-delta", { len: payload.text.length });
      this._pipeHandler?.onDelta(payload);
    });

    // 5. Chat done (pipe mode)
    await reg<{ ok: boolean; code: number; error?: string }>("chat-done", (payload) => {
      dbg("middleware", "chat-done", payload);
      this._pipeHandler?.onDone(payload);
    });

    // 6. Run events (pipe mode stderr)
    await reg<{ run_id: string; type: string; text: string }>("run-event", (payload) => {
      dbg("middleware", "run-event", { run_id: payload.run_id, type: payload.type });
      this._runEventHandler?.onRunEvent(payload);
    });

    // 7. Hook events
    await reg<HookEvent>("hook-event", (payload) => {
      dbg("middleware", "hook-event", {
        hook_type: payload.hook_type,
        tool: payload.tool_name,
      });
      this._handleHookEvent(payload);
    });

    // 8. Hook usage
    await reg<{ run_id: string; input_tokens: number; output_tokens: number; cost: number }>(
      "hook-usage",
      (payload) => {
        dbg("middleware", "hook-usage", payload);
        this._handleHookUsage(payload);
      },
    );

    // 9. Full reload (WS-only — Tauri transport won't emit this event)
    if (!transport.isDesktop()) {
      try {
        const unlisten = await transport.listen<{ run_id: string }>("_full_reload", (payload) => {
          const runId = payload.run_id;
          dbgWarn("middleware", "_full_reload", { runId });
          if (this._reloadingRuns.has(runId)) {
            dbg("middleware", "_full_reload debounced", { runId });
            return;
          }
          const store = this._subscriptions.get(runId);
          if (store) {
            this._reloadingRuns.add(runId);
            store.markConnectionReloading(runId);
            void store.loadRun(runId).finally(() => {
              this._reloadingRuns.delete(runId);
            });
          }
        });
        ul.push(unlisten);
      } catch (e) {
        dbgWarn("middleware", "failed to register _full_reload listener:", e);
      }
    }

    dbg("middleware", "all listeners registered:", ul.length);
  }

  destroy(): void {
    dbg("middleware", "destroying, unregistering", this._unlisteners.length, "listeners");
    // Release transport subscriptions via each store's connection controller.
    // EventMiddleware does NOT own transport subscriptions — the controller does.
    for (const [, store] of this._subscriptions) {
      store.releaseConnection();
    }
    for (const fn of this._unlisteners) fn();
    this._unlisteners = [];
    this._subscriptions.clear();
    this._currentRunId = null;
    this._currentStore = null;
    this._batchBuffer.clear();
    this._hookBatchBuffer.clear();
    this._usageBatchBuffer.clear();
    this._flushScheduled = false;
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this._reloadingRuns.clear();
    this._protocolQuarantine.resetAll();
    this._started = false;
  }

  // ── Subscriptions ──

  /** Subscribe a store for a run_id. Clears previous subscription (single-session mode). */
  subscribeCurrent(runId: string, store: SessionStore): void {
    // Idempotent: skip if already subscribed for the same run + store.
    // Re-subscribing for the same pair would clear the batch buffer,
    // dropping in-flight events (e.g. RunState(idle) after resume).
    if (runId && this._currentRunId === runId && this._currentStore === store) {
      return;
    }

    // Clear old routing (different run or different store).
    // Transport subscription is released by the connection controller, not here.
    if (this._currentRunId) {
      this._subscriptions.delete(this._currentRunId);
      this._batchBuffer.delete(this._currentRunId);
      this._hookBatchBuffer.delete(this._currentRunId);
      this._usageBatchBuffer.delete(this._currentRunId);
    }
    if (runId) {
      this._currentRunId = runId;
      this._currentStore = store;
      this._subscriptions.set(runId, store);
    } else {
      // Empty runId = clear all (navigating to new chat)
      this._currentRunId = null;
      this._currentStore = null;
    }
    dbg("middleware", "subscribeCurrent", runId || "(cleared)");
  }

  /** Multi-session subscribe (for future subagent support). */
  subscribe(runId: string, store: SessionStore): void {
    this._subscriptions.set(runId, store);
    dbg("middleware", "subscribe", runId);
  }

  unsubscribe(runId: string): void {
    // Transport subscription is released by the connection controller, not here.
    this._subscriptions.delete(runId);
    this._batchBuffer.delete(runId);
    this._hookBatchBuffer.delete(runId);
    this._usageBatchBuffer.delete(runId);
    this._protocolQuarantine.reset(runId);
    if (this._currentRunId === runId) {
      this._currentRunId = null;
      this._currentStore = null;
    }
    dbg("middleware", "unsubscribe", runId);
  }

  // ── Handler setters ──

  setPipeHandler(handler: PipeHandler | null): void {
    this._pipeHandler = handler;
  }

  setRunEventHandler(handler: RunEventHandler | null): void {
    this._runEventHandler = handler;
  }

  // ── Internal ──

  private _handleBusEvent(ev: BusEvent): void {
    // Only call _trackAttention for event types that can change attention state.
    // Skipping the ~20 other event types avoids a function call + switch on every token.
    if (ATTENTION_EVENT_TYPES.has(ev.type)) {
      this._trackAttention(ev);
    }

    const store = this._subscriptions.get(ev.run_id);
    if (!store) return;

    const inspection = this._protocolQuarantine.inspect({
      runId: ev.run_id,
      subscribedRunId: store.run?.id ?? ev.run_id,
      payload: ev,
      lastSeq: store.getLastProcessedSeq(),
    });

    if (!this._handleProtocolInspection(ev, store, inspection)) {
      return;
    }

    if (ev.type === "session_recovering") {
      const secs = Math.round((ev.deadline_ms ?? 5000) / 1000);
      store.setProtocolNotice(t("protocol_session_recovering", { seconds: String(secs) }));
    } else if (ev.type === "session_recovered" && ev.ok) {
      store.setProtocolNotice(null);
      this._protocolQuarantine.reset(ev.run_id);
    }

    // Push to batch buffer
    let buf = this._batchBuffer.get(ev.run_id);
    if (!buf) {
      buf = [];
      this._batchBuffer.set(ev.run_id, buf);
    }
    buf.push(ev);

    dbg("middleware", "bus-event buffered", {
      type: ev.type,
      run_id: ev.run_id,
      ...(ev.type === "message_delta" ? { textLen: ev.text.length } : {}),
      ...(ev.type === "message_complete" ? { textLen: ev.text.length } : {}),
      bufferSize: buf.length,
    });

    // Overflow protection: flush synchronously if buffer grows too large
    if (buf.length >= this._MAX_BUFFER_SIZE) {
      dbgWarn(
        "middleware",
        `buffer overflow for ${ev.run_id} (${buf.length} events), flushing synchronously`,
      );
      this._flush();
      return;
    }

    this._scheduleFlush();
  }

  private _trackAttention(ev: BusEvent): void {
    switch (ev.type) {
      case "permission_prompt":
      case "elicitation_prompt":
        markAttention(ev.run_id, "permission");
        break;
      case "tool_end":
        if (ev.tool_name === "AskUserQuestion" && ev.status === "error") {
          markAttention(ev.run_id, "ask");
        }
        break;
      case "permission_denied":
        clearAttention(ev.run_id, "permission");
        // AskUserQuestion denied: tool_end(error) arrives first and marks ask,
        // but the question was denied, not pending — clear ask too.
        if (ev.tool_name === "AskUserQuestion") {
          clearAttention(ev.run_id, "ask");
        }
        break;
      case "control_cancelled":
        clearAttention(ev.run_id, "permission");
        break;
      case "user_message":
        clearAttention(ev.run_id, "ask");
        break;
      case "run_state":
        switch (ev.state) {
          case "spawning":
          case "idle":
            clearAttention(ev.run_id, "permission");
            break;
          case "running":
            clearAttention(ev.run_id, "ask");
            break;
          case "stopped":
          case "completed":
          case "failed":
            clearAttention(ev.run_id);
            break;
        }
        break;
      // v1.0.6 / hardening A1+A2: surface the recovery / desync banner.
      // The actual banner / toast UI is rendered by RecoveringBanner.svelte
      // and the global toast listener. Here we just record the event so
      // the toast-store notification fires once.
      case "session_recovering":
        // Falling through to the global notification listener; the
        // event itself carries deadline_ms so listeners can schedule
        // auto-dismiss. No-op here; RecoveringBanner reads directly.
        break;
      case "session_recovered":
        // Same: RecoveringBanner listens for the matching run_id.
        break;
      case "session_lifecycle":
        // Projected by reduceSessionLifecycle in SessionStore.
        break;
      case "protocol_desync":
        // Same: notification-listener surfaces a "会话状态已重置" toast.
        break;
    }
  }

  private _handleHookEvent(event: HookEvent): void {
    const store = this._subscriptions.get(event.run_id);
    if (!store) return;
    let buf = this._hookBatchBuffer.get(event.run_id);
    if (!buf) {
      buf = [];
      this._hookBatchBuffer.set(event.run_id, buf);
    }
    buf.push(event);
    if (buf.length >= this._MAX_BUFFER_SIZE) {
      dbgWarn("middleware", `hook buffer overflow for ${event.run_id} (${buf.length}), flushing`);
      this._flushScheduled = true; // ensure _flush() proceeds past dedup guard
      this._flush();
    } else {
      this._scheduleFlush();
    }
  }

  private _handleHookUsage(usage: {
    run_id: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }): void {
    const store = this._subscriptions.get(usage.run_id);
    if (!store) return;
    let buf = this._usageBatchBuffer.get(usage.run_id);
    if (!buf) {
      buf = [];
      this._usageBatchBuffer.set(usage.run_id, buf);
    }
    buf.push(usage);
    if (buf.length >= this._MAX_BUFFER_SIZE) {
      dbgWarn("middleware", `usage buffer overflow for ${usage.run_id} (${buf.length}), flushing`);
      this._flushScheduled = true; // ensure _flush() proceeds past dedup guard
      this._flush();
    } else {
      this._scheduleFlush();
    }
  }

  private _scheduleFlush(): void {
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    // Dual-bail: RAF for visual cadence, setTimeout as safety net when
    // the tab is backgrounded or WebView2 throttles RAF (Windows power-saving).
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => {
        // Cancel the safety-net timer — RAF fired first
        if (this._flushTimer !== null) {
          clearTimeout(this._flushTimer);
          this._flushTimer = null;
        }
        this._flush();
      });
      this._flushTimer = setTimeout(() => this._flush(), this._BATCH_INTERVAL);
    } else {
      setTimeout(() => this._flush(), this._BATCH_INTERVAL);
    }
  }

  private _noticeForProtocolAction(action: ProtocolQuarantineAction): string | null {
    switch (action) {
      case "recover":
        return t("protocol_quarantine_recovering");
      case "full_reload":
        return t("protocol_quarantine_full_reload");
      case "terminate":
        return t("protocol_quarantine_terminated");
      default:
        return null;
    }
  }

  private _handleProtocolInspection(
    ev: BusEvent,
    store: SessionStore,
    inspection: ProtocolInspectResult,
  ): boolean {
    const runId = ev.run_id;
    if (inspection.evidence) {
      dbgWarn("protocol-quarantine", "inspection", {
        runId,
        action: inspection.action,
        category: inspection.category,
        kind: inspection.evidence.kind,
        eventType: inspection.evidence.eventType,
        detail: inspection.evidence.detail,
      });
    }

    switch (inspection.action) {
      case "drop":
        return false;
      case "terminate": {
        store.setProtocolNotice(this._noticeForProtocolAction("terminate"));
        return false;
      }
      case "recover": {
        store.setProtocolNotice(this._noticeForProtocolAction("recover"));
        void this.recoverRunFromDisk(runId, "protocol quarantine recover");
        return false;
      }
      case "full_reload": {
        store.setProtocolNotice(this._noticeForProtocolAction("full_reload"));
        if (!this._reloadingRuns.has(runId)) {
          this._reloadingRuns.add(runId);
          store.markConnectionReloading(runId);
          void store.loadRun(runId).finally(() => {
            this._reloadingRuns.delete(runId);
          });
        }
        return false;
      }
      case "pass":
        return true;
    }
  }

  private async recoverRunFromDisk(runId: string, reason: string): Promise<void> {
    const store = this._subscriptions.get(runId);
    if (!store) return;
    dbgWarn("middleware", "recoverRunFromDisk", { runId, reason });
    await store.recoverFromEventLog("Recovered from persisted event log");
  }

  private _applyBufferedEvents(runId: string, store: SessionStore, events: BusEvent[]): void {
    if (events.length === 0) return;
    if (events.length === 1) {
      try {
        store.applyEvent(events[0]);
        this._protocolQuarantine.recordApplySuccess(runId);
      } catch (evErr) {
        const decision = this._protocolQuarantine.recordApplyFailure(runId, events[0].type);
        dbgWarn("middleware", "apply failure (single)", {
          runId,
          type: events[0].type,
          evErr,
          action: decision.action,
        });
        this._handleProtocolInspection(events[0], store, decision);
      }
      return;
    }
    try {
      store.applyEventBatch(events);
      this._protocolQuarantine.recordApplySuccess(runId);
    } catch (batchErr) {
      dbgWarn("middleware", "batch apply failed, falling back to per-event", { runId, batchErr });
      for (let i = 0; i < events.length; i++) {
        try {
          store.applyEvent(events[i]);
        } catch (evErr) {
          dbgWarn("middleware", "poison event during flush", {
            runId,
            index: i,
            type: events[i].type,
            evErr,
          });
          const decision = this._protocolQuarantine.recordApplyFailure(runId, events[i].type);
          this._handleProtocolInspection(events[i], store, decision);
          return;
        }
      }
      this._protocolQuarantine.recordApplySuccess(runId);
    }
  }

  private _flush(): void {
    if (!this._flushScheduled) return; // dedup: RAF + setTimeout may both fire
    this._flushScheduled = false;
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }

    // Flush bus events
    for (const [runId, events] of this._batchBuffer) {
      const store = this._subscriptions.get(runId);
      if (!store) continue;
      try {
        this._applyBufferedEvents(runId, store, events);
      } catch (e) {
        dbgWarn("middleware", `flush error for run ${runId}:`, e);
        const decision = this._protocolQuarantine.recordApplyFailure(runId, "flush");
        if (events.length > 0) {
          this._handleProtocolInspection(events[0], store, decision);
        }
      }
    }
    this._batchBuffer.clear();

    // Flush hook events
    for (const [runId, events] of this._hookBatchBuffer) {
      const store = this._subscriptions.get(runId);
      if (!store) continue;
      try {
        store.applyHookEventBatch(events);
      } catch (e) {
        dbgWarn("middleware", `hook flush error for run ${runId}:`, e);
      }
    }
    this._hookBatchBuffer.clear();

    // Flush hook usage
    for (const [runId, usages] of this._usageBatchBuffer) {
      const store = this._subscriptions.get(runId);
      if (!store) continue;
      try {
        store.applyHookUsageBatch(usages);
      } catch (e) {
        dbgWarn("middleware", `usage flush error for run ${runId}:`, e);
      }
    }
    this._usageBatchBuffer.clear();
  }
}

// ── Module-level singleton ──

let _instance: EventMiddleware | null = null;

export function getEventMiddleware(): EventMiddleware {
  if (!_instance) {
    _instance = new EventMiddleware();
  }
  return _instance;
}
