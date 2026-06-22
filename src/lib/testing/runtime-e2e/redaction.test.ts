import { describe, expect, it } from "vitest";
import { redactRuntimeE2eLine } from "./redaction";

describe("runtime e2e redaction", () => {
  it("redacts home paths, smoke prompt, and token-like fragments", () => {
    const line =
      "/Users/test/project MIWARP_SMOKE_OK sk-abcdef1234567890 Bearer abc.def.ghi MINIMAX_API_KEY=secret";
    const redacted = redactRuntimeE2eLine(line, "/Users/test");
    expect(redacted).not.toContain("MIWARP_SMOKE_OK");
    expect(redacted).not.toContain("sk-abcdef");
    expect(redacted).not.toContain("secret");
    expect(redacted).toContain("$HOME");
  });
});
