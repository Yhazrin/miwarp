import { mount, unmount } from "svelte";
import VisualBlockHost from "./components/VisualBlockHost.svelte";
import { VISUAL_SUMMARY_I18N_KEYS, type VisualSummaryKey } from "./registry";
import type { VisualBlockKind, VisualBlockTone } from "./types";

export function mountVisualBlocks(root: HTMLElement, opts: { tone: VisualBlockTone }): () => void {
  const instances: Array<ReturnType<typeof mount>> = [];
  const mountedHosts: HTMLElement[] = [];
  const hosts = root.querySelectorAll<HTMLElement>(
    "[data-visual-block]:not([data-visual-mounted])",
  );

  hosts.forEach((host) => {
    const mountTarget =
      host.querySelector<HTMLElement>(".visual-block-mount") ??
      (() => {
        const el = document.createElement("div");
        el.className = "visual-block-mount";
        host.prepend(el);
        return el;
      })();

    host.dataset.visualMounted = "true";
    mountedHosts.push(host);
    const kind = (host.dataset.visualKind ?? "") as VisualBlockKind;
    const summaryKey = (host.dataset.visualSummaryKey ??
      VISUAL_SUMMARY_I18N_KEYS[kind]) as VisualSummaryKey;
    const source = host.querySelector(".visual-block-source")?.textContent ?? "";

    const instance = mount(VisualBlockHost, {
      target: mountTarget,
      props: {
        kind,
        source,
        summaryKey,
        tone: opts.tone,
      },
    });
    instances.push(instance);
  });

  return () => {
    for (const instance of instances) {
      unmount(instance);
    }
    for (const host of mountedHosts) {
      delete host.dataset.visualMounted;
    }
  };
}
