/**
 * Svelte action to portal an element to a target location in the DOM.
 * Defaults to document.body.
 */
export function portal(node: HTMLElement, target: string | HTMLElement = "body") {
  const targetEl = typeof target === "string" ? document.querySelector(target) : target;

  if (!targetEl) {
    console.warn(`[portal] target not found: ${target}`);
    return;
  }

  targetEl.appendChild(node);

  return {
    destroy() {
      node.remove();
    },
  };
}
