/**
 * v1.0.6 / 4.9: Shell environment detection + env snapshot.
 *
 * The "slash command can't run" regression comes from one of four root
 * causes: cwd drift, env missing, shell interpreter mismatch, or
 * permission. This module exposes lightweight detection helpers that
 * frontends can call before invoking a slash command, plus a captured
 * env snapshot persisted per-run for later inspection.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";

export interface ShellEnvSnapshot {
  /** Detected shell path (e.g. /bin/zsh) */
  shell: string;
  /** Resolved cwd (the project's working directory or a worktree root) */
  cwd: string;
  /** Captured key=value pairs (subset; never leaks secrets back to UI) */
  envKeys: string[];
  capturedAt: number;
  schemaVersion: number;
}

const SCHEMA_VERSION = 1;
const MAX_TRACKED_KEYS = 64;

const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "PWD",
  "TMPDIR",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "SSH_AUTH_SOCK",
  "GOPATH",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "NVM_DIR",
  "N_PREFIX",
  "PYENV_ROOT",
  "ASDF_DIR",
  "MISE_CONFIG_DIR",
  "JAVA_HOME",
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "FLUTTER_ROOT",
];

/**
 * Best-effort shell detection. Uses `$SHELL` first, falling back to
 * `/bin/zsh` on macOS and `/bin/bash` elsewhere. The result is purely
 * advisory — the actual `which` / process spawn happens in Rust.
 */
export function detectShellEnv(hint?: string): string {
  if (hint && hint.trim()) return hint.trim();
  if (typeof process !== "undefined" && process.env?.SHELL) {
    return process.env.SHELL;
  }
  // Browser fallback: leave it to the backend.
  return "";
}

/**
 * Validate a cwd for the given workspace. Returns the path to use, or
 * an empty string when the cwd is invalid.
 */
export function validateCwdForRun(cwd: string, workspaceRoot: string): string {
  if (!cwd) return "";
  if (!workspaceRoot) return cwd;
  if (cwd === workspaceRoot) return cwd;
  if (cwd.startsWith(workspaceRoot + "/") || cwd.startsWith(workspaceRoot + "\\")) {
    return cwd;
  }
  dbgWarn("shell-env", "cwd outside workspace", { cwd, workspaceRoot });
  return "";
}

/**
 * Return a snapshot of safe env keys. We never read secret values; we
 * only return the list of present keys so the UI can show "X is set"
 * without leaking the value.
 */
export function captureEnvSnapshot(): ShellEnvSnapshot {
  const keys: string[] = [];
  if (typeof process !== "undefined" && process.env) {
    for (const k of SAFE_ENV_KEYS) {
      if (process.env[k] !== undefined) keys.push(k);
      if (keys.length >= MAX_TRACKED_KEYS) break;
    }
  }
  return {
    shell: detectShellEnv(),
    cwd: typeof process !== "undefined" ? (process.cwd?.() ?? "") : "",
    envKeys: keys,
    capturedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  };
}

export type ShellErrorKind =
  | "cwd_missing"
  | "cwd_outside_workspace"
  | "shell_not_found"
  | "permission_denied"
  | "env_missing"
  | "command_not_found"
  | "unknown";

export interface ShellError {
  kind: ShellErrorKind;
  message: string;
  hint: string;
  retryable: boolean;
}

export function classifyShellError(message: string): ShellError {
  const lower = message.toLowerCase();
  if (lower.includes("no such file or directory") && lower.includes("cwd"))
    return {
      kind: "cwd_missing",
      message,
      hint: "重试用项目根 cwd,或选择一个新的工作目录。",
      retryable: true,
    };
  if (lower.includes("permission denied"))
    return {
      kind: "permission_denied",
      message,
      hint: "运行 `chmod +x` 或在 Tauri 安全设置中放行该命令。",
      retryable: false,
    };
  if (lower.includes("command not found"))
    return {
      kind: "command_not_found",
      message,
      hint: "确认 PATH 中包含此命令,或在 chat 内以自然语言描述。",
      retryable: false,
    };
  if (lower.includes("$sh") || lower.includes("/bin/sh"))
    return {
      kind: "shell_not_found",
      message,
      hint: "切换到 zsh 或 bash 后重试。",
      retryable: true,
    };
  if (lower.includes("env") && lower.includes("not set"))
    return {
      kind: "env_missing",
      message,
      hint: "在设置中配置 env 快照,或在 chat 内以自然语言描述。",
      retryable: true,
    };
  return {
    kind: "unknown",
    message,
    hint: "复制命令到剪贴板,在终端手动运行。",
    retryable: false,
  };
}
