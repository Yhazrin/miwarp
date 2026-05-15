import { getCurrentWindow } from "@tauri-apps/api/window";

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

export async function startWindowDragFromEvent(event: PointerEvent | MouseEvent) {
  if (event.button !== 0) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;

  // Don't drag if clicking on interactive elements
  if (target.closest(INTERACTIVE_SELECTOR)) {
    return;
  }

  event.preventDefault();

  try {
    await getCurrentWindow().startDragging();
  } catch (error) {
    console.warn("[window-drag] startDragging failed", error);
  }
}
