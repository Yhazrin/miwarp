/**
 * Composable: file preview management.
 *
 * Opens file previews in the sidebar or main view, managing the sidebar tab state.
 */
import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";

export function usePreviewController(opts: {
  getSidebarCollapsed: () => boolean;
  setSidebarCollapsed: (v: boolean) => void;
  getSidebarRequestedTab: () => ToolActivityPanelTab | null;
  setSidebarRequestedTab: (tab: ToolActivityPanelTab | null) => void;
  setRequestedPreviewPath: (path: string | null) => void;
}) {
  function openPreviewForPath(path: string) {
    if (!path) return;
    opts.setRequestedPreviewPath(path);
    opts.setSidebarRequestedTab("files");
    if (opts.getSidebarCollapsed()) {
      opts.setSidebarCollapsed(false);
    }
  }

  return { openPreviewForPath };
}
