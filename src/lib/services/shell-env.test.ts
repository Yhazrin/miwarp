/**
 * Tests for the shell-env detection helpers.
 */
import { describe, expect, it } from "vitest";
import {
  classifyShellError,
  detectShellEnv,
  validateCwdForRun,
} from "./shell-env";

describe("shell-env", () => {
  it("detectShellEnv returns the hint when given one", () => {
    expect(detectShellEnv("/bin/zsh")).toBe("/bin/zsh");
  });

  it("detectShellEnv falls back to process.env.SHELL", () => {
    const prev = process.env.SHELL;
    process.env.SHELL = "/bin/bash";
    try {
      expect(detectShellEnv()).toBe("/bin/bash");
    } finally {
      if (prev === undefined) delete process.env.SHELL;
      else process.env.SHELL = prev;
    }
  });

  it("validateCwdForRun accepts equal path", () => {
    expect(validateCwdForRun("/repo", "/repo")).toBe("/repo");
  });

  it("validateCwdForRun accepts descendants", () => {
    expect(validateCwdForRun("/repo/sub", "/repo")).toBe("/repo/sub");
  });

  it("validateCwdForRun rejects escapes", () => {
    expect(validateCwdForRun("/etc/passwd", "/repo")).toBe("");
  });

  it("validateCwdForRun accepts empty input", () => {
    expect(validateCwdForRun("", "/repo")).toBe("");
  });

  describe("classifyShellError", () => {
    it("flags cwd issues", () => {
      const e = classifyShellError("No such file or directory (cwd: /x)");
      expect(e.kind).toBe("cwd_missing");
      expect(e.retryable).toBe(true);
    });

    it("flags permission errors", () => {
      const e = classifyShellError("Permission denied");
      expect(e.kind).toBe("permission_denied");
    });

    it("flags missing commands", () => {
      const e = classifyShellError("foo: command not found");
      expect(e.kind).toBe("command_not_found");
    });

    it("flags shell interpreter mismatch", () => {
      const e = classifyShellError("failed to exec /bin/sh");
      expect(e.kind).toBe("shell_not_found");
    });

    it("flags env missing", () => {
      const e = classifyShellError("env variable FOO not set");
      expect(e.kind).toBe("env_missing");
    });

    it("returns unknown for unrecognised errors", () => {
      const e = classifyShellError("oh no");
      expect(e.kind).toBe("unknown");
    });
  });
});
