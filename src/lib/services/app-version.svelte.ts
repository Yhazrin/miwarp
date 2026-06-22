/**
 * Read the bundled application version without performing a network request.
 * Update discovery is owned exclusively by AppUpdateCoordinator.
 */
export async function readBundledAppVersion(): Promise<string | null> {
  try {
    const mod = await import("@tauri-apps/api/app");
    return await mod.getVersion();
  } catch {
    return null;
  }
}
