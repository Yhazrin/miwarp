import { readFileBase64, validateMediaFile } from "$lib/api";
// media-types imports removed — were unused
import { detectFilePaths, type DetectedPath } from "./media-detector";
import type { MediaArtifact, MediaArtifactKind } from "$lib/types";

/**
 * Cache for resolved artifacts.
 * Key: path
 */
const artifactCache = new Map<string, MediaArtifact>();
const pendingRequests = new Map<string, Promise<MediaArtifact | null>>();

/**
 * Resolve a single file path to a MediaArtifact.
 */
async function resolveArtifact(path: string, cwd?: string): Promise<MediaArtifact | null> {
  // Check cache
  if (artifactCache.has(path)) {
    return artifactCache.get(path)!;
  }

  // Deduplicate concurrent requests
  if (pendingRequests.has(path)) {
    return pendingRequests.get(path)!;
  }

  const request = (async () => {
    try {
      const metadata = await validateMediaFile(path, cwd);

      const artifact: MediaArtifact = {
        id: `${metadata.path}:${metadata.size}`,
        kind: metadata.kind as MediaArtifactKind,
        path: metadata.path,
        name: metadata.name,
        size: metadata.size,
        mimeType: metadata.mime,
        previewable: metadata.previewable,
      };

      // Fetch content for previewable artifacts
      if (artifact.previewable) {
        try {
          const [base64, mime] = await readFileBase64(artifact.path, cwd);
          artifact.contentBase64 = base64;
          artifact.mimeType = mime;
        } catch {
          // Content fetch failed, but we still have metadata
        }
      }

      artifactCache.set(path, artifact);
      return artifact;
    } catch {
      return null;
    }
  })();

  pendingRequests.set(path, request);

  try {
    return await request;
  } finally {
    pendingRequests.delete(path);
  }
}

/**
 * Resolve multiple file paths from detected positions in text.
 */
export async function resolveArtifactsFromText(
  text: string,
  cwd?: string,
): Promise<Map<DetectedPath, MediaArtifact | null>> {
  const detected = detectFilePaths(text);
  const results = new Map<DetectedPath, MediaArtifact | null>();

  await Promise.all(
    detected.map(async (d) => {
      const artifact = await resolveArtifact(d.path, cwd);
      results.set(d, artifact);
    }),
  );

  return results;
}

/**
 * Clear artifact cache (e.g., when session changes).
 */
function clearArtifactCache(): void {
  artifactCache.clear();
  pendingRequests.clear();
}
