import { isMediaPath, getExtension } from "./media-types";

export interface DetectedPath {
  path: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Detect local file paths in text content.
 * Looks for absolute paths and relative paths with media extensions.
 */
export function detectFilePaths(text: string): DetectedPath[] {
  const results: DetectedPath[] = [];

  // Pattern for absolute Unix paths, Windows paths, and ~/ paths
  const absolutePattern = /(?:[a-zA-Z]:[\\/])?\/[^\s'"<>|]+|~\/[^\s'"<>|]+/g;

  for (const match of text.matchAll(absolutePattern)) {
    const path = match[0];
    const ext = getExtension(path);
    if (ext && isMediaPath(path)) {
      results.push({
        path,
        startIndex: match.index,
        endIndex: match.index + path.length,
      });
    }
  }

  // Sort by position for consistent processing
  results.sort((a, b) => a.startIndex - b.startIndex);

  return results;
}
