/**
 * Bidirectional contract test for the BusEvent union.
 *
 * The Rust backend declares `pub enum BusEvent { ... }` in
 * `src-tauri/src/models.rs`. The frontend declares `export type BusEvent = ...`
 * in `src/lib/types.ts`. These two declarations must stay in sync: a
 * variant added on one side without the other is a silent event loss
 * (frontend drops unknown types, backend serde rejects unknown JSON).
 *
 * This test parses both files with regex, extracts the variant names,
 * and asserts the bidirectional mapping is complete. It is text-only —
 * no TypeScript or Rust compilation — so it runs in milliseconds.
 *
 * If this test fails:
 *   1. Find the missing/extra variant below.
 *   2. Add it to BOTH `src-tauri/src/models.rs` and `src/lib/types.ts`
 *      (or remove it from the side where it shouldn't exist).
 *   3. Update `src-tauri/src/web_server/broadcaster.rs::event_type_name`
 *      to match — it's the log-facing canonical name.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const RUST_FILE = join(REPO_ROOT, "src-tauri", "src", "models.rs");
const TS_FILE = join(REPO_ROOT, "src", "lib", "types.ts");

/** Convert Rust VariantName → snake_case type literal. */
function rustToType(variant: string): string {
  return variant.replace(/([A-Z])/g, (_, c, idx) =>
    idx === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`,
  );
}

/** Extract Rust `BusEvent::VariantName` declarations. */
function extractRustVariants(src: string): string[] {
  const enumStart = src.indexOf("pub enum BusEvent");
  if (enumStart < 0) throw new Error("Could not find `pub enum BusEvent` in models.rs");
  // Find the matching closing brace by counting braces from enumStart.
  const afterEnum = src.indexOf("{", enumStart);
  let depth = 1;
  let i = afterEnum + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  const body = src.slice(afterEnum, i);
  // Variant names are the identifiers at the start of lines (possibly indented).
  const re = /^\s*([A-Z][A-Za-z0-9]*)\s*(?:\{|\(|$)/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

/**
 * Extract frontend `type: "snake_case"` literals from the `BusEvent = ...`
 * union in `src/lib/types.ts`. We deliberately scope to the union body to
 * avoid picking up unrelated `type:` literals (e.g. in nested objects).
 *
 * Approach: locate `export type BusEvent =` and grab everything up to the
 * next top-level `export` statement (or end of file). We rely on the
 * top-level `export` keyword as a boundary instead of `;` (which appears
 * inside comments, object literals, and type expressions).
 */
function extractFrontendTypes(src: string): string[] {
  const start = src.indexOf("export type BusEvent");
  if (start < 0) throw new Error("Could not find `export type BusEvent` in types.ts");
  // Find the next top-level `export` that follows BusEvent's body. Top-level
  // means at the start of a line (no leading whitespace) and is either
  // `export type` / `export interface` / `export enum` / `export const` etc.
  // We look from `start + 20` to skip the BusEvent declaration itself.
  const after = start + 20;
  const tail = src.slice(after);
  // Find the next `\nexport ` (newline + export at column 0).
  const nextExport = tail.search(
    /\nexport\s+(?:type|interface|enum|const|function|class|default|declare|namespace|abstract|async|let|var|import)/,
  );
  const end = nextExport >= 0 ? after + nextExport + 1 /* keep the leading \n */ : src.length;
  const body = src.slice(start, end);
  const re = /type:\s*"([a-z_][a-z0-9_]*)"/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

describe("BusEvent contract", () => {
  const rustSrc = readFileSync(RUST_FILE, "utf-8");
  const tsSrc = readFileSync(TS_FILE, "utf-8");
  const rustVariants = extractRustVariants(rustSrc);
  const tsTypes = extractFrontendTypes(tsSrc);

  it("models.rs and types.ts are readable", () => {
    expect(rustSrc).toContain("pub enum BusEvent");
    expect(tsSrc).toContain("export type BusEvent");
  });

  it("parses the same number of variants on both sides", () => {
    expect(rustVariants.length).toBeGreaterThan(20);
    expect(tsTypes.length).toBeGreaterThan(20);
  });

  it("every Rust variant has a frontend type literal", () => {
    const tsSet = new Set(tsTypes);
    const missing: string[] = [];
    for (const variant of rustVariants) {
      const expected = rustToType(variant);
      if (!tsSet.has(expected)) missing.push(`${variant} → "${expected}"`);
    }
    expect(missing, `Add these to src/lib/types.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("every frontend type literal has a Rust variant", () => {
    const rustSet = new Set(rustVariants.map(rustToType));
    const extra: string[] = [];
    for (const t of tsTypes) {
      if (!rustSet.has(t)) extra.push(t);
    }
    expect(
      extra,
      `Remove these from src/lib/types.ts (no matching Rust variant): ${extra.join(", ")}`,
    ).toEqual([]);
  });

  it("snake_case mapping is consistent (no PascalCase literals in frontend)", () => {
    // Catch typos like type: "SessionInit" instead of "session_init".
    const re = /type:\s*"([A-Z][A-Za-z0-9]*)"/g;
    let m: RegExpExecArray | null;
    const violations: string[] = [];
    while ((m = re.exec(tsSrc))) violations.push(m[1]);
    expect(
      violations,
      `Frontend types must be snake_case. Found: ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("no duplicate type literals in the union", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const t of tsTypes) {
      if (seen.has(t)) dups.push(t);
      seen.add(t);
    }
    expect(dups, `Duplicate type literals: ${dups.join(", ")}`).toEqual([]);
  });

  it("v1.1.0+ BusEvent variants are present in KNOWN_BUS_EVENT_TYPES (P0-1 release gate)", async () => {
    // The protocol-quarantine drops unknown `type` strings to `protocol_desync`.
    // Any new Rust variant that isn't enumerated in `known-event-types.ts`
    // is silently lost on desktop / web, so the allowlist must stay in sync
    // with the Rust enum. This spec catches drift on the three v1.1.0
    // variants (Attention Queue / Runtime Health / Resource Governor).
    const { KNOWN_BUS_EVENT_TYPES } = await import("../known-event-types");
    for (const required of [
      "attention_changed",
      "runtime_health_changed",
      "governor_budget_exceeded",
    ]) {
      expect(
        KNOWN_BUS_EVENT_TYPES.has(required),
        `KNOWN_BUS_EVENT_TYPES is missing "${required}". ` +
          `Add it to src/lib/bus/known-event-types.ts — the protocol-quarantine ` +
          `otherwise drops this BusEvent variant to "protocol_desync".`,
      ).toBe(true);
    }
  });
});
