/**
 * Parse memory content into individual displayable items.
 * Supports bullet lists, numbered lists, headings with content, and paragraph breaks.
 */
export interface MemoryItem {
  id: string;
  text: string;
}

// ── Semantic block types (used by enhanced parser) ──

export type MemoryBlockType = "heading" | "bullet" | "numbered" | "paragraph";

export interface MemoryBlock {
  id: string;
  type: MemoryBlockType;
  text: string;
  level?: number; // heading depth 1-6
  children: MemoryBlock[];
  collapsed?: boolean;
}

export interface ParsedMemoryFile {
  path: string;
  label: string;
  scope: "project" | "global" | "memory";
  blocks: MemoryBlock[];
  itemCount: number;
}

export function parseMemoryItems(raw: string): MemoryItem[] {
  if (!raw || !raw.trim()) return [];

  // Strip YAML frontmatter
  const content = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (!content) return [];

  const items: MemoryItem[] = [];
  let idx = 0;

  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // Heading: collect subsequent content as one item
    if (/^#{1,6}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,6}\s+/, "").trim();
      const contentLines: string[] = [heading];
      i++;
      // Collect indented or non-empty lines after heading
      while (i < lines.length) {
        const next = lines[i].trim();
        if (!next) {
          i++;
          break;
        }
        if (/^#{1,6}\s+/.test(next)) break;
        if (/^[-*]\s+/.test(next) || /^\d+\.\s+/.test(next)) break;
        contentLines.push(next.replace(/^\s*>?\s*/, ""));
        i++;
      }
      items.push({ id: `mem-${idx++}`, text: contentLines.join(" ").slice(0, 300) });
      continue;
    }

    // Bullet list item (- or *)
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      items.push({ id: `mem-${idx++}`, text: bulletMatch[1].slice(0, 300) });
      i++;
      continue;
    }

    // Numbered list item
    const numMatch = trimmed.match(/^\d+\.\s+(.+)/);
    if (numMatch) {
      items.push({ id: `mem-${idx++}`, text: numMatch[1].slice(0, 300) });
      i++;
      continue;
    }

    // Paragraph: collect until empty line
    const paraLines: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next) break;
      if (/^#{1,6}\s+/.test(next)) break;
      if (/^[-*]\s+/.test(next) || /^\d+\.\s+/.test(next)) break;
      paraLines.push(next);
      i++;
    }
    items.push({ id: `mem-${idx++}`, text: paraLines.join(" ").slice(0, 300) });
  }

  return items;
}

// ── Enhanced parser: preserves type, level, and children hierarchy ──

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

export function parseMemoryFileContent(
  raw: string,
  path: string,
  label: string,
  scope: "project" | "global" | "memory",
): ParsedMemoryFile {
  const content = stripFrontmatter(raw);
  const blocks: MemoryBlock[] = [];
  let idx = 0;
  let itemCount = 0;

  if (!content) {
    return { path, label, scope, blocks, itemCount: 0 };
  }

  const lines = content.split("\n");
  let i = 0;

  function parseBlock(type: MemoryBlockType, text: string, level?: number): MemoryBlock {
    return {
      id: `blk-${idx++}`,
      type,
      text: text.slice(0, 300),
      level,
      children: [],
      collapsed: false,
    };
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Heading: collect subsequent content as one block with possible children
    if (/^#{1,6}\s+/.test(trimmed)) {
      const headingLevel = trimmed.match(/^#+/)?.[0].length ?? 1;
      const headingText = trimmed.replace(/^#{1,6}\s+/, "").trim();
      const block = parseBlock("heading", headingText, headingLevel);
      itemCount++;

      // Collect non-empty lines until next heading or empty line
      i++;
      const childLines: string[] = [];
      while (i < lines.length) {
        const next = lines[i].trim();
        if (!next) {
          i++;
          break;
        }
        if (/^#{1,6}\s+/.test(next)) break;
        if (/^[-*]\s+/.test(next) || /^\d+\.\s+/.test(next)) break;
        childLines.push(next.replace(/^\s*>?\s*/, ""));
        i++;
      }

      // Remaining non-empty lines form paragraph children
      if (childLines.length > 0) {
        block.children.push(parseBlock("paragraph", childLines.join(" ")));
        itemCount++;
      }

      blocks.push(block);
      continue;
    }

    // Bullet list item
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      blocks.push(parseBlock("bullet", bulletMatch[1]));
      itemCount++;
      i++;
      continue;
    }

    // Numbered list item
    const numMatch = trimmed.match(/^\d+\.\s+(.+)/);
    if (numMatch) {
      blocks.push(parseBlock("numbered", numMatch[1]));
      itemCount++;
      i++;
      continue;
    }

    // Paragraph: collect until empty line or next heading/list
    const paraLines: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next) break;
      if (/^#{1,6}\s+/.test(next)) break;
      if (/^[-*]\s+/.test(next) || /^\d+\.\s+/.test(next)) break;
      paraLines.push(next);
      i++;
    }
    blocks.push(parseBlock("paragraph", paraLines.join(" ")));
    itemCount++;
  }

  return { path, label, scope, blocks, itemCount };
}
