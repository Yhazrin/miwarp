import { describe, expect, it } from "vitest";
import { stabilizeStreamingMarkdown } from "./markdown";

describe("stabilizeStreamingMarkdown", () => {
  it("leaves balanced fences unchanged", () => {
    const src = "before\n```js\nconst x = 1;\n```\nafter";
    expect(stabilizeStreamingMarkdown(src)).toBe(src);
  });

  it("closes an unclosed fence", () => {
    const src = "before\n```js\nconst x = 1;";
    expect(stabilizeStreamingMarkdown(src)).toBe(`${src}\n\`\`\``);
  });

  it("ignores inline triple backticks", () => {
    const src = "use ``` sparingly in prose";
    expect(stabilizeStreamingMarkdown(src)).toBe(src);
  });
});
