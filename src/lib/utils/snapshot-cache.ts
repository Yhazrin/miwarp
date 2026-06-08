/**
 * IndexedDB snapshot cache for terminal session state.
 *
 * Caches the reducer output (timeline, usage, tools, etc.) so that
 * revisiting a finished session skips getBusEvents IPC + reducer replay.
 *
 * Cache invalidation:
 * - SNAPSHOT_VERSION bump → readSnapshot rejects stale records
 * - runStatus mismatch → readSnapshot rejects
 * - resumeSession → explicit deleteSnapshot (session goes live)
 * - syncCliSession appends events → explicit deleteSnapshot
 * - IDB unavailable → graceful fallback (readSnapshot returns null)
 */
import { dbg, dbgWarn } from "$lib/utils/debug";

const DB_NAME = "miwarp-snapshot";
const DB_VERSION = 3;
const STORE_NAME = "snapshots";

/** Bump when reducer logic changes to invalidate all cached snapshots. */
const SNAPSHOT_VERSION = 3;

/** Max cached snapshots. Evicts least-recently-accessed when exceeded. */
const MAX_ENTRIES = 200;

export interface SnapshotRecord {
  runId: string; // primary key
  version: number; // SNAPSHOT_VERSION
  runStatus: string; // terminal status at save time
  body: string; // JSON.stringify of snapshot body
  savedAt: number; // Date.now()
  /** True when the snapshot was captured mid-run and may be incomplete. */
  partial?: boolean;
  /** Highest seq number included in this snapshot (used for incremental catchup). */
  seqHighWatermark?: number;
  /** Schema version of the persisted body (decoupled from SNAPSHOT_VERSION). */
  schemaVersion?: number;
}

// ── Singleton DB connection ──

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "runId" });
        store.createIndex("savedAt", "savedAt", { unique: false });
      } else {
        // v2: add savedAt index if upgrading from v1
        const tx = req.transaction!;
        const store = tx.objectStore(STORE_NAME);
        if (!store.indexNames.contains("savedAt")) {
          store.createIndex("savedAt", "savedAt", { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null; // allow retry
      reject(req.error);
    };
  });
  return dbPromise;
}

// ── Public API ──

/**
 * Read a validated snapshot.
 * Returns body string on hit, null on miss/stale.
 * Validates: version === SNAPSHOT_VERSION && runStatus === expectedStatus.
 * Pass `acceptPartial: true` to allow running-state snapshots that may be incomplete.
 */
export async function readSnapshot(
  runId: string,
  expectedStatus: string,
  opts?: { acceptPartial?: boolean },
): Promise<string | null> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const record: SnapshotRecord | undefined = await new Promise((resolve, reject) => {
      const req = store.get(runId);
      req.onsuccess = () => resolve(req.result as SnapshotRecord | undefined);
      req.onerror = () => reject(req.error);
    });

    if (!record) {
      dbg("snapshot", "read:miss", { runId });
      return null;
    }

    // Reject partial snapshots unless caller explicitly opts in.
    if (record.partial && !opts?.acceptPartial) {
      dbg("snapshot", "read:skipped-partial", { runId });
      return null;
    }

    if (record.version !== SNAPSHOT_VERSION) {
      dbg("snapshot", "read:stale", {
        runId,
        reason: "version",
        got: record.version,
        want: SNAPSHOT_VERSION,
      });
      deleteSnapshot(runId).catch((e) => dbg("snapshot", "stale cleanup failed:", e));
      return null;
    }

    if (record.runStatus !== expectedStatus) {
      dbg("snapshot", "read:stale", {
        runId,
        reason: "status",
        got: record.runStatus,
        want: expectedStatus,
      });
      deleteSnapshot(runId).catch((e) => dbg("snapshot", "stale cleanup failed:", e));
      return null;
    }

    dbg("snapshot", "read", { runId, hit: true, bytes: record.body.length });
    return record.body;
  } catch (err) {
    dbgWarn("snapshot", "read:error", err);
    return null;
  }
}

/** Write a snapshot. Evicts oldest entries if cache exceeds MAX_ENTRIES. */
export async function writeSnapshot(
  runId: string,
  runStatus: string,
  body: string,
  opts?: { partial?: boolean; seqHighWatermark?: number; schemaVersion?: number },
): Promise<void> {
  try {
    const db = await getDb();

    // Write the new record
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const record: SnapshotRecord = {
        runId,
        version: SNAPSHOT_VERSION,
        runStatus,
        body,
        savedAt: Date.now(),
        partial: opts?.partial,
        seqHighWatermark: opts?.seqHighWatermark,
        schemaVersion: opts?.schemaVersion,
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dbg("snapshot", "write", {
      runId,
      runStatus,
      bytes: body.length,
      partial: !!opts?.partial,
      seqHighWatermark: opts?.seqHighWatermark,
    });

    // LRU eviction in a separate transaction (IDB auto-commits after each await)
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (count > MAX_ENTRIES) {
      const toEvict = count - MAX_ENTRIES;
      let evicted = 0;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const cursorReq = store.index("savedAt").openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && evicted < toEvict) {
            cursor.delete();
            evicted++;
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      if (evicted > 0) dbg("snapshot", "evict", { count, evicted });
    }
  } catch (err) {
    dbgWarn("snapshot", "write:error", err);
  }
}

/** Delete a snapshot (e.g. after resume or sync). */
export async function deleteSnapshot(runId: string): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const req = store.delete(runId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    dbg("snapshot", "delete", { runId });
  } catch (err) {
    dbgWarn("snapshot", "delete:error", err);
  }
}
