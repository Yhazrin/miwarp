/**
 * Continuity Capsule tests — failure injection + reload semantics.
 *
 * Covers:
 *   - corruption → safe default
 *   - schema version mismatch → safe wipe
 *   - TTL eviction (read + write)
 *   - LRU capacity eviction
 *   - draft sanitization (drops contentBase64, caps text, drops temp paths)
 *   - per-run isolation (one run's draft never leaks into another)
 *   - controller debounce / flush / dispose / generation guard
 *   - one-shot restore (consumePendingRestore returns the same value once)
 *   - fast run-switch: late flush from a previous run is dropped
 *   - missing anchor → caller receives null and falls back to bottom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CAPSULE_DRAFT_TEXT_LIMIT,
  CAPSULE_MAX_RUNS,
  CAPSULE_SCHEMA_VERSION,
  CAPSULE_TTL_MS,
  __setCapsuleForTest,
  clearAllDrafts,
  evictExpired,
  evictLeastRecentlyUsed,
  readCapsuleSnapshot,
  readRunState,
  removeRunState,
  resetCapsule,
  sanitizeDraft,
  sanitizeRunState,
  touchRunState,
  type ContinuityRunState,
} from "./continuity-capsule";
import {
  ContinuityCapsuleController,
  type ContinuitySaveInput,
} from "./continuity-capsule-controller";

// ── localStorage stub (vitest env is "node") ──

class MemoryStorage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.data.keys())[i] ?? null;
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

const STORAGE_KEY = "ocv:continuity-capsule";

function installStorage(initial: Record<string, string> = {}): MemoryStorage {
  const s = new MemoryStorage();
  for (const [k, v] of Object.entries(initial)) s.setItem(k, v);
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = s;
  return s;
}

function makeInput(
  runId: string,
  overrides: Partial<ContinuitySaveInput> = {},
): ContinuitySaveInput {
  return {
    runId,
    cwd: "/Users/test/proj",
    draft: null,
    toolFilter: null,
    processVisibility: "developer",
    anchor: null,
    inspector: {
      toolPanelActiveTab: "workspace",
      requestedPreviewPath: null,
      sidebarCollapsed: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  installStorage();
  resetCapsule();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Schema / corruption ──

describe("continuity capsule · schema + corruption", () => {
  it("returns the default capsule when storage is empty", () => {
    installStorage();
    resetCapsule();
    const snap = readCapsuleSnapshot();
    expect(snap.schemaVersion).toBe(CAPSULE_SCHEMA_VERSION);
    expect(snap.runs).toEqual({});
  });

  it("survives corrupted JSON by returning the default capsule", () => {
    installStorage({ [STORAGE_KEY]: "{not valid json" });
    resetCapsule();
    // Reading must not throw.
    expect(readRunState("any")).toBeNull();
    const snap = readCapsuleSnapshot();
    expect(snap.runs).toEqual({});
  });

  it("wipes the capsule when schema version does not match", () => {
    installStorage({
      [STORAGE_KEY]: JSON.stringify({
        schemaVersion: 999,
        lastUpdatedAt: Date.now(),
        runs: { a: { runId: "a", savedAt: Date.now() } },
      }),
    });
    resetCapsule();
    expect(readRunState("a")).toBeNull();
    const snap = readCapsuleSnapshot();
    expect(snap.runs).toEqual({});
  });

  it("survives non-object root by returning the default capsule", () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify("just a string") });
    resetCapsule();
    expect(readRunState("x")).toBeNull();
  });

  it("drops run entries that fail sanitization", () => {
    installStorage();
    __setCapsuleForTest({
      schemaVersion: CAPSULE_SCHEMA_VERSION,
      lastUpdatedAt: Date.now(),
      runs: {
        ok: {
          runId: "ok",
          cwd: "/a",
          draft: null,
          toolFilter: null,
          processVisibility: "developer",
          anchor: null,
          inspector: {
            toolPanelActiveTab: "workspace",
            requestedPreviewPath: null,
            sidebarCollapsed: false,
          },
          savedAt: Date.now(),
        },
        // runId missing — sanitized to null and dropped
        "": {
          runId: "",
          cwd: "/b",
          draft: null,
          toolFilter: null,
          processVisibility: "developer",
          anchor: null,
          inspector: {
            toolPanelActiveTab: "workspace",
            requestedPreviewPath: null,
            sidebarCollapsed: false,
          },
          savedAt: Date.now(),
        },
      },
    });
    const snap = readCapsuleSnapshot();
    expect(Object.keys(snap.runs).sort()).toEqual(["ok"]);
  });
});

// ── TTL ──

describe("continuity capsule · TTL", () => {
  it("evicts expired entries on read", () => {
    installStorage();
    const now = Date.now();
    __setCapsuleForTest({
      schemaVersion: CAPSULE_SCHEMA_VERSION,
      lastUpdatedAt: now,
      runs: {
        fresh: makeRunState("fresh", now - 1000),
        stale: makeRunState("stale", now - CAPSULE_TTL_MS - 1),
      },
    });
    expect(readRunState("fresh", now)).not.toBeNull();
    // Reading the stale entry lazily drops it from storage.
    expect(readRunState("stale", now)).toBeNull();
    // After the lazy drop, the entry is gone.
    expect(readRunState("stale", now)).toBeNull();
  });

  it("evicts expired entries eagerly via evictExpired", () => {
    const now = Date.now();
    const runs = {
      fresh: makeRunState("fresh", now - 1000),
      stale: makeRunState("stale", now - CAPSULE_TTL_MS - 1000),
    };
    const c = evictExpired(
      {
        schemaVersion: CAPSULE_SCHEMA_VERSION,
        lastUpdatedAt: now,
        runs,
      },
      now,
    );
    expect(Object.keys(c.runs)).toEqual(["fresh"]);
  });

  it("treats savedAt=0 (never saved) as not fresh", () => {
    const now = Date.now();
    const c: {
      schemaVersion: number;
      lastUpdatedAt: number;
      runs: Record<string, ContinuityRunState>;
    } = {
      schemaVersion: CAPSULE_SCHEMA_VERSION,
      lastUpdatedAt: 0,
      runs: { x: { ...makeRunState("x", 0), savedAt: 0 } },
    };
    expect(evictExpired(c, now).runs).toEqual({});
  });
});

// ── Capacity / LRU ──

describe("continuity capsule · LRU capacity", () => {
  it("drops the least-recently-touched first when capacity is exceeded", () => {
    const now = Date.now();
    const runs: Record<string, ContinuityRunState> = {};
    for (let i = 0; i < CAPSULE_MAX_RUNS + 5; i++) {
      const id = `r${i}`;
      runs[id] = makeRunState(id, now - (CAPSULE_MAX_RUNS + 5 - i) * 1000);
    }
    const c = evictLeastRecentlyUsed(
      {
        schemaVersion: CAPSULE_SCHEMA_VERSION,
        lastUpdatedAt: now,
        runs,
      },
      CAPSULE_MAX_RUNS,
      now,
    );
    const ids = Object.keys(c.runs);
    expect(ids).toHaveLength(CAPSULE_MAX_RUNS);
    // The 5 oldest (r0..r4) should have been dropped; the latest
    // (r50..r54) must be present.
    expect(ids).toContain("r54");
    expect(ids).toContain("r50");
    expect(ids).not.toContain("r0");
    expect(ids).not.toContain("r4");
  });

  it("touchRunState caps the total number of runs to CAPSULE_MAX_RUNS", () => {
    installStorage();
    const now = Date.now();
    for (let i = 0; i < CAPSULE_MAX_RUNS + 10; i++) {
      touchRunState(`r${i}`, { cwd: `/r${i}` }, now + i);
    }
    const snap = readCapsuleSnapshot();
    expect(Object.keys(snap.runs)).toHaveLength(CAPSULE_MAX_RUNS);
  });
});

// ── Sanitization ──

describe("continuity capsule · draft sanitization", () => {
  it("never persists contentBase64 (potential token / secret vector)", () => {
    const raw = {
      text: "hello",
      attachments: [
        {
          id: "a1",
          name: "secret.pdf",
          type: "application/pdf",
          size: 100,
          contentBase64: "VERY_SECRET_BASE64_DATA",
        },
      ],
      pastedBlocks: [],
      pathRefs: [],
      savedAt: Date.now(),
    };
    const sanitized = sanitizeDraft(raw);
    expect(sanitized).not.toBeNull();
    const att = sanitized!.attachments[0];
    expect(att).toBeDefined();
    expect(att).not.toHaveProperty("contentBase64");
    expect(att.id).toBe("a1");
  });

  it("caps oversized text to CAPSULE_DRAFT_TEXT_LIMIT", () => {
    const huge = "x".repeat(CAPSULE_DRAFT_TEXT_LIMIT * 2);
    const sanitized = sanitizeDraft({
      text: huge,
      attachments: [],
      pastedBlocks: [],
      pathRefs: [],
      savedAt: Date.now(),
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized!.text.length).toBe(CAPSULE_DRAFT_TEXT_LIMIT);
  });

  it("returns null for an empty draft so it doesn't haunt a clean state", () => {
    const sanitized = sanitizeDraft({
      text: "",
      attachments: [],
      pastedBlocks: [],
      pathRefs: [],
      savedAt: Date.now(),
    });
    expect(sanitized).toBeNull();
  });

  it("drops attachment rows that lack an id", () => {
    const sanitized = sanitizeDraft({
      text: "x",
      attachments: [{ name: "no-id" }, { id: "ok", name: "ok" }],
      pastedBlocks: [],
      pathRefs: [],
      savedAt: Date.now(),
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized!.attachments).toHaveLength(1);
    expect(sanitized!.attachments[0].id).toBe("ok");
  });

  it("caps oversized pasted block text", () => {
    const sanitized = sanitizeDraft({
      text: "",
      attachments: [],
      pastedBlocks: [
        {
          id: "p1",
          text: "y".repeat(300_000),
          lineCount: 1,
          charCount: 300_000,
          preview: "huge",
        },
      ],
      pathRefs: [],
      savedAt: Date.now(),
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized!.pastedBlocks[0].text.length).toBeLessThanOrEqual(256 * 1024);
  });

  it("drops pathRefs without a path", () => {
    const sanitized = sanitizeDraft({
      text: "",
      attachments: [],
      pastedBlocks: [],
      pathRefs: [
        { id: "r1", name: "r1" },
        { id: "r2", name: "r2", path: "/abs/r2" },
      ],
      savedAt: Date.now(),
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized!.pathRefs).toHaveLength(1);
    expect(sanitized!.pathRefs[0].path).toBe("/abs/r2");
  });

  it("caps pathRef path length to a sane bound", () => {
    const sanitized = sanitizeDraft({
      text: "",
      attachments: [],
      pastedBlocks: [],
      pathRefs: [{ id: "p", name: "p", path: "/".padEnd(10_000, "a") }],
      savedAt: Date.now(),
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized!.pathRefs[0].path.length).toBeLessThanOrEqual(4096);
  });
});

// ── Run isolation ──

describe("continuity capsule · per-run isolation", () => {
  it("keeps two runs' drafts fully separate", () => {
    installStorage();
    const now = Date.now();
    touchRunState(
      "r1",
      {
        draft: {
          text: "draft 1",
          attachments: [],
          pastedBlocks: [],
          pathRefs: [],
          savedAt: now,
        },
      },
      now,
    );
    touchRunState(
      "r2",
      {
        draft: {
          text: "draft 2",
          attachments: [],
          pastedBlocks: [],
          pathRefs: [],
          savedAt: now,
        },
      },
      now + 1,
    );
    const r1 = readRunState("r1", now + 1);
    const r2 = readRunState("r2", now + 1);
    expect(r1?.draft?.text).toBe("draft 1");
    expect(r2?.draft?.text).toBe("draft 2");
  });

  it("removing one run does not affect the other", () => {
    installStorage();
    const now = Date.now();
    touchRunState("r1", { cwd: "/a" }, now);
    touchRunState("r2", { cwd: "/b" }, now + 1);
    removeRunState("r1");
    expect(readRunState("r1", now + 2)).toBeNull();
    expect(readRunState("r2", now + 2)).not.toBeNull();
  });

  it("sanitizeRunState defaults the inspector when input is missing", () => {
    const r = sanitizeRunState({}, "fallback");
    expect(r).not.toBeNull();
    expect(r!.inspector.toolPanelActiveTab).toBe("workspace");
    expect(r!.inspector.sidebarCollapsed).toBe(false);
    expect(r!.inspector.requestedPreviewPath).toBeNull();
  });

  it("sanitizeRunState ignores unknown tool panel tabs", () => {
    const r = sanitizeRunState(
      {
        runId: "x",
        inspector: { toolPanelActiveTab: "bogus-tab" },
      },
      "x",
    );
    expect(r?.inspector.toolPanelActiveTab).toBe("workspace");
  });
});

// ── Controller: debounce / flush / dispose / generation guard ──

describe("continuity capsule controller", () => {
  function makeController(
    opts: Partial<{
      capture: () => ContinuitySaveInput | null;
      timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
      debounceMs: number;
    }> = {},
  ) {
    const capture = opts.capture ?? (() => makeInput("r1"));
    return new ContinuityCapsuleController({
      capture,
      timers: opts.timers,
      debounceMs: opts.debounceMs ?? 30,
    });
  }

  it("debounces multiple scheduleSave calls inside the window into one flush", async () => {
    installStorage();
    const ctrl = makeController();
    ctrl.scheduleSave("r1");
    ctrl.scheduleSave("r1");
    ctrl.scheduleSave("r1");
    await new Promise((r) => setTimeout(r, 60));
    // Only one storage entry should exist for r1.
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Object.keys(parsed.runs)).toEqual(["r1"]);
  });

  it("flushSync writes immediately and flush is idempotent across calls", () => {
    installStorage();
    const ctrl = makeController();
    const ok = ctrl.flush("manual");
    expect(ok).toBe(true);
    const snap = readCapsuleSnapshot();
    expect(snap.runs["r1"]).toBeDefined();
    // Idempotent — calling flush again on the same run is fine.
    expect(ctrl.flush("manual")).toBe(true);
    ctrl.dispose();
  });

  it("discards a flush whose runId no longer matches (run switch)", () => {
    installStorage();
    const ctrl = makeController();
    ctrl.scheduleSave("r1");
    // Simulate a run switch BEFORE the debounce timer fires.
    ctrl.switchRun("r2");
    // The pending r1 debounce should have been dropped.
    const stored = readRunState("r1");
    expect(stored).toBeNull();
    ctrl.dispose();
  });

  it("fast run-switch: late debounce from previous run is dropped", async () => {
    installStorage();
    // Capture returns the input matching the controller's currentRunId —
    // mirrors the chat page's actual capture logic (each render reads the
    // currently mounted run's state).
    const inputs = new Map<string, ContinuitySaveInput>();
    let currentRunId = "";
    const ctrl = new ContinuityCapsuleController({
      capture: () => inputs.get(currentRunId) ?? null,
      debounceMs: 20,
    });
    // Keep the external `currentRunId` mirror in sync with the controller
    // so the capture closure can resolve the active run's snapshot.
    const syncCurrent = (id: string) => {
      currentRunId = id;
    };
    inputs.set("r1", makeInput("r1", { cwd: "/r1" }));
    inputs.set("r2", makeInput("r2", { cwd: "/r2" }));
    syncCurrent("r1");
    ctrl.scheduleSave("r1");
    // Switch before the timer fires — the r1 debounce must be dropped.
    syncCurrent("r2");
    ctrl.switchRun("r2");
    ctrl.scheduleSave("r2");
    await new Promise((r) => setTimeout(r, 60));
    // r1 must NOT have leaked into the capsule.
    expect(readRunState("r1")).toBeNull();
    // r2 must have landed.
    expect(readRunState("r2")?.cwd).toBe("/r2");
    ctrl.dispose();
  });

  it("dispose invalidates the generation so a delayed debounce is dropped", async () => {
    installStorage();
    const ctrl = makeController();
    const genBefore = ctrl.__getGen();
    ctrl.scheduleSave("r1");
    ctrl.dispose();
    expect(ctrl.__getGen()).toBeGreaterThan(genBefore);
    await new Promise((r) => setTimeout(r, 60));
    expect(readRunState("r1")).toBeNull();
  });

  it("dispose cancels the debounce timer", () => {
    installStorage();
    const ctrl = makeController({ debounceMs: 1000 });
    ctrl.scheduleSave("r1");
    ctrl.dispose();
    expect(ctrl.__peekPendingRestore()).toBeNull();
  });

  it("invalidateRun removes the entry and clears any pending restore", async () => {
    installStorage();
    const now = Date.now();
    touchRunState("r1", { cwd: "/x" }, now);
    const ctrl = makeController();
    await ctrl.seedAsync("r1", now + 1);
    expect(ctrl.__peekPendingRestore()).not.toBeNull();
    ctrl.invalidateRun("r1");
    expect(ctrl.__peekPendingRestore()).toBeNull();
    expect(readRunState("r1")).toBeNull();
    ctrl.dispose();
  });

  it("seedAsync populates pendingRestore exactly once; consumePendingRestore clears it", async () => {
    installStorage();
    const now = Date.now();
    touchRunState(
      "r1",
      {
        cwd: "/saved",
        draft: {
          text: "restored",
          attachments: [],
          pastedBlocks: [],
          pathRefs: [],
          savedAt: now,
        },
        toolFilter: "Bash",
        processVisibility: "expert",
        anchor: { entryId: "msg-42", offsetPx: 120 },
        inspector: {
          toolPanelActiveTab: "files",
          requestedPreviewPath: "/Users/test/foo.txt",
          sidebarCollapsed: true,
        },
      },
      now,
    );
    const ctrl = makeController();
    const seeded = await ctrl.seedAsync("r1", now + 1);
    expect(seeded).toBe(true);
    const r1 = ctrl.consumePendingRestore();
    expect(r1).not.toBeNull();
    expect(r1!.draft?.text).toBe("restored");
    expect(r1!.toolFilter).toBe("Bash");
    expect(r1!.processVisibility).toBe("expert");
    expect(r1!.anchor).toEqual({ entryId: "msg-42", offsetPx: 120 });
    expect(r1!.inspector.toolPanelActiveTab).toBe("files");
    expect(r1!.inspector.sidebarCollapsed).toBe(true);
    expect(r1!.inspector.requestedPreviewPath).toBe("/Users/test/foo.txt");
    expect(r1!.cwd).toBe("/saved");
    // Second consume is null — one-shot.
    expect(ctrl.consumePendingRestore()).toBeNull();
    ctrl.dispose();
  });

  it("seedAsync returns false and yields no restore for an expired entry", async () => {
    installStorage();
    const now = Date.now();
    touchRunState("r1", { cwd: "/old" }, now - CAPSULE_TTL_MS - 1);
    const ctrl = makeController();
    const seeded = await ctrl.seedAsync("r1", now);
    expect(seeded).toBe(false);
    expect(ctrl.consumePendingRestore()).toBeNull();
    ctrl.dispose();
  });

  it("seedAsync returns false for an unknown run id", async () => {
    installStorage();
    const ctrl = makeController();
    const seeded = await ctrl.seedAsync("never-saved", Date.now());
    expect(seeded).toBe(false);
    ctrl.dispose();
  });

  it("flush with no current run is a no-op", () => {
    installStorage();
    // No current run → capture returns null (the chat page only calls
    // capture while a run is mounted, so this represents the welcome
    // screen / pre-mount state).
    const ctrl = new ContinuityCapsuleController({
      capture: () => null,
      debounceMs: 30,
    });
    expect(ctrl.flush("manual")).toBe(false);
    ctrl.dispose();
  });

  it("flush with capture returning null is a no-op", () => {
    installStorage();
    const ctrl = new ContinuityCapsuleController({
      capture: () => null,
      debounceMs: 30,
    });
    expect(ctrl.flush("manual")).toBe(false);
    ctrl.dispose();
  });

  it("clearAllDrafts removes drafts from every run but keeps view state", () => {
    installStorage();
    const now = Date.now();
    touchRunState(
      "r1",
      {
        draft: {
          text: "keep me? no",
          attachments: [],
          pastedBlocks: [],
          pathRefs: [],
          savedAt: now,
        },
        toolFilter: "Bash",
      },
      now,
    );
    touchRunState(
      "r2",
      {
        draft: {
          text: "and me",
          attachments: [],
          pastedBlocks: [],
          pathRefs: [],
          savedAt: now,
        },
      },
      now + 1,
    );
    clearAllDrafts(now + 2);
    expect(readRunState("r1", now + 3)?.draft).toBeNull();
    expect(readRunState("r2", now + 3)?.draft).toBeNull();
    // View state preserved
    expect(readRunState("r1", now + 3)?.toolFilter).toBe("Bash");
  });

  it("switchRun from empty to a run does not invoke capture (no prior state)", () => {
    installStorage();
    const capture = vi.fn(() => makeInput("r1"));
    const ctrl = new ContinuityCapsuleController({ capture, debounceMs: 30 });
    ctrl.switchRun("r1");
    expect(capture).not.toHaveBeenCalled();
    ctrl.dispose();
  });
});

// ── Anchor fallback ──

describe("continuity capsule · anchor fallback", () => {
  it("returns null anchor when the stored entry has no anchor", () => {
    installStorage();
    const now = Date.now();
    touchRunState("r1", { cwd: "/x" }, now);
    const entry = readRunState("r1", now + 1);
    expect(entry?.anchor).toBeNull();
  });

  it("preserves anchor offset that the chat page can apply once the entry is found", () => {
    installStorage();
    const now = Date.now();
    touchRunState("r1", { anchor: { entryId: "msg-77", offsetPx: 240 } }, now);
    const entry = readRunState("r1", now + 1);
    expect(entry?.anchor).toEqual({ entryId: "msg-77", offsetPx: 240 });
  });
});

// ── helpers ──

function makeRunState(runId: string, savedAt: number): ContinuityRunState {
  return {
    runId,
    cwd: "/x",
    draft: null,
    toolFilter: null,
    processVisibility: "developer",
    anchor: null,
    inspector: {
      toolPanelActiveTab: "workspace",
      requestedPreviewPath: null,
      sidebarCollapsed: false,
    },
    savedAt,
  };
}
