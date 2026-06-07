/**
 * Tests for the runs-list IDB cache.
 * Uses fake-indexeddb (Vitest setup) to validate merge / remove / eviction
 * without touching a real browser IDB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import type { TaskRun } from "$lib/types";
import {
  clearRunsListCache,
  mergeRunsIntoCache,
  readRunsListCache,
  removeRunFromCache,
  writeRunsListCache,
} from "./runs-list-cache";

const run = (id: string, startedAt: string): TaskRun =>
  ({
    id,
    title: id,
    cwd: "/tmp",
    started_at: startedAt,
    source: "local",
    status: "idle",
    agent: "claude",
  }) as unknown as TaskRun;

describe("runs-list-cache", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("miwarp-runs-list");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array on miss", async () => {
    const out = await readRunsListCache();
    expect(out).toEqual([]);
  });

  it("write then read returns runs sorted by started_at desc", async () => {
    const runs = [run("a", "2026-01-01T00:00:00Z"), run("b", "2026-01-02T00:00:00Z")];
    await writeRunsListCache(runs);
    const out = await readRunsListCache();
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("merge overwrites existing rows and preserves others", async () => {
    await writeRunsListCache([run("a", "2026-01-01T00:00:00Z"), run("b", "2026-01-02T00:00:00Z")]);
    await mergeRunsIntoCache([run("b", "2026-01-03T00:00:00Z"), run("c", "2026-01-04T00:00:00Z")]);
    const out = await readRunsListCache();
    const map = new Map(out.map((r) => [r.id, r.started_at]));
    expect(map.get("b")).toBe("2026-01-03T00:00:00Z");
    expect(map.get("a")).toBe("2026-01-01T00:00:00Z");
    expect(map.get("c")).toBe("2026-01-04T00:00:00Z");
  });

  it("removeRunFromCache deletes a single row", async () => {
    await writeRunsListCache([run("a", "2026-01-01T00:00:00Z"), run("b", "2026-01-02T00:00:00Z")]);
    await removeRunFromCache("a");
    const out = await readRunsListCache();
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  it("clearRunsListCache wipes everything", async () => {
    await writeRunsListCache([run("a", "2026-01-01T00:00:00Z")]);
    await clearRunsListCache();
    const out = await readRunsListCache();
    expect(out).toEqual([]);
  });

  it("merge with empty input is a no-op", async () => {
    await writeRunsListCache([run("a", "2026-01-01T00:00:00Z")]);
    await mergeRunsIntoCache([]);
    const out = await readRunsListCache();
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });
});
