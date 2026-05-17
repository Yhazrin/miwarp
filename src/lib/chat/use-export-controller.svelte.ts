/**
 * Composable: HTML conversation export.
 *
 * Handles exporting the conversation to an HTML file with full render
 * (unfiltered, unlimited) before capturing DOM content.
 */
import { tick } from "svelte";
import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { SessionStore } from "$lib/stores";
import type { TimelineEntry } from "$lib/types";

export function useExportController(opts: {
  getStore: () => SessionStore;
  getToolFilter: () => string | null;
  setToolFilter: (v: string | null) => void;
  getProgressiveRenderLimit: () => number;
  setProgressiveRenderLimit: (v: number) => void;
  chatAreaRef: () => HTMLDivElement | undefined;
  showToast: (msg: string) => void;
  t: (key: string) => string;
}) {
  async function handleExportHtml() {
    const store = opts.getStore();
    if (!store.run) {
      dbgWarn("chat", "handleExportHtml: no run");
      opts.showToast(opts.t("export_noConversation"));
      return;
    }
    dbg("chat", "handleExportHtml: start");

    let html: string;
    let title: string;
    const prevFilter = opts.getToolFilter();
    const prevLimit = opts.getProgressiveRenderLimit();
    try {
      opts.setToolFilter(null);
      opts.setProgressiveRenderLimit(Infinity);
      await tick();
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));

      const rootEl = document.querySelector<HTMLElement>("[data-conversation-root]");
      if (!rootEl) {
        dbgWarn("chat", "handleExportHtml: data-conversation-root not found");
        opts.showToast(opts.t("export_noConversation"));
        return;
      }

      const { exportConversationToHtml, buildExportFilename: buildFn } =
        await import("$lib/utils/html-export");

      title = store.run.name ?? store.run.prompt?.slice(0, 80) ?? "Untitled";
      html = await exportConversationToHtml(rootEl, {
        title,
        sessionInfo: {
          model: store.model,
          cwd: store.effectiveCwd,
          startedAt: store.run.started_at,
          turnCount: store.numTurns || store.timeline.filter((e) => e.kind === "user").length,
        },
      });

      opts.setToolFilter(prevFilter);
      opts.setProgressiveRenderLimit(prevLimit);

      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: buildFn(title),
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (!path) {
        dbg("chat", "handleExportHtml: user cancelled");
        return;
      }

      await api.writeHtmlExport(path, html);
      dbg("chat", "handleExportHtml: done", { path });
      opts.showToast(opts.t("export_htmlSuccess"));
    } catch (e) {
      dbgWarn("chat", "handleExportHtml failed", e);
      opts.showToast(opts.t("export_htmlFailed"));
    } finally {
      opts.setToolFilter(prevFilter);
      opts.setProgressiveRenderLimit(prevLimit);
    }
  }

  return { handleExportHtml };
}
