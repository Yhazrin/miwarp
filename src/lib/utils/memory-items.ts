/**
 * Parse memory content into individual displayable items.
 * Supports bullet lists, numbered lists, headings with content, and paragraph breaks.
 */
export interface MemoryItem {
  id: string;
  text: string;
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
