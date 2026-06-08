/**
 * v1.0.6 / 5.7: Memory semantic block parser.
 *
 * Parses memory markdown files into structured blocks that preserve
 * the type / level / children hierarchy for richer sidebar display.
 */

/** The semantic type of a memory block. */
export type MemoryBlockType =
  | "heading" // # / ## / ### etc.
  | "list" // - item / * item
  | "code" // ``` fenced code
  | "link" // [text](url) or bare URLs
  | "frontmatter" // --- YAML frontmatter
  | "paragraph"; // plain text paragraph

export interface MemoryBlock {
  id: string;
  type: MemoryBlockType;
  /** Raw text content of this block (preserved as-is). */
  content: string;
  /** Heading level (1-6), only set for heading blocks. */
  level?: number;
  /** Nested child blocks (e.g., list items under a heading). */
  children: MemoryBlock[];
  /** Line number range in the original file. */
  lineStart: number;
  lineEnd: number;
}

export interface ParsedMemoryFile {
  blocks: MemoryBlock[];
  /** Extracted frontmatter metadata (if present). */
  frontmatter?: Record<string, string>;
  /** Total line count. */
  lineCount: number;
}

let blockIdCounter = 0;

function nextBlockId(): string {
  return `mb-${++blockIdCounter}`;
}

/**
 * Parse a memory markdown file content into structured blocks.
 * Heading-level nesting is preserved: content under a heading becomes children.
 */
export function parseMemoryFileContent(content: string): ParsedMemoryFile {
  blockIdCounter = 0;
  const lines = content.split(/\r?\n/);
  const blocks: MemoryBlock[] = [];
  let frontmatter: Record<string, string> | undefined;
  let i = 0;

  // Parse frontmatter
  if (lines[0]?.trim() === "---") {
    const endIdx = lines.indexOf("---", 1);
    if (endIdx > 0) {
      frontmatter = {};
      for (let fi = 1; fi < endIdx; fi++) {
        const match = lines[fi].match(/^(\w[\w-]*)\s*:\s*(.+)$/);
        if (match) frontmatter[match[1]] = match[2].trim();
      }
      i = endIdx + 1;
    }
  }

  // Stack-based heading parser: maintains current nesting
  const stack: MemoryBlock[] = [];

  function currentParent(): MemoryBlock[] {
    return stack.length > 0 ? stack[stack.length - 1].children : blocks;
  }

  function pushBlock(block: MemoryBlock) {
    currentParent().push(block);
  }

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const block: MemoryBlock = {
        id: nextBlockId(),
        type: "heading",
        content: headingMatch[2],
        level,
        children: [],
        lineStart: i,
        lineEnd: i,
      };
      // Pop stack until we find a parent with lower level
      while (stack.length > 0 && (stack[stack.length - 1].level ?? 0) >= level) {
        stack.pop();
      }
      pushBlock(block);
      stack.push(block);
      i++;
      continue;
    }

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [line];
      const start = i;
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        codeLines.push(lines[i]);
        i++;
      }
      pushBlock({
        id: nextBlockId(),
        type: "code",
        content: codeLines.join("\n"),
        children: [],
        lineStart: start,
        lineEnd: i - 1,
      });
      continue;
    }

    // List item
    if (/^\s*[-*+]\s/.test(line)) {
      const listLines: string[] = [line];
      const start = i;
      i++;
      // Continuation lines (indented)
      while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
        listLines.push(lines[i]);
        i++;
      }
      pushBlock({
        id: nextBlockId(),
        type: "list",
        content: listLines.join("\n"),
        children: [],
        lineStart: start,
        lineEnd: i - 1,
      });
      continue;
    }

    // Empty line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (collect consecutive non-empty, non-special lines)
    const paraLines: string[] = [line];
    const start = i;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].trimStart().startsWith("```") &&
      !/^\s*[-*+]\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    pushBlock({
      id: nextBlockId(),
      type: "paragraph",
      content: paraLines.join("\n"),
      children: [],
      lineStart: start,
      lineEnd: i - 1,
    });
  }

  return { blocks, frontmatter, lineCount: lines.length };
}

/**
 * Flatten a block tree into a linear list (depth-first).
 * Useful for rendering in a flat list with indentation hints.
 */
export function flattenBlocks(blocks: MemoryBlock[]): Array<{ block: MemoryBlock; depth: number }> {
  const result: Array<{ block: MemoryBlock; depth: number }> = [];

  function walk(items: MemoryBlock[], depth: number) {
    for (const block of items) {
      result.push({ block, depth });
      if (block.children.length > 0) {
        walk(block.children, depth + 1);
      }
    }
  }

  walk(blocks, 0);
  return result;
}
