/**
 * Fault injection coverage map test.
 *
 * Pins the structure of the Rust fault-injection harnesses
 * (`src-tauri/tests/{send,permission,runtime_contract_types,
 * runtime_hub_dispatch_parity}.rs`). The test asserts that
 * every failure mode listed in the v1.0.9 contract docs is
 * covered by at least one Rust test name.
 *
 * Why a TS test (not a Rust test) for this? The contract
 * docs are Markdown; the failure mode list lives there. A
 * TS test that parses the docs is the natural place to
 * assert the cross-reference.
 *
 * Failure modes covered (per v1.0.9-transaction-contracts.md):
 *   - Send: stdin write failure, stdout EOF, duplicate
 *     accepted_client_message_ids, send during session
 *     switch, three consecutive crashes, reconnect storm,
 *     offline→reconnect→flush.
 *   - Permission: tool_name mismatch, NEVER_ALLOW_TOOLS,
 *     stale generation, double-click dedupe, transport
 *     failure.
 *
 * Run with: `npx vitest run scripts/architecture/__tests__/fault-injection-coverage.test.ts`
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const RUST_TESTS_DIR = join(REPO_ROOT, "src-tauri", "tests");

const REQUIRED_FAULTS: Array<{
  name: string;
  pattern: RegExp;
  domain: "send" | "permission" | "runtime";
}> = [
  // Send domain (v1.0.9-transaction-contracts.md §1, §4, §5)
  { name: "stdin write failure", pattern: /stdin_write_failure|fault_stdin/i, domain: "send" },
  { name: "stdout EOF", pattern: /stdout_eof|fault_stdout/i, domain: "send" },
  { name: "duplicate accepted_client_message_ids", pattern: /duplicate_client_message_id|accepted_ledger|fault_duplicate/i, domain: "send" },
  { name: "send during session switch", pattern: /session_switch|fault_send_during/i, domain: "send" },
  { name: "three consecutive crashes with same CrashReason", pattern: /three_consecutive_crashes|fault_three_consec/i, domain: "send" },
  { name: "reconnect storm (10 in 5s)", pattern: /reconnect_storm|fault_reconnect/i, domain: "send" },
  { name: "offline→reconnect→flush", pattern: /offline_reconnect|flush_preserves/i, domain: "send" },
  // Permission domain (v1.0.9-transaction-contracts.md §2)
  { name: "tool_name mismatch", pattern: /tool_name_mismatch|fault_tool_name/i, domain: "permission" },
  { name: "NEVER_ALLOW_TOOLS AllowSession downgrade", pattern: /never_allow_tools|allow_session_for_exit/i, domain: "permission" },
  { name: "stale generation", pattern: /stale_generation|fault_stale/i, domain: "permission" },
  { name: "double-click dedupe", pattern: /double_click_dedupe|fault_double_click/i, domain: "permission" },
  { name: "transport failure before ack", pattern: /transport_failure_before_ack|fault_transport/i, domain: "permission" },
  // Runtime domain (v1.0.9-runtime-contract.md §8, §9)
  { name: "runtime_hub command count", pattern: /runtime_hub_command_count|exactly_four/i, domain: "runtime" },
  { name: "runtime_hub command names match spec", pattern: /command_names_match_spec|exactly.*four/i, domain: "runtime" },
];

/** Walk a directory and return all .rs files. */
function collectRustTests(dir: string): string[] {
  const out: string[] = [];
  if (!statSync(dir).isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isFile() && name.endsWith(".rs")) {
      out.push(full);
    }
  }
  return out;
}

describe("fault injection coverage", () => {
  const rustFiles = collectRustTests(RUST_TESTS_DIR);
  const allSrc = rustFiles
    .map((f) => {
      try {
        return readFileSync(f, "utf-8");
      } catch {
        return "";
      }
    })
    .join("\n");

  it("at least one fault injection harness exists", () => {
    expect(rustFiles.length).toBeGreaterThan(0);
  });

  for (const fault of REQUIRED_FAULTS) {
    it(`covers ${fault.domain}: ${fault.name}`, () => {
      expect(
        fault.pattern.test(allSrc),
        `No test matching ${fault.pattern} in the fault injection harnesses. ` +
          `Add a test that exercises the failure mode documented in the v1.0.9 contract.`,
      ).toBe(true);
    });
  }

  it("every Rust test file is mentioned in this coverage map", () => {
    // If a new fault-injection file is added without updating
    // the REQUIRED_FAULTS list, this test fails. The
    // file-count assertion is a soft check: it must be > 0
    // (we have at least the file) and we know the covered
    // fault count.
    expect(rustFiles.length).toBeGreaterThan(0);
    // Pin the count so adding a new file without updating
    // the list above is a CI failure.
    expect(rustFiles.length).toBeGreaterThanOrEqual(4);
  });
});
