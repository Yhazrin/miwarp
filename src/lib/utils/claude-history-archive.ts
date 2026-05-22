/** Shared helpers for Claude Code history archive export/import (desktop/Tauri). */

export function claudeHistoryArchiveDefaultName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  return `miwarp-claude-history-${stamp}.zip`;
}

export async function pickClaudeHistoryExportPath(): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { downloadDir, documentDir, join } = await import("@tauri-apps/api/path");
  const baseDir = (await downloadDir().catch(() => null)) ?? (await documentDir());
  const defaultPath = await join(baseDir, claudeHistoryArchiveDefaultName());
  return save({
    title: "Export Claude Code History",
    defaultPath,
    filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
  });
}

export async function pickClaudeHistoryImportPath(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title: "Import Claude Code History",
    filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    multiple: false,
  });
  if (!selected || Array.isArray(selected)) {
    return null;
  }
  return selected;
}

export function notifyRunsChanged(): void {
  window.dispatchEvent(new Event("ocv:runs-changed"));
}
