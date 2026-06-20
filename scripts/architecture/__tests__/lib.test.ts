/**
 * Tests for the shared architecture-script helpers.
 *
 * These tests are run by Vitest as part of `npm test`. They cover the
 * pure functions in `scripts/architecture/lib.mjs`:
 *   - extractStaticImports (JS/TS/Svelte imports)
 *   - extractCrateImports (Rust use crate::...)
 *   - tarjanSCC (cycle detection)
 *
 * The four architecture check scripts themselves (direction-check, layer-
 * import-check, cycle-check, file-budget) are tested via the same helpers
 * they consume, plus a handful of "did it run / did it exit 0" smoke tests
 * against the real repo.
 */
import { describe, expect, it } from "vitest";
import {
  extractCrateImports,
  extractStaticImports,
  tarjanSCC,
} from "../lib.mjs";

describe("extractStaticImports", () => {
  it("captures default and named imports", () => {
    const src = `
import { foo } from "./bar";
import baz from "qux";
import * as ns from "./mod";
`;
    expect(extractStaticImports(src).sort()).toEqual(["./bar", "./mod", "qux"]);
  });

  it("captures re-exports", () => {
    const src = `
export { a } from "./alpha";
export * from "./beta";
`;
    expect(extractStaticImports(src).sort()).toEqual(["./alpha", "./beta"]);
  });

  it("ignores dynamic import() expressions", () => {
    const src = `
const m = await import("@tauri-apps/api/core");
`;
    // Dynamic imports are intentionally skipped — ESLint allows them.
    expect(extractStaticImports(src)).toEqual([]);
  });

  it("handles both quote styles", () => {
    const src = `
import a from "double";
import b from 'single';
`;
    expect(extractStaticImports(src).sort()).toEqual(["double", "single"]);
  });
});

describe("extractCrateImports", () => {
  it("captures top-level crate paths", () => {
    const src = `
use crate::models::BusEvent;
use crate::storage::events::EventWriter;
use crate::agent::turn_engine;
`;
    expect(extractCrateImports(src).sort()).toEqual([
      "agent::turn_engine",
      "models::BusEvent",
      "storage::events::EventWriter",
    ]);
  });

  it("ignores std and third-party crates", () => {
    const src = `
use serde::Serialize;
use std::time::Duration;
use tokio::sync::mpsc;
use crate::commands::session;
`;
    expect(extractCrateImports(src)).toEqual(["commands::session"]);
  });
});

describe("tarjanSCC", () => {
  it("returns singletons for an acyclic graph", () => {
    const nodes = ["a", "b", "c"];
    const edges = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set()],
    ]);
    const sccs = tarjanSCC(nodes, edges);
    expect(sccs).toHaveLength(3);
    for (const scc of sccs) expect(scc).toHaveLength(1);
  });

  it("finds a 2-node cycle", () => {
    const nodes = ["a", "b"];
    const edges = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    const sccs = tarjanSCC(nodes, edges);
    const nonTrivial = sccs.filter((scc) => scc.length > 1);
    expect(nonTrivial).toHaveLength(1);
    expect(new Set(nonTrivial[0])).toEqual(new Set(["a", "b"]));
  });

  it("finds a 3-node cycle plus a tail", () => {
    const nodes = ["a", "b", "c", "d"];
    const edges = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set(["a"])], // a -> b -> c -> a
      ["d", new Set(["a"])],
    ]);
    const sccs = tarjanSCC(nodes, edges);
    const nonTrivial = sccs.filter((scc) => scc.length > 1);
    expect(nonTrivial).toHaveLength(1);
    expect(new Set(nonTrivial[0])).toEqual(new Set(["a", "b", "c"]));
  });

  it("handles self-loops as singleton SCCs (size 1)", () => {
    const nodes = ["a"];
    const edges = new Map([["a", new Set(["a"])]]);
    const sccs = tarjanSCC(nodes, edges);
    // Self-loops don't form a real cycle for our purposes.
    expect(sccs).toHaveLength(1);
    expect(sccs[0]).toEqual(["a"]);
  });
});
