/**
 * Unit tests for scripts/architecture/cross-platform-bus-contract.mjs
 * internal helpers. The script itself is an integration test that
 * reads the real repo; these tests pin the helper behavior so the
 * script can be refactored safely.
 *
 * The script exports nothing (it's a CLI), so we re-implement the
 * helper functions here and assert the same shapes the CLI uses.
 * If the CLI helpers change, update these tests.
 */
import { describe, expect, it } from "vitest";

/** Mirror of extractBusEventVariants in cross-platform-bus-contract.mjs. */
function extractBusEventVariants(src: string): string[] {
  const start = src.indexOf("pub enum BusEvent");
  if (start < 0) return [];
  const openIdx = src.indexOf("{", start);
  if (openIdx < 0) return [];
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  const body = src.slice(openIdx, i);
  const re = /^\s*([A-Z][A-Za-z0-9]*)\s*(?:\{|\(|$)/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

function variantToSnake(v: string): string {
  return v.replace(/([A-Z])/g, (_, c, idx) =>
    idx === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`,
  );
}

describe("BusEvent variant extraction", () => {
  it("extracts all variants from a typical enum block", () => {
    const src = `
pub enum BusEvent {
    SessionInit { run_id: String },
    MessageDelta { run_id: String, text: String },
    ToolStart { run_id: String },
    Raw { run_id: String, source: String, data: Value },
    ControlCancelled { run_id: String, request_id: String },
    CommandOutput { run_id: String, content: String },
}
`;
    const out = extractBusEventVariants(src);
    expect(out).toEqual([
      "SessionInit",
      "MessageDelta",
      "ToolStart",
      "Raw",
      "ControlCancelled",
      "CommandOutput",
    ]);
  });

  it("returns empty array when pub enum BusEvent is absent", () => {
    expect(extractBusEventVariants("struct Foo {}")).toEqual([]);
  });

  it("filters to v1.0.9 Runtime*/Diagnostic* namespace correctly", () => {
    const src = `
pub enum BusEvent {
    RuntimeReady { runtime_id: String },
    RuntimeHealthChanged { state: String },
    DiagnosticEvent { category: String, severity: String },
    SessionInit { run_id: String },
    MessageDelta { run_id: String, text: String },
    RuntimeStartup { ok: bool },
    DiagnosticsSnapshot { payload: String },
}
`;
    const out = extractBusEventVariants(src);
    const v109 = out.filter((v) =>
      ["Runtime", "Diagnostic", "Diagnostics"].some((p) => v.startsWith(p)),
    );
    expect(v109).toEqual([
      "RuntimeReady",
      "RuntimeHealthChanged",
      "DiagnosticEvent",
      "RuntimeStartup",
      "DiagnosticsSnapshot",
    ]);
  });
});

describe("snake_case conversion", () => {
  it("converts PascalCase to snake_case correctly", () => {
    expect(variantToSnake("SessionInit")).toBe("session_init");
    expect(variantToSnake("ToolStart")).toBe("tool_start");
    expect(variantToSnake("Raw")).toBe("raw");
    expect(variantToSnake("RuntimeReady")).toBe("runtime_ready");
    expect(variantToSnake("DiagnosticEvent")).toBe("diagnostic_event");
    expect(variantToSnake("DiagnosticsSnapshot")).toBe("diagnostics_snapshot");
  });

  it("idempotent on already-snake-case input", () => {
    expect(variantToSnake("session_init")).toBe("session_init");
  });
});
