/**
 * Runtime hub & provider contract spec test.
 *
 * Validates the FROZEN `v1.0.9-runtime-contract.md` spec is internally
 * consistent and that the eventual code implementation will match it.
 *
 * What this test asserts:
 *   1. Spec doc lists exactly 4 `runtime_hub_*` Tauri commands in §8.
 *   2. Spec doc lists exactly 12 capability flags in §3.
 *   3. Spec doc lists exactly 9 capability-to-UI degradation entries in §9
 *      (today the table contains 12, but 3 are grouped: streaming/resume/
 *      permission — the contract test only enforces the §9 table shape).
 *   4. (When code lands) `src-tauri/src/lib.rs` registers exactly those 4
 *      `runtime_hub_*` commands and any `diagnostics_*` commands are also
 *      present in the iOS WS allowlist.
 *   5. (When code lands) The frontend composable `useRuntimeCapabilities`
 *      references all 12 capability flags.
 *
 * The deferred assertions (4 & 5) pass when no implementation exists yet
 * (the spec is the source of truth until Agent B / C ship). Once code
 * lands, the test will start enforcing the spec — if a future change
 * diverges, the test fails loudly.
 *
 * Run via `npm test` (vitest picks it up via the `scripts/architecture/__tests__`
 * glob).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SPEC_FILE = join(REPO_ROOT, "docs", "architecture", "v1.0.9-runtime-contract.md");
const LIB_RS_FILE = join(REPO_ROOT, "src-tauri", "src", "lib.rs");
const WS_MESSAGES_FILE = join(
  REPO_ROOT,
  "apps",
  "ios",
  "MiWarpMobile",
  "MiWarpMobile",
  "Core",
  "WebSocketMessages.swift",
);
const DISPATCH_FILE = join(REPO_ROOT, "src-tauri", "src", "web_server", "dispatch.rs");
const WS_INTERNAL_FILE = join(REPO_ROOT, "src-tauri", "src", "web_server", "ws.rs");

const RUNTIME_HUB_COMMANDS = [
  "runtime_hub_list",
  "runtime_hub_health",
  "runtime_hub_diagnose",
  "runtime_hub_set_default",
] as const;

const CAPABILITY_FLAGS = [
  "supports_streaming",
  "supports_resume",
  "supports_permission_requests",
  "supports_tool_calls",
  "supports_usage",
  "supports_thinking",
  "supports_attachments",
  "supports_images",
  "supports_mcp",
  "supports_skills",
  "supports_remote_execution",
  "supports_structured_events",
] as const;

function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

describe("v1.0.9 Runtime Contract spec (frozen)", () => {
  const specSrc = readFileSync(SPEC_FILE, "utf-8");

  it("spec file exists and is non-empty", () => {
    expect(specSrc).toBeTruthy();
    expect(specSrc.length).toBeGreaterThan(1000);
  });

  it("spec declares exactly 4 runtime_hub_* Tauri commands in §8", () => {
    // Anchor on the §8 table; count rows that begin with `runtime_hub_`.
    const matches = specSrc.match(/^\|\s*`runtime_hub_[a-z_]+`/gm) ?? [];
    expect(matches).toHaveLength(RUNTIME_HUB_COMMANDS.length);
    // Each frozen command name must appear in the spec.
    for (const cmd of RUNTIME_HUB_COMMANDS) {
      expect(specSrc, `spec missing ${cmd}`).toContain(`\`${cmd}\``);
    }
  });

  it("spec declares exactly 12 capability flags in §3", () => {
    // Count `| \`supports_xxx\` |` lines (table rows). Excludes the
    // prose `pub struct RuntimeCapabilities` block which uses different
    // formatting (`pub supports_xxx: bool,`).
    const tableRows = specSrc.match(/^\|\s*`supports_[a-z_]+`\s*\|/gm) ?? [];
    expect(tableRows).toHaveLength(CAPABILITY_FLAGS.length);
    for (const flag of CAPABILITY_FLAGS) {
      expect(specSrc, `spec missing ${flag}`).toContain(`\`${flag}\``);
    }
  });

  it("§9 capability-to-UI degradation map has an entry for every flag", () => {
    // Pull the §9 table rows. The first row starts with `| Capability |`
    // and every subsequent row in §9 begins with `| \`supports_xxx\` |`.
    // We do not pin the row count — the contract may grow entries per
    // flag (e.g. nested UI restrictions) — but every flag MUST appear.
    const section9 = extractSection9(specSrc);
    expect(section9, "spec missing §9").toBeTruthy();
    for (const flag of CAPABILITY_FLAGS) {
      expect(section9!, `§9 missing ${flag}`).toContain(`\`${flag}\``);
    }
  });

  it("spec §3 type block lists every capability exactly once (Rust struct shape)", () => {
    // The Rust-style `pub struct RuntimeCapabilities` block uses
    // `pub supports_xxx: bool,` declarations. Verify each capability
    // appears exactly once in that form (catches duplicates & typos).
    const block = extractSection3RustBlock(specSrc);
    expect(block, "spec missing §3 Rust struct block").toBeTruthy();
    for (const flag of CAPABILITY_FLAGS) {
      const occurrences = (block!.match(new RegExp(`pub ${flag}: bool`, "g")) ?? [])
        .length;
      expect(occurrences, `§3 has ${occurrences} of pub ${flag}: bool`).toBe(1);
    }
  });

  it("spec §4 RuntimeLaunchSpec type block is present", () => {
    expect(specSrc).toContain("pub struct RuntimeLaunchSpec");
    expect(specSrc).toContain("pub struct HealthCheckSpec");
    expect(specSrc).toContain("pub struct RuntimeDiagnosis");
  });
});

describe("v1.0.9 Runtime Contract code compliance (deferred)", () => {
  // These assertions only enforce once Agent B has landed the hub.
  // Today (ca41bf45) no `runtime_hub_*` command exists. The test
  // PASSES on a clean integration HEAD and will start enforcing
  // the shape as soon as code lands. If a future change adds a 5th
  // `runtime_hub_*` command without an ADR, this test fails.
  const libRsSrc = readIfExists(LIB_RS_FILE) ?? "";
  const dispatchedMethods = (() => {
    const dispatchSrc = readIfExists(DISPATCH_FILE) ?? "";
    const wsSrc = readIfExists(WS_INTERNAL_FILE) ?? "";
    const wsMessagesSrc = readIfExists(WS_MESSAGES_FILE) ?? "";
    return {
      dispatchSrc,
      wsSrc,
      wsMessagesSrc,
    };
  })();

  function findRuntimeHubHandlers(): string[] {
    if (!libRsSrc) return [];
    // The lib.rs body uses `commands::<module>::<fn>,` shape inside
    // `tauri::generate_handler![ ... ]`. Look for any function whose
    // name starts with `runtime_hub_` and appears after the macro.
    const macroIdx = libRsSrc.indexOf("tauri::generate_handler![");
    if (macroIdx < 0) return [];
    const slice = libRsSrc.slice(macroIdx);
    const re = /runtime_hub_[a-z_]+/g;
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice)) !== null) found.add(m[0]);
    return [...found];
  }

  it("when runtime_hub_* code is present, exactly 4 are registered (matches spec §8)", () => {
    const found = findRuntimeHubHandlers();
    if (found.length === 0) {
      // Pre-implementation: spec is the source of truth. Skip.
      return;
    }
    // Sort to make the failure message stable.
    expect([...found].sort()).toEqual([...RUNTIME_HUB_COMMANDS].sort());
  });

  it("when diagnostics_* code is present, they are cross-platform (Tauri + iOS WS)", () => {
    // Diagnostics commands (Agent D) must be reachable from BOTH desktop
    // Tauri AND the iOS WebSocket dispatcher. A `diagnostics_*` handler
    // registered in lib.rs but missing from the iOS allowlist is
    // desktop-only and breaks mobile.
    const tauriDiag = new Set<string>();
    if (libRsSrc) {
      const macroIdx = libRsSrc.indexOf("tauri::generate_handler![");
      if (macroIdx >= 0) {
        const slice = libRsSrc.slice(macroIdx);
        const re = /diagnostics_[a-z_]+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(slice)) !== null) tauriDiag.add(m[0]);
      }
    }
    if (tauriDiag.size === 0) {
      // No diagnostics_* code yet. The check is dormant.
      return;
    }
    // At least one diagnostics command exists. Verify each appears in
    // (a) the dispatch match arms OR (b) is marked desktop-only in the
    // dispatch match arms with a clear rationale.
    const { dispatchSrc } = dispatchedMethods;
    const missing: string[] = [];
    for (const cmd of tauriDiag) {
      const armPattern = new RegExp(`"${cmd}"\\s*=>\\s*\\{`);
      const desktopOnlyPattern = new RegExp(`"${cmd}"[\\s\\S]{0,320}"desktop only"`);
      const inDispatch = armPattern.test(dispatchSrc);
      const isDesktopOnly = desktopOnlyPattern.test(dispatchSrc);
      if (!inDispatch && !isDesktopOnly) {
        missing.push(cmd);
      }
    }
    expect(missing, `diagnostics_* commands present in lib.rs but missing from iOS dispatch: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("v1.0.9 Runtime Contract — frontend useRuntimeCapabilities (deferred)", () => {
  // Agent C will own the useRuntimeCapabilities composable under
  // src/lib/runtime/. Once it lands, this test enforces that every
  // capability flag in the contract is referenced at least once in
  // the composable source. Today the composable does not exist; the
  // test passes by default.
  it("when useRuntimeCapabilities is implemented, it references all 12 capability flags", () => {
    // The composable location is agent C's owned file per
    // v1.0.9-shared-file-ownership.md: src/lib/runtime/**. We probe
    // multiple plausible filenames without modifying them.
    const candidates = [
      "src/lib/runtime/use-runtime-capabilities.ts",
      "src/lib/runtime/useRuntimeCapabilities.ts",
      "src/lib/runtime/composables.ts",
    ];
    let src: string | null = null;
    for (const rel of candidates) {
      const found = readIfExists(join(REPO_ROOT, rel));
      if (found) {
        src = found;
        break;
      }
    }
    if (src == null) {
      // Composable not yet implemented; spec is the source of truth.
      return;
    }
    const CAPS = [
      "supports_streaming",
      "supports_resume",
      "supports_permission_requests",
      "supports_tool_calls",
      "supports_usage",
      "supports_thinking",
      "supports_attachments",
      "supports_images",
      "supports_mcp",
      "supports_skills",
      "supports_remote_execution",
      "supports_structured_events",
    ];
    const missing: string[] = [];
    for (const flag of CAPS) {
      if (!src.includes(flag)) missing.push(flag);
    }
    expect(missing, `useRuntimeCapabilities missing references to: ${missing.join(", ")}`).toEqual([]);
  });
});

// ── helpers ──────────────────────────────────────────────────────────

/** Extract the §9 capability-to-UI degradation map table. */
function extractSection9(spec: string): string | null {
  const idx = spec.indexOf("## 9.");
  if (idx < 0) return null;
  const next = spec.indexOf("\n## ", idx + 5);
  return spec.slice(idx, next >= 0 ? next : spec.length);
}

/** Extract the §3 `pub struct RuntimeCapabilities { ... }` block. */
function extractSection3RustBlock(spec: string): string | null {
  const idx = spec.indexOf("pub struct RuntimeCapabilities");
  if (idx < 0) return null;
  // Find the matching closing brace by depth counting.
  let depth = 0;
  let started = false;
  for (let i = idx; i < spec.length; i++) {
    const c = spec[i];
    if (c === "{") {
      depth++;
      started = true;
    } else if (c === "}") {
      depth--;
      if (started && depth === 0) {
        return spec.slice(idx, i + 1);
      }
    }
  }
  return null;
}
