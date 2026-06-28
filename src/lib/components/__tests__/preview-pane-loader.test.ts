import { describe, expect, it } from "vitest";
import {
  shouldLoadCodeEditor,
  shouldLoadMarkdownRenderer,
  shouldShowHighlightedCode,
} from "../preview-pane-loader";

describe("preview-pane-loader", () => {
  const readyCode = {
    path: "/proj/src/main.ts",
    mode: "preview" as const,
    editable: true,
    isRemote: false,
    loadState: "ready" as const,
    editorMode: "edit" as const,
  };

  it("loads CodeEditor only for editable ready code files", () => {
    expect(shouldLoadCodeEditor(readyCode)).toBe(true);
    expect(shouldLoadCodeEditor({ ...readyCode, editable: false })).toBe(false);
    expect(shouldLoadCodeEditor({ ...readyCode, loadState: "loading" })).toBe(false);
    expect(shouldLoadCodeEditor({ ...readyCode, path: "" })).toBe(false);
    expect(shouldLoadCodeEditor({ ...readyCode, path: "/proj/logo.png" })).toBe(false);
    expect(
      shouldLoadCodeEditor({
        ...readyCode,
        path: "/proj/README.md",
        editorMode: "rendered",
      }),
    ).toBe(false);
  });

  it("loads MiMarkdownRenderer only in rendered markdown ready state", () => {
    expect(
      shouldLoadMarkdownRenderer({
        path: "/proj/README.md",
        mode: "preview",
        editorMode: "rendered",
        loadState: "ready",
        hasContent: true,
      }),
    ).toBe(true);
    expect(
      shouldLoadMarkdownRenderer({
        path: "/proj/README.md",
        mode: "preview",
        editorMode: "edit",
        loadState: "ready",
        hasContent: true,
      }),
    ).toBe(false);
    expect(
      shouldLoadMarkdownRenderer({
        path: "/proj/README.md",
        mode: "preview",
        editorMode: "rendered",
        loadState: "loading",
        hasContent: true,
      }),
    ).toBe(false);
  });

  it("shows HighlightedCode for read-only ready code files", () => {
    expect(shouldShowHighlightedCode({ ...readyCode, editable: false })).toBe(true);
    expect(shouldShowHighlightedCode(readyCode)).toBe(false);
    expect(shouldShowHighlightedCode({ ...readyCode, editable: false, loadState: "loading" })).toBe(
      false,
    );
  });
});
