// Dynamic import — desktop-only feature, breaks in browser (WS) mode

const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[data-no-drag]",
  "[contenteditable='true']",
  ".no-drag",
].join(",");

let currentWindowPromise: Promise<import("@tauri-apps/api/window").Window> | null = null;

function currentWindow() {
  currentWindowPromise ??= import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
    getCurrentWindow(),
  );
  return currentWindowPromise;
}

export function preloadWindowDrag() {
  const maybeTauriWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (!maybeTauriWindow.__TAURI_INTERNALS__) return;

  void currentWindow().catch(() => {
    currentWindowPromise = null;
  });
}

export function isWindowDragInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(INTERACTIVE_SELECTOR);
}

export async function startWindowDragFromEvent(event: PointerEvent | MouseEvent) {
  if (event.button !== 0) return;

  if (isWindowDragInteractiveTarget(event.target)) {
    return;
  }

  event.preventDefault();

  try {
    await (await currentWindow()).startDragging();
  } catch (error) {
    currentWindowPromise = null;
    console.warn("[window-drag] startDragging failed", error);
  }
}
