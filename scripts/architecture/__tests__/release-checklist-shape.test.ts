/**
 * Release / rollback checklist shape test.
 *
 * Pins the structure of the v1.0.9 release and rollback
 * checklists. The test asserts:
 *   - The release checklist enumerates the 10 sections (verify,
 *     arch:check, contract tests, e2e, manual smoke, capability
 *     matrix, CHANGELOG, version sync, tag+publish, post-tag).
 *   - The rollback checklist enumerates the 9 sections
 *     (decision criteria, pre-rollback, triage, execute,
 *     user-side, post-rollback, re-release, post-mortem, ADR).
 *   - Both checklists contain runnable bash command blocks.
 *
 * Run with: `npx vitest run scripts/architecture/__tests__/release-checklist-shape.test.ts`
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const RELEASE_FILE = join(REPO_ROOT, "docs", "architecture", "v1.0.9-release-checklist.md");
const ROLLBACK_FILE = join(REPO_ROOT, "docs", "architecture", "v1.0.9-rollback-checklist.md");

describe("v1.0.9 release checklist", () => {
  const src = readFileSync(RELEASE_FILE, "utf-8");

  it("file exists and is non-empty", () => {
    expect(src).toBeTruthy();
    expect(src.length).toBeGreaterThan(2000);
  });

  it("contains the 10-step verification header sequence", () => {
    // The doc uses "## N. <title>" for steps 1-10. We assert
    // the headers are present in order.
    const headers = [
      "Pre-tag validation",
      "Architecture gate",
      "Contract test suite",
      "Cross-platform smoke test",
      "Manual smoke",
      "Cross-platform capability matrix check",
      "CHANGELOG and release notes",
      "Version sync",
      "Tag and publish",
      "Post-tag verification",
    ];
    let cursor = 0;
    for (const h of headers) {
      const idx = src.indexOf(h, cursor);
      expect(idx, `header missing: "${h}"`).toBeGreaterThan(cursor);
      cursor = idx + h.length;
    }
  });

  it("contains the `npm run verify` command", () => {
    expect(src).toContain("npm run verify");
  });

  it("contains the `npm run arch:check:strict` command", () => {
    expect(src).toContain("arch:check:strict");
  });

  it("contains at least 3 bash command blocks", () => {
    // ```bash ... ``` blocks. A runnable command block is
    // the contract — the integrator copies these into a
    // terminal.
    const matches = src.match(/```bash[\s\S]*?```/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("contains the appendix with CI command reference", () => {
    expect(src).toMatch(/Appendix A: CI command reference/);
  });
});

describe("v1.0.9 rollback checklist", () => {
  const src = readFileSync(ROLLBACK_FILE, "utf-8");

  it("file exists and is non-empty", () => {
    expect(src).toBeTruthy();
    expect(src.length).toBeGreaterThan(2000);
  });

  it("contains the 9-section header sequence", () => {
    const headers = [
      "Decision criteria",
      "Pre-rollback validation",
      "Stop the bleeding",
      "Execute the rollback",
      "User-side rollback",
      "Post-rollback verification",
      "Re-release",
      "Lessons-learned",
      "ADR for the rollback",
    ];
    let cursor = 0;
    for (const h of headers) {
      const idx = src.indexOf(h, cursor);
      expect(idx, `header missing: "${h}"`).toBeGreaterThan(cursor);
      cursor = idx + h.length;
    }
  });

  it("contains the gh release delete command", () => {
    expect(src).toMatch(/gh release delete/);
  });

  it("contains the git reset --hard command (with a contextual warning)", () => {
    // The doc shows `git reset --hard v1.0.8` as a destructive
    // command. We assert the command is present (the
    // destructive flag is intentional and documented).
    expect(src).toContain("git reset --hard");
  });

  it("contains at least 3 bash command blocks", () => {
    const matches = src.match(/```bash[\s\S]*?```/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("contains the storage forward-compatibility note", () => {
    // §Appendix C documents that the storage layer is
    // forward-compatible, which is a load-bearing
    // assumption for the rollback to be safe.
    expect(src).toMatch(/forward-compatib/i);
  });

  it("documents when to use patch vs rollback (Appendix A)", () => {
    expect(src).toMatch(/Rollback vs\. patch/);
  });
});
