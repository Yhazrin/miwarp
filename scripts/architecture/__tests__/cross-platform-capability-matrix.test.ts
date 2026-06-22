/**
 * Cross-platform capability matrix v1.0.9 column shape test.
 *
 * Pins the structure of `docs/architecture/cross-platform-capability-matrix.md`
 * §7 (the v1.0.9 migration matrix). The test asserts:
 *   - The §7 section exists and has the v1.0.9 column header.
 *   - All four platforms (Desktop, Browser WS, iOS, Android) are
 *     mentioned in the matrix.
 *   - The matrix has at least one row per v1.0.9 feature
 *     (Runtime Hub, RuntimeCapabilities, SendTransaction,
 *     PermissionTransaction, RecoveryState, ActorLifecycle,
 *     DiagnosticEvent).
 *
 * Run with: `npx vitest run scripts/architecture/__tests__/cross-platform-capability-matrix.test.ts`
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const MATRIX_FILE = join(REPO_ROOT, "docs", "architecture", "cross-platform-capability-matrix.md");

const PLATFORMS = ["Desktop", "Browser WS", "iOS", "Android"] as const;
const FEATURES = [
  "Runtime Hub",
  "RuntimeCapabilities",
  "SendTransaction",
  "PermissionTransaction",
  "RecoveryState",
  "ActorLifecycle",
  "DiagnosticEvent",
] as const;

describe("v1.0.9 cross-platform capability matrix", () => {
  const src = readFileSync(MATRIX_FILE, "utf-8");

  it("matrix file exists and is non-empty", () => {
    expect(src).toBeTruthy();
    expect(src.length).toBeGreaterThan(1000);
  });

  it("§7 v1.0.9 migration matrix section is present", () => {
    expect(src).toMatch(/## 7\.\s*v1\.0\.9 Migration Compatibility Matrix/);
  });

  it("§7 mentions all four platforms", () => {
    const section7 = extractSection7(src);
    expect(section7, "matrix missing §7 section").toBeTruthy();
    for (const platform of PLATFORMS) {
      expect(section7!, `§7 missing platform "${platform}"`).toContain(platform);
    }
  });

  it("§7 has a header row with the v1.0.9 column", () => {
    const section7 = extractSection7(src);
    expect(section7).toBeTruthy();
    // The header row contains "| Feature" (or similar) AND "| Desktop".
    expect(section7!).toMatch(/\|.*Feature.*\|.*Desktop/);
  });

  it("§7 covers all v1.0.9 features", () => {
    const section7 = extractSection7(src);
    expect(section7).toBeTruthy();
    for (const feature of FEATURES) {
      expect(section7!, `§7 missing feature "${feature}"`).toContain(feature);
    }
  });

  it("§7 documents known gaps section", () => {
    const section7 = extractSection7(src);
    expect(section7).toBeTruthy();
    // The contract doc has a "Known cross-platform gaps" subsection.
    expect(section7!).toMatch(/cross-platform gaps/i);
  });

  it("§7 documents the CI gate command", () => {
    const section7 = extractSection7(src);
    expect(section7).toBeTruthy();
    expect(section7!).toContain("arch:check");
  });
});

/** Extract §7 (the v1.0.9 matrix) from the matrix doc. */
function extractSection7(src: string): string | null {
  const idx = src.indexOf("## 7.");
  if (idx < 0) return null;
  return src.slice(idx);
}
