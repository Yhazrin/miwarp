/**
 * Tests for the cross-platform contract gate parsers.
 *
 * These tests cover the pure parsing functions in
 * `scripts/architecture/contract-lib.mjs`:
 *   - parseTauriCommandRegistry / parseTauriGenerateHandler
 *   - classifyTauriDrift
 *   - parseIosWsMethods / parseIosSentMethods
 *   - parseDispatchMethods / parseWsInternalMethods
 *   - classifyIosWsDrift
 *
 * The two orchestration scripts (`tauri-contract.mjs`, `ios-ws-contract.mjs`)
 * are tested end-to-end by `arch:check` in CI — these unit tests focus on
 * the edge cases that are hard to hit reliably against the real repo
 * (e.g. multi-pattern dispatch arms, falsy string literals, malformed input).
 */
import { describe, expect, it } from "vitest";
import {
  classifyIosWsDrift,
  classifyTauriDrift,
  parseDispatchMethods,
  parseIosSentMethods,
  parseIosWsMethods,
  parseTauriCommandRegistry,
  parseTauriGenerateHandler,
  parseWsInternalMethods,
} from "../contract-lib.mjs";

describe("parseTauriCommandRegistry", () => {
  it("extracts key/value pairs from the CMD block", () => {
    const src = `
export const CMD = {
  list_runs: "list_runs",
  get_run: "get_run",
  send_message: "send_session_message",
} as const;
`;
    const { entries, values } = parseTauriCommandRegistry(src);
    expect(entries).toEqual([
      { key: "list_runs", value: "list_runs" },
      { key: "get_run", value: "get_run" },
      { key: "send_message", value: "send_session_message" },
    ]);
    expect([...values].sort()).toEqual([
      "get_run",
      "list_runs",
      "send_session_message",
    ]);
  });

  it("ignores comments and surrounding prose", () => {
    const src = `
// leading comment
export const CMD = {
  // inline comment
  add_prompt_favorite: "add_prompt_favorite",
  /* block comment */
  remove_prompt_favorite: "remove_prompt_favorite",
};
`;
    const { entries } = parseTauriCommandRegistry(src);
    expect(entries.map((e) => e.key)).toEqual([
      "add_prompt_favorite",
      "remove_prompt_favorite",
    ]);
  });

  it("returns empty result when there are no CMD-shaped entries", () => {
    const src = `const x = "literal"; let y = 1;`;
    const { entries, values } = parseTauriCommandRegistry(src);
    expect(entries).toEqual([]);
    expect(values.size).toBe(0);
  });
});

describe("parseTauriGenerateHandler", () => {
  it("extracts function names from generate_handler! body", () => {
    const src = `
.invoke_handler(tauri::generate_handler![
    commands::capabilities::get_backend_capabilities,
    commands::runs::list_runs,
    scheduler::list_scheduled_tasks,
    commands::worktree::create_worktree,
])`;
    const { functions } = parseTauriGenerateHandler(src);
    expect([...functions].sort()).toEqual([
      "create_worktree",
      "get_backend_capabilities",
      "list_runs",
      "list_scheduled_tasks",
    ]);
  });

  it("returns empty result when generate_handler! is missing", () => {
    const src = `pub fn run() { println!("no handlers"); }`;
    const { functions, span } = parseTauriGenerateHandler(src);
    expect(functions.size).toBe(0);
    expect(span).toBeNull();
  });

  it("records the macro span for reporting", () => {
    const src = `tauri::generate_handler![\n  commands::a::b,\n]`;
    const { span } = parseTauriGenerateHandler(src);
    expect(span).not.toBeNull();
    expect(span!.end).toBeGreaterThan(span!.start);
  });
});

describe("classifyTauriDrift", () => {
  it("flags frontend CMD values missing from backend handlers", () => {
    const cmdValues = new Set(["list_runs", "missing_cmd", "get_run"]);
    const handlerFns = new Set(["list_runs", "get_run", "extra_handler"]);
    const { unregistered, backendOnly } = classifyTauriDrift(cmdValues, handlerFns);
    expect(unregistered).toEqual(["missing_cmd"]);
    expect(backendOnly).toEqual(["extra_handler"]);
  });

  it("returns no drift when both sides match exactly", () => {
    const cmdValues = new Set(["a", "b"]);
    const handlerFns = new Set(["a", "b"]);
    const { unregistered, backendOnly } = classifyTauriDrift(cmdValues, handlerFns);
    expect(unregistered).toEqual([]);
    expect(backendOnly).toEqual([]);
  });
});

describe("parseIosWsMethods", () => {
  it("extracts only the WSMethod enum entries (not WSHeader / WSField)", () => {
    const src = `
enum WSEndpoint {
    static let wsPath = "/ws"
    static let maskedToken = "••••"
}
enum WSHeader {
    static let authorization = "Authorization"
}
enum WSMethod {
    static let subscribe = "_subscribe"
    static let fullReload = "_full_reload"
}
enum WSField {
    static let type = "type"
    static let runId = "run_id"
}
`;
    const { entries, values } = parseIosWsMethods(src);
    expect(entries).toEqual([
      { name: "subscribe", value: "_subscribe" },
      { name: "fullReload", value: "_full_reload" },
    ]);
    expect([...values].sort()).toEqual(["_full_reload", "_subscribe"]);
  });

  it("returns empty result when WSMethod enum is absent", () => {
    const src = `enum Foo { static let bar = "baz" }`;
    const { entries, values } = parseIosWsMethods(src);
    expect(entries).toEqual([]);
    expect(values.size).toBe(0);
  });
});

describe("parseIosSentMethods", () => {
  it("captures every sendRequest(method:) literal", () => {
    const src = `
func a() async throws {
    _ = try await client.sendRequest(method: "list_runs")
}
func b() async throws {
    let result = try await client.sendRequest(method: "get_run", params: ["id": id])
}
func c() async throws {
    // sendRequest(method: "commented_out") — must NOT match
}
`;
    const out = parseIosSentMethods(src);
    expect([...out].sort()).toEqual(["get_run", "list_runs"]);
  });

  it("returns empty result when no sendRequest call sites exist", () => {
    expect(parseIosSentMethods("const x = 1;").size).toBe(0);
  });
});

describe("parseDispatchMethods", () => {
  it("isolates match arms from the match-method block, not param literals", () => {
    const src = `
fn dispatch_command(method: &str, params: Value) -> Result<Value, String> {
    let result = match method {
        "list_runs" => { serde_json::to_value(crate::list()).map_err(|e| e.to_string()) }
        "get_run" => {
            let id = params.get("id").and_then(|v| v.as_str()).map(String::from);
            serde_json::to_value(id).map_err(|e| e.to_string())
        }
        "write_text_file" => {
            let path = params.get("path").and_then(|v| v.as_str()).map(String::from);
            let content = params.get("content").and_then(|v| v.as_str()).map(String::from);
            crate::write(path, content)?;
            Ok(json!(true))
        }
        "capture_screenshot"
        | "check_for_updates" => Err("desktop only".to_string()),
        _ => Err(format!("unknown method: {}", method)),
    };
    result
}
`;
    const dispatch = parseDispatchMethods(src);
    expect([...dispatch.supported].sort()).toEqual([
      "get_run",
      "list_runs",
      "write_text_file",
    ]);
    expect([...dispatch.desktopOnly].sort()).toEqual([
      "capture_screenshot",
      "check_for_updates",
    ]);
    expect(dispatch.ipcOnly.size).toBe(0);
    expect(dispatch.unknown.size).toBe(0);
  });

  it("classifies explicitly-blocked arms as 'unknown' (load_run_data pattern)", () => {
    const src = `
let r = match method {
    "list_runs" => Ok(json!(true)),
    "load_run_data" => Err("unknown method".to_string()),
    _ => Err("unknown method".to_string()),
};
`;
    const dispatch = parseDispatchMethods(src);
    expect([...dispatch.supported]).toEqual(["list_runs"]);
    expect([...dispatch.unknown]).toEqual(["load_run_data"]);
  });

  it("returns empty sets when no match-method exists", () => {
    const src = `fn unrelated() { let x = match y { 1 => 2 }; }`;
    const dispatch = parseDispatchMethods(src);
    expect(dispatch.supported.size).toBe(0);
    expect(dispatch.desktopOnly.size).toBe(0);
  });
});

describe("parseWsInternalMethods", () => {
  it("captures underscore-prefixed arms in ws.rs match-method blocks", () => {
    const src = `
match method {
    "_subscribe" => { /* ... */ }
    "_unsubscribe" => { /* ... */ }
}
`;
    const out = parseWsInternalMethods(src);
    expect([...out].sort()).toEqual(["_subscribe", "_unsubscribe"]);
  });

  it("captures server-pushed event names referenced as JSON keys", () => {
    const src = `
let envelope = json!({
    "event": "_full_reload",
    "run_id": run_id,
});
`;
    const out = parseWsInternalMethods(src);
    expect([...out]).toEqual(["_full_reload"]);
  });

  it("ignores non-underscore-prefixed strings", () => {
    const src = `let x = match method { "list_runs" => {} };`;
    const out = parseWsInternalMethods(src);
    expect(out.size).toBe(0);
  });
});

describe("classifyIosWsDrift", () => {
  const dispatch = {
    supported: new Set(["list_runs", "get_run", "stop_run"]),
    desktopOnly: new Set(["capture_screenshot"]),
    ipcOnly: new Set(["get_web_server_token"]),
    unknown: new Set(["load_run_data"]),
  };
  const wsInternal = new Set(["_subscribe", "_unsubscribe"]);

  it("accepts methods covered by dispatch.supported", () => {
    const { unsupported, categorised } = classifyIosWsDrift(
      new Set(["list_runs"]),
      dispatch,
      wsInternal,
    );
    expect(unsupported).toEqual([]);
    expect(categorised).toEqual([]);
  });

  it("accepts methods covered by wsInternal (underscore-prefixed)", () => {
    const { unsupported, categorised } = classifyIosWsDrift(
      new Set(["_subscribe", "_unsubscribe"]),
      dispatch,
      wsInternal,
    );
    expect(unsupported).toEqual([]);
    expect(categorised).toEqual([]);
  });

  it("flags methods that hit the catch-all as unsupported", () => {
    const { unsupported } = classifyIosWsDrift(
      new Set(["totally_made_up"]),
      dispatch,
      wsInternal,
    );
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].method).toBe("totally_made_up");
  });

  it("classifies (but does not fail on) methods tagged desktop-only / ipc-only / unknown", () => {
    const { unsupported, categorised } = classifyIosWsDrift(
      new Set(["capture_screenshot", "get_web_server_token", "load_run_data"]),
      dispatch,
      wsInternal,
    );
    expect(unsupported).toEqual([]);
    expect(categorised.map((c) => c.method).sort()).toEqual([
      "capture_screenshot",
      "get_web_server_token",
      "load_run_data",
    ]);
  });

  it("surfaces server-only methods for visibility (never fails)", () => {
    const { serverOnly } = classifyIosWsDrift(
      new Set([]),
      dispatch,
      wsInternal,
    );
    expect(serverOnly.sort()).toEqual([
      "_subscribe",
      "_unsubscribe",
      "capture_screenshot",
      "get_run",
      "get_web_server_token",
      "list_runs",
      "load_run_data",
      "stop_run",
    ]);
  });
});