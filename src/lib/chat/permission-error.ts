/**
 * Typed permission error factory.
 *
 * The coordinator / handler layer raises these; the UI projects them
 * via `t(perm_failed)` / `t(perm_dangerBlocked)`. The wire codes must
 * match `PermissionErrorCode` (Rust mirror in
 * `src-tauri/src/agent/permission_error.rs`).
 */
import { PermissionError, classifyFailure } from "./permission-coordinator/failure";

export const permissionError = {
  unknownRequest(requestId: string): PermissionError {
    return new PermissionError(
      classifyFailure("unknown_request", `Request ${requestId} not found`, false),
    );
  },
  alreadyCancelled(requestId: string): PermissionError {
    return new PermissionError(
      classifyFailure("already_cancelled", `Request ${requestId} already cancelled`, false),
    );
  },
  runMismatch(captured: string, stored: string): PermissionError {
    return new PermissionError(
      classifyFailure(
        "run_mismatch",
        `Run identity changed (captured=${captured}, stored=${stored})`,
        false,
      ),
    );
  },
  duplicate(requestId: string): PermissionError {
    return new PermissionError(
      classifyFailure("duplicate", `Request ${requestId} already responded`, false),
    );
  },
  dangerBlocked(toolName: string): PermissionError {
    return new PermissionError(
      classifyFailure("danger_tool_blocked", `Permanent allow refused for ${toolName}`, false),
    );
  },
  transport(reason: string): PermissionError {
    return new PermissionError(classifyFailure("transport", reason, true));
  },
  timeout(requestId: string): PermissionError {
    return new PermissionError(
      classifyFailure("timeout", `Permission ${requestId} timed out`, true),
    );
  },
  unknown(reason: string): PermissionError {
    return new PermissionError(classifyFailure("unknown", reason, false));
  },
};
