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
const DB_VERSION = 2;
const STORE_NAME = "snapshots";

/** Bump when reducer logic changes to invalidate all cached snapshots. */
const SNAPSHOT_VERSION = 2;

/** Max cached snapshots. Evicts least-recently-accessed when exceeded. */
const MAX_ENTRIES = 200;
const IDB_TIMEOUT_MS = 800;

interface SnapshotRecord {
  runId: string; // primary key
  version: number; // SNAPSHOT_VERSION
  runStatus: string; // terminal status at save time
  body: string; // JSON.stringify of snapshot body
  savedAt: number; // Date.now()
}

// ── Singleton DB connection ──

let dbPromise: Promise<IDBDatabase> | null = null;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${IDB_TIMEOUT_MS}ms`));
    }, IDB_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      fn();
    };
    const timer = window.setTimeout(() => {
      dbPromise = null;
      finish(() => reject(new Error(`IndexedDB open timed out after ${IDB_TIMEOUT_MS}ms`)));
    }, IDB_TIMEOUT_MS);
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
    req.onsuccess = () => finish(() => resolve(req.result));
    req.onerror = () => {
      dbPromise = null; // allow retry
      finish(() => reject(req.error));
    };
    req.onblocked = () => {
      dbPromise = null;
      finish(() => reject(new Error("IndexedDB open blocked by another MiWarp window")));
    };
  });
  return dbPromise;
}

// ── Public API ──

/**
 * Read a validated snapshot.
 * Returns body string on hit, null on miss/stale.
 * Validates: version === SNAPSHOT_VERSION && runStatus === expectedStatus.
 */
export async function readSnapshot(runId: string, expectedStatus: string): Promise<string | null> {
  try {
    const db = await withTimeout(getDb(), "IndexedDB snapshot open");
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const record: SnapshotRecord | undefined = await withTimeout(
      new Promise((resolve, reject) => {
        const req = store.get(runId);
        req.onsuccess = () => resolve(req.result as SnapshotRecord | undefined);
        req.onerror = () => reject(req.error);
      }),
      "IndexedDB snapshot read",
    );

    if (!record) {
      dbg("snapshot", "read:miss", { runId });
      return null;
    }

    if (record.version !== SNAPSHOT_VERSION) {
      dbg("snapshot", "read:stale", {
        runId,
        reason: "version",
        got: record.version,
        want: SNAPSHOT_VERSION,
      });
      deleteSnapshot(runId).catch(() => {});
      return null;
    }

    if (record.runStatus !== expectedStatus) {
      dbg("snapshot", "read:stale", {
        runId,
        reason: "status",
        got: record.runStatus,
        want: expectedStatus,
      });
      deleteSnapshot(runId).catch(() => {});
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
export async function writeSnapshot(runId: string, runStatus: string, body: string): Promise<void> {
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
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dbg("snapshot", "write", { runId, runStatus, bytes: body.length });

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
