import { replayCheckpoint } from "$lib/chat/session-subscription";
import { getTransport, type Transport } from "$lib/transport";
import type { BusEvent } from "$lib/types";
import { dbg } from "$lib/utils/debug";

export type SessionRunConnectionState =
  | "inactive"
  | "selected"
  | "replaying"
  | "live"
  | "reloading"
  | "disposed";

export interface SessionRunConnectionOptions {
  ownerId?: string;
  transport?: Transport;
}

let nextOwnerId = 0;

/**
 * Logical run-subscription owner for one SessionStore instance.
 *
 * The controller owns run selection, replay/live transitions and release. The
 * Transport remains responsible for the physical WebSocket subscription,
 * reconnect recovery and server checkpoint registry.
 */
export class SessionRunConnection {
  private readonly transport: Transport;
  private readonly _ownerId: string;
  private _runId: string | null = null;
  private _checkpoint = 0;
  private _state: SessionRunConnectionState = "inactive";
  private hasTransportSubscription = false;

  constructor(options: SessionRunConnectionOptions = {}) {
    this.transport = options.transport ?? getTransport();
    this._ownerId = options.ownerId ?? `session-store-${++nextOwnerId}`;
  }

  get ownerId(): string {
    return this._ownerId;
  }

  get runId(): string | null {
    return this._runId;
  }

  get checkpoint(): number {
    return this._checkpoint;
  }

  get state(): SessionRunConnectionState {
    return this._state;
  }

  /** Select a run and enter replay mode before loading persisted events. */
  beginReplay(runId: string): void {
    if (!runId || this._state === "disposed") return;
    this.selectRun(runId);
    // A replay establishes a new logical baseline. The physical Transport keeps
    // its monotonic checkpoint unless a server _full_reload reset it.
    this._checkpoint = 0;
    this._state = "replaying";
    dbg("connection", "beginReplay", { runId, ownerId: this._ownerId });
  }

  subscribeFromReplay(runId: string, events: BusEvent[]): void {
    this.activate(runId, replayCheckpoint(events));
  }

  subscribeFromSeq(runId: string, lastSeq: number): void {
    this.activate(runId, lastSeq);
  }

  subscribeFresh(runId: string): void {
    this.activate(runId, 0);
  }

  /** Preserve ownership while a server-requested full reload is in progress. */
  markReloading(runId = this._runId): void {
    if (!runId || runId !== this._runId || this._state === "disposed") return;
    this._checkpoint = 0;
    this._state = "reloading";
    dbg("connection", "markReloading", { runId, ownerId: this._ownerId });
  }

  release(): void {
    if (this._state === "disposed") return;
    this.releaseCurrentRun();
    this._state = "inactive";
  }

  dispose(): void {
    if (this._state === "disposed") return;
    this.releaseCurrentRun();
    this._state = "disposed";
    dbg("connection", "disposed", { ownerId: this._ownerId });
  }

  private activate(runId: string, lastSeq: number): void {
    if (!runId || this._state === "disposed") return;
    this.selectRun(runId);

    const normalizedSeq = Number.isFinite(lastSeq) ? Math.max(0, lastSeq) : 0;
    const effectiveSeq = Math.max(this._checkpoint, normalizedSeq);

    // Repeated live activation at the same checkpoint is a logical no-op. A
    // replay/reload transition must still re-assert the owner even at the same
    // checkpoint because the server may have reset its replay baseline.
    if (
      this.hasTransportSubscription &&
      this._state === "live" &&
      effectiveSeq === this._checkpoint
    ) {
      return;
    }

    this.transport.subscribeRun(runId, effectiveSeq, this._ownerId);
    this.hasTransportSubscription = true;
    this._checkpoint = effectiveSeq;
    this._state = "live";

    dbg("connection", "live", {
      runId,
      checkpoint: effectiveSeq,
      ownerId: this._ownerId,
    });
  }

  private selectRun(runId: string): void {
    if (this._runId === runId) return;
    this.releaseCurrentRun();
    this._runId = runId;
    this._checkpoint = 0;
    this.hasTransportSubscription = false;
    this._state = "selected";
    dbg("connection", "selected", { runId, ownerId: this._ownerId });
  }

  private releaseCurrentRun(): void {
    if (this._runId && this.hasTransportSubscription) {
      this.transport.unsubscribeRun(this._runId, this._ownerId);
      dbg("connection", "unsubscribed", {
        runId: this._runId,
        ownerId: this._ownerId,
      });
    }
    this._runId = null;
    this._checkpoint = 0;
    this.hasTransportSubscription = false;
  }
}
