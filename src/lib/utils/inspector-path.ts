/**
 * v1.0.6 / 5.3: Inspector path safety validation.
 *
 * Ensures that file paths opened in the Workspace Inspector
 * stay within the workspace boundary and don't escape to
 * sensitive system locations.
 */

/** Characters/sequences that indicate a path escape attempt. */
const DANGEROUS_PATTERNS = [
  /\.\./, // parent directory traversal
  /^~/, // home directory expansion
  /^file:\/\//i, // file:// protocol
  /^javascript:/i, // javascript: protocol
  /^\0/, // null byte injection
];

/** Blocked file extensions (binary / executable). */
const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".app",
  ".msi",
  ".sh",
  ".bat",
  ".cmd",
  ".ps1",
]);

export interface PathValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a path is safe to open in the Inspector.
 * Must be within the workspace root or the run's artifact directory.
 */
export function validateInspectorPath(
  path: string,
  workspaceRoot: string,
  artifactDir?: string,
): PathValidationResult {
  if (!path) return { valid: false, reason: "Empty path" };

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(path)) {
      return { valid: false, reason: `Blocked pattern: ${pattern.source}` };
    }
  }

  // Check blocked extensions
  const ext = path.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    return { valid: false, reason: `Blocked extension: ${ext}` };
  }

  // Normalize paths for comparison
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(workspaceRoot);
  const normalizedArtifact = artifactDir ? normalizePath(artifactDir) : null;

  // Path must be within workspace root or artifact directory
  if (normalizedPath.startsWith(normalizedRoot)) return { valid: true };
  if (normalizedArtifact && normalizedPath.startsWith(normalizedArtifact)) return { valid: true };

  return { valid: false, reason: "Path is outside workspace boundary" };
}

/**
 * Normalize a file path for cross-platform comparison.
 * Converts backslashes to forward slashes and removes trailing slashes.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Extract line number from a path like "src/foo.ts:42".
 * Returns { path, line } or { path } if no line number.
 */
function parsePathWithLine(raw: string): { path: string; line?: number } {
  const match = raw.match(/^(.+?):(\d+)$/);
  if (match) {
    return { path: match[1], line: parseInt(match[2], 10) };
  }
  return { path: raw };
}
