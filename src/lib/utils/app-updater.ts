import { checkForUpdates } from "$lib/api";
import type { UpdateInfo } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

export type AppUpdatePhase = "idle" | "checking" | "downloading" | "installing" | "relaunching";

export type AppUpdateProgress = {
  phase: AppUpdatePhase;
  /** 0–100 when downloading */
  percent: number | null;
};

export type AppUpdateOffer =
  | {
      kind: "in_app";
      version: string;
      currentVersion: string;
      notes: string;
    }
  | {
      kind: "external";
      version: string;
      currentVersion: string;
      downloadUrl: string;
    };

async function isDesktopTauri(): Promise<boolean> {
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    return isTauri();
  } catch {
    return false;
  }
}

/** Prefer signed in-app updater; fall back to GitHub release download page. */
export async function discoverAppUpdate(): Promise<AppUpdateOffer | null> {
  if (await isDesktopTauri()) {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        dbg("app-updater", "in-app update available", update.version);
        return {
          kind: "in_app",
          version: update.version,
          currentVersion: update.currentVersion,
          notes: update.body ?? "",
        };
      }
    } catch (e) {
      dbgWarn("app-updater", "in-app check failed, falling back to GitHub API", e);
    }
  }

  const info = await checkForUpdates();
  if (info.error) {
    dbgWarn("app-updater", "GitHub check error:", info.error);
    return null;
  }
  if (!info.hasUpdate) return null;
  if (!info.downloadUrl) return null;

  return {
    kind: "external",
    version: info.latestVersion,
    currentVersion: info.currentVersion,
    downloadUrl: info.downloadUrl,
  };
}

export async function checkAppUpdateStatus(): Promise<{
  offer: AppUpdateOffer | null;
  error: string | null;
  upToDateVersion: string | null;
}> {
  if (await isDesktopTauri()) {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        return {
          offer: {
            kind: "in_app",
            version: update.version,
            currentVersion: update.currentVersion,
            notes: update.body ?? "",
          },
          error: null,
          upToDateVersion: null,
        };
      }
      const { getVersion } = await import("@tauri-apps/api/app");
      const current = await getVersion();
      return { offer: null, error: null, upToDateVersion: current };
    } catch (e) {
      dbgWarn("app-updater", "in-app status check failed", e);
    }
  }

  let info: UpdateInfo;
  try {
    info = await checkForUpdates();
  } catch (e) {
    return { offer: null, error: String(e), upToDateVersion: null };
  }

  if (info.error) {
    return { offer: null, error: info.error, upToDateVersion: null };
  }
  if (info.hasUpdate && info.downloadUrl) {
    return {
      offer: {
        kind: "external",
        version: info.latestVersion,
        currentVersion: info.currentVersion,
        downloadUrl: info.downloadUrl,
      },
      error: null,
      upToDateVersion: null,
    };
  }
  return {
    offer: null,
    error: null,
    upToDateVersion: info.currentVersion,
  };
}

export async function installInAppUpdate(
  onProgress?: (progress: AppUpdateProgress) => void,
): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");

  const update = await check();
  if (!update) {
    throw new Error("No in-app update available");
  }

  onProgress?.({ phase: "downloading", percent: 0 });

  let downloaded = 0;
  let contentLength = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        onProgress?.({ phase: "downloading", percent: 0 });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (contentLength > 0) {
          onProgress?.({
            phase: "downloading",
            percent: Math.min(100, Math.round((downloaded / contentLength) * 100)),
          });
        }
        break;
      case "Finished":
        onProgress?.({ phase: "installing", percent: 100 });
        break;
    }
  });

  onProgress?.({ phase: "relaunching", percent: null });
  await relaunch();
}

export async function openExternalUpdateUrl(url: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank");
  }
}
