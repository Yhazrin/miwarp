/**
 * Run subscription ownership and monotonic replay checkpoints.
 *
 * Existing MiWarp callers may call subscribeRun repeatedly while loading or
 * resuming the same run. Those calls are idempotent under the default owner.
 * Independent consumers must provide distinct owner ids so one consumer cannot
 * unsubscribe another.
 */

import { dbg } from "$lib/utils/debug";

const DEFAULT_OWNER = "legacy";

interface SubscriptionEntry {
  owners: Set<string>;
  lastSeq: number;
}

export interface SubscribeResult {
  lastSeq: number;
  ownerAdded: boolean;
  checkpointAdvanced: boolean;
  shouldSendSubscribe: boolean;
}

export class RunSubscriptions {
  private subscriptions = new Map<string, SubscriptionEntry>();

  subscribe(runId: string, lastSeq = 0, ownerId = DEFAULT_OWNER): SubscribeResult {
    let entry = this.subscriptions.get(runId);
    const isNewRun = !entry;
    if (!entry) {
      entry = { owners: new Set(), lastSeq: 0 };
      this.subscriptions.set(runId, entry);
    }

    const ownerAdded = !entry.owners.has(ownerId);
    entry.owners.add(ownerId);

    const previousSeq = entry.lastSeq;
    entry.lastSeq = Math.max(entry.lastSeq, lastSeq);
    const checkpointAdvanced = entry.lastSeq > previousSeq;

    dbg("transport", "runSubs.subscribe", {
      runId,
      ownerId,
      ownerCount: entry.owners.size,
      lastSeq: entry.lastSeq,
      ownerAdded,
      checkpointAdvanced,
    });

    return {
      lastSeq: entry.lastSeq,
      ownerAdded,
      checkpointAdvanced,
      shouldSendSubscribe: isNewRun || checkpointAdvanced,
    };
  }

  /**
   * Release one logical owner. Returns true only when the last owner leaves and
   * the caller should send a server-side _unsubscribe.
   */
  unsubscribe(runId: string, ownerId = DEFAULT_OWNER): boolean {
    const entry = this.subscriptions.get(runId);
    if (!entry || !entry.owners.delete(ownerId)) return false;

    dbg("transport", "runSubs.unsubscribe", {
      runId,
      ownerId,
      ownerCount: entry.owners.size,
    });

    if (entry.owners.size === 0) {
      this.subscriptions.delete(runId);
      return true;
    }
    return false;
  }

  updateSeq(runId: string, seq: number): void {
    const entry = this.subscriptions.get(runId);
    if (entry && seq > entry.lastSeq) entry.lastSeq = seq;
  }

  /** Reset replay checkpoint while preserving logical subscription owners. */
  resetSeq(runId: string): void {
    const entry = this.subscriptions.get(runId);
    if (entry) entry.lastSeq = 0;
  }

  getAll(): Array<{ runId: string; lastSeq: number }> {
    return Array.from(this.subscriptions, ([runId, entry]) => ({
      runId,
      lastSeq: entry.lastSeq,
    }));
  }

  has(runId: string): boolean {
    return this.subscriptions.has(runId);
  }

  getLastSeq(runId: string): number {
    return this.subscriptions.get(runId)?.lastSeq ?? 0;
  }

  getOwnerCount(runId: string): number {
    return this.subscriptions.get(runId)?.owners.size ?? 0;
  }

  dispose(): void {
    this.subscriptions.clear();
  }
}
