/**
 * WsTransport: WebSocket JSON-RPC transport for browser access.
 *
 * Refactored Phase 1: delegates to focused modules:
 * - ConnectionStateMachine: state transitions, generation tracking
 * - RequestRegistry: pending request correlation, timeout, cleanup
 * - RunSubscriptions: reference-counted run subscriptions with monotonic seq
 * - ChunkAssembler: bounded chunk assembly with size/time limits
 *
 * This file owns: WebSocket lifecycle, message routing, reconnect scheduling.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import { getInvokeTimeoutMs, type Transport } from "./contract";
import {
  ConnectionState,
  ConnectionStateMachine,
  AuthFailureError,
  ConnectionClosedError,
  ConnectionFailedError,
  ConnectionTimeoutError,
  DisposedError,
  NotConnectedError,
  type ConnectionStateListener,
  type ConnectionStateValue,
} from "./connection-state";
import { RequestRegistry, type RpcError } from "./request-registry";
import { RunSubscriptions } from "./run-subscriptions";
import { ChunkAssembler } from "./chunk-assembler";
import { systemTimers, type TimerApi } from "./timer-api";

/** Delay schedule for reconnect: 1s → 2s → 4s → ... → 30s cap */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

export interface WsTransportOptions {
  /** Custom WebSocket factory for testing */
  wsFactory?: (url: string) => WebSocket;
  /** Custom timer functions for testing */
  timers?: TimerApi;
}

export class WsTransport implements Transport {
  private ws: WebSocket | null = null;
  private stateMachine = new ConnectionStateMachine();
  private requests: RequestRegistry;
  private subscriptions = new RunSubscriptions();
  private chunks: ChunkAssembler;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;

  private listeners = new Map<string, Set<(payload: unknown) => void>>();

  private readonly wsFactory: (url: string) => WebSocket;
  private readonly timers: TimerApi;

  constructor(options: WsTransportOptions = {}) {
    this.wsFactory = options.wsFactory ?? ((url) => new WebSocket(url));
    this.timers = options.timers ?? systemTimers;
    this.requests = new RequestRegistry(this.timers);

    this.chunks = new ChunkAssembler({
      cleanupIntervalMs: 15_000,
      timers: this.timers,
    });
    this.chunks.onComplete = (assembled) => this.routeMessage(assembled);
  }

  private buildWsUrl(): string {
    const loc = window.location;
    const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${loc.host}/ws`;
    dbg("transport", "ws.buildUrl", { url });
    return url;
  }

  /** Backward-compatible property for existing diagnostics/tests. */
  get connectionState(): ConnectionStateValue {
    return this.stateMachine.state;
  }

  getConnectionState(): ConnectionStateValue {
    return this.stateMachine.state;
  }

  onConnectionStateChange(listener: ConnectionStateListener): () => void {
    return this.stateMachine.subscribe(listener);
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  private connect(): Promise<void> {
    if (!this.stateMachine.canConnect) {
      if (this.stateMachine.state === ConnectionState.Connecting) {
        // Already connecting — return a promise that waits for state change
        return new Promise<void>((resolve, reject) => {
          const unsub = this.stateMachine.subscribe((state) => {
            if (state === ConnectionState.Open) {
              unsub();
              resolve();
            } else if (
              state === ConnectionState.Closed ||
              state === ConnectionState.AuthFailed ||
              state === ConnectionState.Disposed
            ) {
              unsub();
              reject(new NotConnectedError());
            }
          });
        });
      }
      if (this.stateMachine.state === ConnectionState.Disposed) {
        return Promise.reject(new DisposedError());
      }
      if (this.stateMachine.state === ConnectionState.AuthFailed) {
        return Promise.reject(new AuthFailureError(4401, "auth failed"));
      }
      // Open was handled by ensureConnected; no new connection is needed.
      return Promise.resolve();
    }

    this.stateMachine.transition(ConnectionState.Connecting);
    const generation = this.stateMachine.generation;

    return new Promise<void>((resolve, reject) => {
      const url = this.buildWsUrl();
      dbg("transport", "ws.connecting", { url, generation });

      let ws: WebSocket;
      try {
        ws = this.wsFactory(url);
      } catch (cause) {
        const error = new ConnectionFailedError("Failed to create WebSocket", { cause });
        this.stateMachine.transition(ConnectionState.Closed);
        reject(error);
        this.scheduleReconnect();
        return;
      }

      // Guard: if the generation changed while we were creating the socket, abort
      if (this.stateMachine.generation !== generation) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new NotConnectedError());
        return;
      }

      this.ws = ws;
      let settled = false;

      const settle = (action: "resolve" | "reject", err?: Error) => {
        if (settled) return;
        settled = true;
        if (action === "resolve") resolve();
        else reject(err);
      };

      ws.onopen = () => {
        if (this.stateMachine.generation !== generation) return;
        dbg("transport", "ws.connected", { generation });
        this.clearConnectTimer();
        this.reconnectDelay = RECONNECT_BASE_MS;
        this.stateMachine.transition(ConnectionState.Open);
        this.resubscribeAll();
        settle("resolve");
      };

      ws.onmessage = (ev) => {
        if (this.stateMachine.generation !== generation) return;
        this.handleRawMessage(ev.data);
      };

      ws.onerror = () => {
        if (this.stateMachine.generation !== generation) return;
        const error = new ConnectionFailedError("WebSocket connection error", { generation });
        dbgWarn("transport", "ws.error", { generation });
        this.clearConnectTimer();
        this.requests.rejectAll(error, generation);
        this.stateMachine.transition(ConnectionState.Closed);
        settle("reject", error);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        this.ws = null;
        this.scheduleReconnect();
      };

      ws.onclose = (ev) => {
        if (this.stateMachine.generation !== generation) {
          dbg("transport", "ws.close.stale", { generation, code: ev.code });
          return;
        }
        dbg("transport", "ws.closed", { code: ev.code, reason: ev.reason, generation });
        this.ws = null;
        this.clearConnectTimer();

        const closedError = new ConnectionClosedError(ev.code, ev.reason);
        // Reject all pending requests from this connection generation.
        this.requests.rejectAll(closedError, generation);

        if (ev.code === 4401) {
          this.clearReconnectTimer();
          this.stateMachine.transition(ConnectionState.AuthFailed);
          settle("reject", new AuthFailureError(4401, ev.reason));
          dbgWarn("transport", "ws.authFailure, redirecting to /login");
          this.timers.setTimeout(() => {
            window.location.href = "/login";
          }, 0);
          return;
        }

        // Transition to closed
        this.stateMachine.transition(ConnectionState.Closed);
        settle("reject", closedError);

        // Schedule reconnect
        this.scheduleReconnect();
      };

      // Connection timeout
      this.connectTimer = this.timers.setTimeout(() => {
        if (this.stateMachine.generation !== generation) return;
        if (ws.readyState === WebSocket.CONNECTING) {
          dbg("transport", "ws.connectTimeout", { generation });
          this.clearConnectTimer();
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          this.stateMachine.transition(ConnectionState.Closed);
          settle("reject", new ConnectionTimeoutError(CONNECT_TIMEOUT_MS));
          this.scheduleReconnect();
        }
      }, CONNECT_TIMEOUT_MS);
    });
  }

  private scheduleReconnect(): void {
    if (!this.stateMachine.canReconnect) {
      dbg("transport", "ws.reconnect.skip", { state: this.stateMachine.state });
      return;
    }

    // Cancel any existing reconnect timer (dedup)
    this.clearReconnectTimer();

    const delay = Math.min(this.reconnectDelay, RECONNECT_MAX_MS);
    dbg("transport", "ws.reconnect.scheduled", { delay, state: this.stateMachine.state });
    this.stateMachine.transition(ConnectionState.Reconnecting);

    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      // Reject stale requests before reconnect
      this.requests.rejectStale(this.stateMachine.generation + 1, "Reconnecting");
      this.connect().catch(() => {
        // connect() internally handles scheduling next reconnect
      });
    }, delay);
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.stateMachine.state === ConnectionState.Open) return;
    await this.connect();
  }

  // ---------------------------------------------------------------------------
  // Run subscriptions (delegate to RunSubscriptions)
  // ---------------------------------------------------------------------------

  private resubscribeAll(): void {
    const runs = this.subscriptions.getAll();
    if (runs.length === 0) return;
    dbg("transport", "ws.resubscribeAll", { count: runs.length });
    for (const { runId, lastSeq } of runs) {
      this.sendRaw({
        id: this.requests.allocateId(),
        method: "_subscribe",
        params: { run_id: runId, last_seq: lastSeq },
      });
    }
  }

  subscribeRun(runId: string, lastSeq = 0, ownerId?: string): void {
    const result = this.subscriptions.subscribe(runId, lastSeq, ownerId);
    dbg("transport", "ws.subscribeRun", { runId, ownerId, ...result });
    if (result.shouldSendSubscribe && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendRaw({
        id: this.requests.allocateId(),
        method: "_subscribe",
        params: { run_id: runId, last_seq: result.lastSeq },
      });
    }
  }

  unsubscribeRun(runId: string, ownerId?: string): void {
    const wasLast = this.subscriptions.unsubscribe(runId, ownerId);
    if (!wasLast) return;
    dbg("transport", "ws.unsubscribeRun", { runId });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendRaw({
        id: this.requests.allocateId(),
        method: "_unsubscribe",
        params: { run_id: runId },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Message sending
  // ---------------------------------------------------------------------------

  private sendRaw(obj: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // ---------------------------------------------------------------------------
  // Message routing
  // ---------------------------------------------------------------------------

  private handleRawMessage(raw: string): void {
    // Try chunk assembly first
    try {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw);
      } catch {
        dbgWarn("transport", "ws.invalidJson", { raw: raw.slice(0, 200) });
        return;
      }
      if (this.chunks.handleMessage(msg)) return;
      this.routeParsedMessage(msg);
    } catch (e) {
      // Never let a parse/handler error kill the connection
      dbgWarn("transport", "ws.handleMessageError", { error: e });
    }
  }

  private routeMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      this.routeParsedMessage(msg);
    } catch (e) {
      dbgWarn("transport", "ws.routeMessageError", { error: e });
    }
  }

  private routeParsedMessage(msg: Record<string, unknown>): void {
    // Response to a pending request
    if (typeof msg.id === "string") {
      if (msg.error) {
        const rpcError: RpcError =
          typeof msg.error === "object" && msg.error !== null
            ? {
                message: String((msg.error as Record<string, unknown>).message ?? msg.error),
                code: (msg.error as Record<string, unknown>).code as number | undefined,
                data: (msg.error as Record<string, unknown>).data,
              }
            : { message: String(msg.error) };
        this.requests.rejectWithError(msg.id, rpcError);
      } else {
        this.requests.resolve(msg.id, msg.result);
      }
      return;
    }

    // Server push event
    if (typeof msg.event === "string") {
      this.handlePushEvent(msg);
    }
  }

  private handlePushEvent(msg: Record<string, unknown>): void {
    const event = msg.event as string;
    const payload = msg.payload;
    const seq = typeof msg.seq === "number" ? msg.seq : undefined;
    const runId = typeof msg.run_id === "string" ? (msg.run_id as string) : undefined;

    // Handle _full_reload
    if (event === "_full_reload") {
      const reloadRunId = typeof msg.run_id === "string" ? msg.run_id : undefined;
      if (reloadRunId) {
        dbgWarn("transport", "ws._full_reload", { reloadRunId });
        this.subscriptions.resetSeq(reloadRunId);
        const handlers = this.listeners.get("_full_reload");
        if (handlers) {
          for (const handler of handlers) handler({ run_id: reloadRunId });
        }
      }
      return;
    }

    // Track sequence checkpoint
    if (seq !== undefined && runId) {
      this.subscriptions.updateSeq(runId, seq);
    }

    // Inject _seq into bus-event payloads
    if (event === "bus-event" && seq !== undefined && payload && typeof payload === "object") {
      (payload as Record<string, unknown>)._seq = seq;
    }

    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (e) {
          dbgWarn("transport", "ws.handlerError", { event, error: e });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Transport interface
  // ---------------------------------------------------------------------------

  async invoke<T>(
    cmd: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    if (this.stateMachine.state === ConnectionState.Disposed) {
      throw new DisposedError();
    }

    await this.ensureConnected();

    if (this.stateMachine.state !== ConnectionState.Open) {
      throw new NotConnectedError();
    }

    const id = this.requests.allocateId();
    const generation = this.stateMachine.generation;
    const timeoutMs = options?.timeoutMs ?? getInvokeTimeoutMs(cmd);
    const effectiveTimeout = timeoutMs > 0 ? timeoutMs : 5 * 60 * 1000;

    dbg("transport", "ws.invoke", { cmd, id, timeoutMs: effectiveTimeout, generation });

    const { promise } = this.requests.register<T>(id, generation, effectiveTimeout);

    this.sendRaw({ id, method: cmd, params: args ?? {} });

    return promise;
  }

  async listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
    dbg("transport", "ws.listen", { event });

    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }

    const typedHandler = handler as (payload: unknown) => void;
    handlers.add(typedHandler);

    this.ensureConnected().catch((e) => {
      dbgWarn("transport", "ws.listen.connectFailed", { event, error: e });
    });

    return () => {
      const h = this.listeners.get(event);
      if (h) {
        h.delete(typedHandler);
        if (h.size === 0) this.listeners.delete(event);
      }
    };
  }

  isDesktop(): boolean {
    return false;
  }

  fileAssetUrl(path: string): string {
    // Browser / web fallback — no Tauri runtime so the asset protocol is
    // unavailable. The web server is expected to expose the same files
    // under `/_asset/<path>` (mounted by the same dev server that serves
    // the SPA). The caller may still choose to fetch + object-URL.
    return `/_asset/${path.replace(/^\/+/, "")}`;
  }

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------

  dispose(): void {
    dbg("transport", "ws.dispose", { state: this.stateMachine.state });
    this.stateMachine.transition(ConnectionState.Disposed);

    this.clearConnectTimer();
    this.clearReconnectTimer();

    // Close socket
    if (this.ws) {
      // Remove handlers to prevent reconnect logic
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }

    // Reject all pending with a typed lifecycle error.
    this.requests.dispose(new DisposedError());

    // Clear subscriptions
    this.subscriptions.dispose();

    // Clear chunks
    this.chunks.dispose();

    // Clear event listeners
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      this.timers.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
