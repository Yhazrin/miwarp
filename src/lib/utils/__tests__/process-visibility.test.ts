import { describe, it, expect } from "vitest";
import {
  shouldShowRichLiveThinkingUI,
  shouldShowCompactLiveActivityUI,
  shouldUseTranscriptQuietToolRow,
  shouldShowFullTranscriptInlineToolCard,
} from "../process-visibility";

describe("process-visibility", () => {
  it("rich vs compact live UI", () => {
    expect(shouldShowRichLiveThinkingUI("output")).toBe(false);
    expect(shouldShowCompactLiveActivityUI("output")).toBe(true);
    expect(shouldShowRichLiveThinkingUI("guided")).toBe(true);
    expect(shouldShowCompactLiveActivityUI("guided")).toBe(false);
    expect(shouldShowRichLiveThinkingUI("developer")).toBe(true);
    expect(shouldShowCompactLiveActivityUI("developer")).toBe(false);
  });

  it("output transcript: quiet row vs full card", () => {
    expect(
      shouldUseTranscriptQuietToolRow("output", { tool_name: "Bash", status: "running" }),
    ).toBe(true);
    expect(
      shouldShowFullTranscriptInlineToolCard("output", { tool_name: "Bash", status: "running" }),
    ).toBe(false);
    expect(
      shouldShowFullTranscriptInlineToolCard("output", {
        tool_name: "AskUserQuestion",
        status: "running",
      }),
    ).toBe(true);
    expect(
      shouldUseTranscriptQuietToolRow("output", {
        tool_name: "AskUserQuestion",
        status: "running",
      }),
    ).toBe(false);
    expect(
      shouldShowFullTranscriptInlineToolCard("output", { tool_name: "Bash", status: "success" }),
    ).toBe(false);
    expect(
      shouldShowFullTranscriptInlineToolCard("developer", {
        tool_name: "Bash",
        status: "success",
      }),
    ).toBe(true);
  });
});
