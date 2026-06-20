/**
 * App version + update check service.
 *
 * Owns the side-effect of querying the bundled Tauri version and comparing it
 * with the latest GitHub release. Layout subscribes via the returned handle so
 * the implementation can change (Rust command name, release URL, polling vs
 * event-driven) without touching the layout file.
 */
import { APP_UPDATE_RELEASE_TIMEOUT_MS } from "$lib/utils/layout-timings";

export type AppUpdateState = {
  version: string;
  checked: boolean;
  updateAvailable: boolean;
};

const INITIAL: AppUpdateState = {
  version: "v...",
  checked: false,
  updateAvailable: false,
};

async function readBundledVersion(): Promise<string | null> {
  try {
    const mod = await import("@tauri-apps/api/app");
    return await mod.getVersion();
  } catch {
    return null;
  }
}

async function readLatestReleaseTag(): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/repos/Yhazrin/miwarp/releases/latest", {
      signal: AbortSignal.timeout(APP_UPDATE_RELEASE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    return (data.tag_name ?? "").replace(/^v/, "") || null;
  } catch {
    return null;
  }
}

export async function checkAppUpdate(): Promise<AppUpdateState> {
  const bundled = await readBundledVersion();
  if (!bundled) return { ...INITIAL, checked: true };

  const version = `v${bundled}`;
  const latest = await readLatestReleaseTag();
  const updateAvailable = latest !== null && latest !== "" && latest !== bundled;
  return { version, checked: true, updateAvailable };
}
