import { describe, expect, it } from "vitest";
import { detectLinks } from "./link-detector";

describe("detectLinks", () => {
  it("detects markdown links as card candidates with labels", () => {
    const links = detectLinks("See [MiWarp docs](https://example.com/docs) for details.");

    expect(links).toEqual([
      expect.objectContaining({
        url: "https://example.com/docs",
        type: "web",
        label: "MiWarp docs",
      }),
    ]);
  });

  it("does not double-detect URL paths as local paths", () => {
    const links = detectLinks(
      "Open https://example.com/a/b?x=1, www.example.org/docs, and localhost:5173.",
    );

    expect(links).toHaveLength(3);
    expect(links.map((link) => link.type)).toEqual(["web", "web", "web"]);
    expect(links.map((link) => link.url)).toEqual([
      "https://example.com/a/b?x=1",
      "https://www.example.org/docs",
      "http://localhost:5173",
    ]);
  });

  it("detects local file and folder paths including line suffixes", () => {
    const links = detectLinks(
      "Changed /Users/me/project/src/app.ts:42 and opened ~/Desktop/reports/.",
    );

    expect(links).toEqual([
      expect.objectContaining({
        url: "/Users/me/project/src/app.ts:42",
        type: "local-file",
      }),
      expect.objectContaining({
        url: "~/Desktop/reports/",
        type: "local-folder",
      }),
    ]);
  });

  it("does not detect relative paths or app routes", () => {
    const links = detectLinks(
      [
        "Relative src/lib/link-detector.ts should stay plain.",
        "./src/app.ts and ../docs/readme.md should stay plain.",
        "[Chat route](/chat?run=abc) should stay plain.",
        "[Relative doc](docs/readme.md) should stay plain.",
        "Nested foo/bar/baz.ts should stay plain.",
      ].join(" "),
    );

    expect(links).toEqual([]);
  });

  it("does not detect slash fragments inside relative paths", () => {
    const links = detectLinks("Touch packages/app/src/routes/+page.svelte before src/lib/api.ts.");

    expect(links).toEqual([]);
  });

  it("suppresses links inside code regions", () => {
    const links = detectLinks("`https://example.com` and ```\n/Users/me/file.ts\n```");

    expect(links).toEqual([]);
  });

  it("deduplicates repeated references", () => {
    const links = detectLinks(
      "[docs](https://example.com/docs) then https://example.com/docs again.",
    );

    expect(links).toHaveLength(1);
    expect(links[0]).toEqual(
      expect.objectContaining({
        url: "https://example.com/docs",
        label: "docs",
      }),
    );
  });
});
