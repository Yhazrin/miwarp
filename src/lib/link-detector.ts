export type LinkType = "web" | "local-file" | "local-folder";

export interface DetectedLink {
  url: string;
  type: LinkType;
  startIndex: number;
  endIndex: number;
  label?: string;
}

/**
 * Detect all URLs and local paths in text content.
 * Filters out code regions, includes markdown links, and avoids double-detecting
 * URL path fragments as local filesystem paths.
 */
export function detectLinks(text: string): DetectedLink[] {
  const results: DetectedLink[] = [];
  const codeRegions = findCodeRegions(text);
  const occupiedRegions: ExclusionRegion[] = [];

  // Markdown links are already clickable inline, but surfacing them as cards makes
  // assistant-provided references easier to scan and reopen.
  const mdLinkPattern = /!?\[([^\]]*)\]\(([^)\s]+(?:\s+["'][^"']*["'])?)\)/g;
  for (const match of text.matchAll(mdLinkPattern)) {
    const fullMatch = match[0];
    const rawTarget = match[2].trim();
    const url = stripMarkdownTitle(stripAngleBrackets(rawTarget));
    const urlStart = match.index! + fullMatch.indexOf(rawTarget);
    if (!isRecognizedLink(url)) continue;
    if (isExcluded(match.index!, match.index! + fullMatch.length, codeRegions)) continue;

    const type = getLinkType(url);
    results.push({
      url,
      type,
      startIndex: urlStart,
      endIndex: urlStart + url.length,
      label: match[1]?.trim() || undefined,
    });
    occupiedRegions.push({ start: match.index!, end: match.index! + fullMatch.length });
  }

  // Detect web URLs (http, https, ftp)
  const webUrlPattern = /\b(?:https?|ftp):\/\/[^\s'"<>`]+/gi;
  for (const match of text.matchAll(webUrlPattern)) {
    const url = stripTrailingPunctuation(match[0]);
    if (url.length < 5) continue; // too short to be valid
    const start = match.index!;
    const end = start + match[0].length;
    if (isExcluded(start, end, codeRegions) || isExcluded(start, end, occupiedRegions)) continue;
    results.push({
      url,
      type: "web",
      startIndex: start,
      endIndex: start + url.length,
    });
    occupiedRegions.push({ start, end });
  }

  // Detect practical bare web addresses that users often paste without a scheme.
  const bareUrlPattern =
    /(^|[\s([{<])((?:www\.)[^\s'"<>`]+|(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?(?:\/[^\s'"<>`]*)?)/gi;
  for (const match of text.matchAll(bareUrlPattern)) {
    const prefix = match[1] ?? "";
    const raw = match[2];
    const start = match.index! + prefix.length;
    const end = start + raw.length;
    const url = stripTrailingPunctuation(raw);
    if (url.length < 4) continue;
    if (isExcluded(start, end, codeRegions) || isExcluded(start, end, occupiedRegions)) continue;
    results.push({
      url: normalizeBareWebUrl(url),
      type: "web",
      startIndex: start,
      endIndex: start + url.length,
      label: url,
    });
    occupiedRegions.push({ start, end });
  }

  // Detect file:// URLs separately so they open as local targets.
  const fileUrlPattern = /\bfile:\/\/\/?[^\s'"<>`]+/gi;
  for (const match of text.matchAll(fileUrlPattern)) {
    const url = stripTrailingPunctuation(match[0]);
    const start = match.index!;
    const end = start + match[0].length;
    if (isExcluded(start, end, codeRegions) || isExcluded(start, end, occupiedRegions)) continue;
    results.push({
      url,
      type: getLocalPathType(url),
      startIndex: start,
      endIndex: start + url.length,
    });
    occupiedRegions.push({ start, end });
  }

  // Detect local paths (Unix absolute, Windows absolute, ~/ paths). The leading
  // boundary prevents relative paths like `src/lib/file.ts` from producing
  // a bogus `/lib/file.ts` card.
  const localPathPattern =
    /(^|[\s([{<'"“‘])([a-zA-Z]:[\\/][^\s'"<>|`]+|\/[^\s'"<>|`]+|~\/[^\s'"<>|`]+)/g;
  for (const match of text.matchAll(localPathPattern)) {
    const raw = match[2];
    const path = stripTrailingPunctuation(raw.replace(/[|>]+/g, "")); // clean up artifacts
    if (path.length < 2) continue;
    const start = match.index! + (match[1]?.length ?? 0);
    const end = start + raw.length;
    if (isExcluded(start, end, codeRegions) || isExcluded(start, end, occupiedRegions)) continue;
    if (looksLikeUrlPathFragment(text, start)) continue;
    if (!isLikelyLocalPath(path)) continue;

    const type = getLocalPathType(path);
    results.push({
      url: path,
      type,
      startIndex: start,
      endIndex: start + path.length,
    });
    occupiedRegions.push({ start, end });
  }

  // Sort by position for consistent processing
  results.sort((a, b) => a.startIndex - b.startIndex);

  return dedupeLinks(results);
}

interface ExclusionRegion {
  start: number;
  end: number;
}

function findCodeRegions(text: string): ExclusionRegion[] {
  const regions: ExclusionRegion[] = [];

  // Find code blocks ```...```
  const codeBlockPattern = /```[\s\S]*?```/g;
  for (const match of text.matchAll(codeBlockPattern)) {
    regions.push({
      start: match.index!,
      end: match.index! + match[0].length,
    });
  }

  // Find inline code `...`
  const inlineCodePattern = /`[^`\n]+`/g;
  for (const match of text.matchAll(inlineCodePattern)) {
    regions.push({
      start: match.index!,
      end: match.index! + match[0].length,
    });
  }

  return regions;
}

function isExcluded(start: number, end: number, exclusions: ExclusionRegion[]): boolean {
  for (const region of exclusions) {
    if (start >= region.start && end <= region.end) return true;
  }
  return false;
}

function getLocalPathType(path: string): "local-file" | "local-folder" {
  if (path.startsWith("file://")) {
    const withoutScheme = path.replace(/^file:\/\/\/?/i, "/");
    return getLocalPathType(withoutScheme);
  }

  const normalizedPath = stripLineColumnSuffix(path);
  // If it ends with / or \, it's likely a folder
  if (normalizedPath.endsWith("/") || normalizedPath.endsWith("\\")) {
    return "local-folder";
  }
  // Check if it has a file extension
  const lastSlash = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  const filename = lastSlash >= 0 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;
  if (filename && filename.includes(".") && !filename.startsWith(".")) {
    // Has a dot in filename (not starting with dot like .gitignore)
    // Check it's actually an extension pattern
    const extMatch = filename.match(/\.[^./\\]+$/);
    if (extMatch) {
      // Common non-extension patterns: .gitignore, .env, .bashrc
      const isKnownConfigFile = [
        ".gitignore",
        ".env",
        ".bashrc",
        ".zshrc",
        ".profile",
        ".bash_profile",
      ].includes(filename.toLowerCase());
      if (!isKnownConfigFile) {
        return "local-file";
      }
    }
  }
  return "local-folder";
}

function stripTrailingPunctuation(url: string): string {
  // Remove trailing punctuation that commonly gets included in URLs
  return url.replace(/[.,;!?)+\]}>'"]+$/g, "");
}

function stripMarkdownTitle(rawTarget: string): string {
  return rawTarget.replace(/\s+["'][^"']*["']\s*$/, "").trim();
}

function stripAngleBrackets(value: string): string {
  if (value.startsWith("<") && value.endsWith(">")) {
    return value.slice(1, -1);
  }
  return value;
}

function isRecognizedLink(url: string): boolean {
  return (
    /^(?:https?|ftp):\/\//i.test(url) ||
    /^file:\/\//i.test(url) ||
    /^www\./i.test(url) ||
    /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?(?:\/|$)/i.test(url) ||
    isLikelyLocalPath(url)
  );
}

function getLinkType(url: string): LinkType {
  if (/^(?:https?|ftp):\/\//i.test(url) || /^www\./i.test(url)) return "web";
  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?(?:\/|$)/i.test(url)) {
    return "web";
  }
  return getLocalPathType(url);
}

function normalizeBareWebUrl(url: string): string {
  if (/^(?:https?|ftp):\/\//i.test(url)) return url;
  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?(?:\/|$)/i.test(url)) {
    return `http://${url}`;
  }
  return `https://${url}`;
}

function looksLikeUrlPathFragment(text: string, start: number): boolean {
  const prefix = text.slice(Math.max(0, start - 12), start).toLowerCase();
  return /(?:https?|ftp|file):$/.test(prefix) || /(?:https?|ftp):\/$/.test(prefix);
}

function isLikelyLocalPath(path: string): boolean {
  const normalizedPath = stripLineColumnSuffix(stripTrailingPunctuation(path));

  if (/^file:\/\//i.test(normalizedPath)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(normalizedPath)) return true;
  if (normalizedPath.startsWith("~/")) return true;

  // A leading slash can also be an app route or a relative web URL. Be conservative:
  // only promote common filesystem roots to rich local cards.
  return /^\/(?:Users|home|tmp|var|opt|etc|usr|Volumes|Applications|private|mnt|media|workspace|workspaces)(?:\/|$)/i.test(
    normalizedPath,
  );
}

function stripLineColumnSuffix(path: string): string {
  return path.replace(/:(\d+)(?::\d+)?$/, "");
}

function dedupeLinks(links: DetectedLink[]): DetectedLink[] {
  const seen = new Set<string>();
  const deduped: DetectedLink[] = [];

  for (const link of links) {
    const key = `${link.type}:${normalizeDedupeUrl(link.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }

  return deduped;
}

function normalizeDedupeUrl(url: string): string {
  return url.replace(/\/$/, "").toLowerCase();
}
