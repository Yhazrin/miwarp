/**
 * mermaid-graph — pure utilities for parsing mermaid sources and the SVG
 * structure that mermaid 11 emits. Used by MermaidInteractive to support
 * hover highlight (L2) and tooltip (L4) without leaking into the loader.
 *
 * Mermaid renders a flowchart as:
 *   - Nodes: <g class="node default" id="prefix-flowchart-A-0" transform="…">
 *   - Edges: <path class="flowchart-link" data-id="L_A_B_0" …>
 * Sequence / class / state diagrams use different id shapes — we only
 * cover flowchart (the dominant case) and fail silently on the rest.
 */

const FLOWCHART_NODE_TAIL = /^([A-Za-z][A-Za-z0-9]*)(?:-(\d+))?$/;
const FLOWCHART_EDGE_DATA_ID = /^L_([A-Za-z_][A-Za-z0-9_]*)_([A-Za-z_][A-Za-z0-9_]*)_(\d+)$/;
const NODE_DEF_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[[({>]/;
const FLOWCHART_TYPE_MARKER = "-flowchart-";
const COMMENT_LINE = /^\s*\/\/\s*(.+?)\s*$/;
const MERMAID_DIRECTIVE = /^\s*%%/;
const SUBGRAPH_OPEN = /^\s*subgraph\s+/i;
const SUBGRAPH_CLOSE = /^\s*end\s*$/i;
const CLASS_DEF = /^\s*classDef\s+/i;
const CLASS_ASSIGN = /^\s*class\s+/i;

/**
 * Walk the mermaid source and pair every `// comment` line with the next
 * node definition. The comment becomes the tooltip body for that node.
 *
 * Rules:
 *   - Blank lines and mermaid directives (`%%`) do NOT break the comment chain.
 *   - `subgraph …` / `end` / `classDef` / `class` lines do not consume the
 *     pending comment and are not considered "node lines".
 *   - First comment for a given node id wins; later duplicates are ignored.
 */
export function parseNodeCommentMap(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = source.split(/\r?\n/);
  let pending: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue; // blank lines preserve pending
    if (MERMAID_DIRECTIVE.test(line)) continue; // `%%init%%` preserves pending
    // Structural lines that the user did NOT write a comment for — they
    // break the comment chain because the comment was likely about the
    // subgraph / class itself, not a node inside.
    if (
      SUBGRAPH_OPEN.test(line) ||
      SUBGRAPH_CLOSE.test(line) ||
      CLASS_DEF.test(line) ||
      CLASS_ASSIGN.test(line)
    ) {
      pending = null;
      continue;
    }

    const commentMatch = line.match(COMMENT_LINE);
    if (commentMatch) {
      pending = commentMatch[1];
      continue;
    }

    const idMatch = line.match(NODE_DEF_LINE);
    if (idMatch && pending !== null) {
      const id = idMatch[1];
      if (!map.has(id)) map.set(id, pending);
      pending = null;
      continue;
    }

    // Any other non-comment, non-structural line — fall through to reset
    // (e.g. an `A --> B` line without a leading node definition shouldn't
    // strand a comment waiting for a node that already appeared).
    if (pending !== null) pending = null;
  }
  return map;
}

/**
 * Pull the user-facing node id out of a `<g class="node …" id="…">` element.
 *
 * Mermaid composes the id as `${diagramId}-flowchart-${nodeId}-${index}`,
 * where `${diagramId}` is whatever string the caller passed to render().
 * The diagram id can itself contain hyphens (e.g. `probe-flowchart`), so
 * we split on the LAST `-flowchart-` marker rather than anchoring the start.
 */
export function nodeIdFromElementId(elementId: string): string | null {
  const idx = elementId.lastIndexOf(FLOWCHART_TYPE_MARKER);
  if (idx < 0) return null;
  const tail = elementId.slice(idx + FLOWCHART_TYPE_MARKER.length);
  const m = tail.match(FLOWCHART_NODE_TAIL);
  return m ? m[1] : null;
}

/** Parse a mermaid edge data-id (`L_A_B_0`) into source/target. */
export function parseEdgeDataId(
  dataId: string,
): { source: string; target: string; index: number } | null {
  const m = dataId.match(FLOWCHART_EDGE_DATA_ID);
  if (!m) return null;
  return {
    source: m[1],
    target: m[2],
    index: m[3] ? parseInt(m[3], 10) : 0,
  };
}

/**
 * Build an adjacency map: for each node id, the list of edge <path> elements
 * that touch it. Used by MermaidInteractive to highlight connected edges on
 * node hover.
 */
export function buildEdgeAdjacency(svg: SVGSVGElement): Map<string, SVGPathElement[]> {
  const map = new Map<string, SVGPathElement[]>();
  const links = svg.querySelectorAll<SVGPathElement>(".flowchart-link");
  for (const link of links) {
    const dataId = link.getAttribute("data-id");
    if (!dataId) continue;
    const parsed = parseEdgeDataId(dataId);
    if (!parsed) continue;
    const { source, target } = parsed;
    const add = (id: string) => {
      const list = map.get(id);
      if (list) list.push(link);
      else map.set(id, [link]);
    };
    add(source);
    add(target);
  }
  return map;
}
