/**
 * IndexedDB cache for the runs sidebar list.
 *
 * Why this exists (Local-first / 0.1):
 * - Sidebar rendering used to wait on a full `listRuns` IPC call that
 *   walks `~/.miwarp/runs/<id>/meta.json + events.jsonl` — slow on cold start.
 * - This cache gives the sidebar an instant render from local IDB; the
 *   authoritative list is then merged in via `listRunsSince()` (background).
 *
 * Cache shape:
 * - One row per run, keyed by runId.
 * - Stale-while-revalidate: read returns whatever is on disk, even if
 *   slightly old; the page issues a fresh listRuns / listRunsSince
 *   to reconcile.
 *
 * Invalidation:
 * - Bumping `RUNS_LIST_VERSION` invalidates everything (schema change).
 * - Background sync uses `updated_at` to merge, not full replace.
 * - On user-triggered delete / move, callers must invoke `removeRunFromCache()`.
 */
import type { TaskRun } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

const DB_NAME = "miwarp-runs-list";
const DB_VERSION = 1;
const STORE_NAME = "runs";

/** Bump when the TaskRun shape changes incompatibly. */
const RUNS_LIST_VERSION = 1;

/** Soft cap; older runs get evicted when exceeded (LRU by updatedAt). */
const MAX_ENTRIES = 500;

interface RunListEntry {
  runId: string;
  run: TaskRun;
  updatedAt: number;
  version: number;
}

interface RunListEnvelope {
  version: number;
  savedAt: number;
  entries: Array<{ runId: string; run: TaskRun; updatedAt: number }>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "runId" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/**
 * Read the cached runs list (sidebar-suitable).
 * Returns an empty array on miss / IDB unavailability / version mismatch.
 */
export async function readRunsListCache(): Promise<TaskRun[]> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const records: RunListEntry[] = await new Promise((resolve, reject) => {
      const out: RunListEntry[] = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          out.push(cursor.value as RunListEntry);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    const valid = records.filter((r) => r.version === RUNS_LIST_VERSION);
    const runs = valid
      .map((r) => r.run)
      .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));
    dbg("runsList", "read", { count: runs.length, dropped: records.length - valid.length });
    return runs;
  } catch (err) {
    dbgWarn("runsList", "read:error", err);
    return [];
  }
}

/**
 * Write the full runs list (replaces prior contents).
 * Used right after a successful `listRuns()` IPC — the source of truth
 * for the cache. Background incremental updates should use
 * `mergeRunsIntoCache()` instead.
 */
export async function writeRunsListCache(runs: TaskRun[]): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      for (const run of runs) {
        if (!run?.id) continue;
        const entry: RunListEntry = {
          runId: run.id,
          run,
          updatedAt: now,
          version: RUNS_LIST_VERSION,
        };
        store.put(entry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dbg("runsList", "write", { count: runs.length });
    await evictIfNeeded();
  } catch (err) {
    dbgWarn("runsList", "write:error", err);
  }
}

/**
 * Merge a partial set of runs (e.g. from `listRunsSince`) into the cache.
 * Existing rows are overwritten with the new payload; runs not in `runs`
 * are untouched (callers must invoke `removeRunFromCache` for deletions).
 */
export async function mergeRunsIntoCache(runs: TaskRun[]): Promise<void> {
  if (runs.length === 0) return;
  try {
    const db = await getDb();
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const run of runs) {
        if (!run?.id) continue;
        const entry: RunListEntry = {
          runId: run.id,
          run,
          updatedAt: now,
          version: RUNS_LIST_VERSION,
        };
        store.put(entry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dbg("runsList", "merge", { count: runs.length });
    await evictIfNeeded();
  } catch (err) {
    dbgWarn("runsList", "merge:error", err);
  }
}

/** Remove a single run from the cache (e.g. after user deletes it). */
export async function removeRunFromCache(runId: string): Promise<void> {
  if (!runId) return;
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(runId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    dbg("runsList", "remove", { runId });
  } catch (err) {
    dbgWarn("runsList", "remove:error", err);
  }
}

/** Clear the entire cache (e.g. on logout / corruption). */
export async function clearRunsListCache(): Promise<void> {
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    dbg("runsList", "clear");
  } catch (err) {
    dbgWarn("runsList", "clear:error", err);
  }
}

async function evictIfNeeded(): Promise<void> {
  try {
    const db = await getDb();
    const count: number = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (count <= MAX_ENTRIES) return;
    const toEvict = count - MAX_ENTRIES;
    let evicted = 0;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const cursorReq = store.index("updatedAt").openCursor();
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
    if (evicted > 0) dbg("runsList", "evict", { count, evicted });
  } catch (err) {
    dbgWarn("runsList", "evict:error", err);
  }
}

/** Internal envelope type — exported for tests only. */
export type { RunListEnvelope };
