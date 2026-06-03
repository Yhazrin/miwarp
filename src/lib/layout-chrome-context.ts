/** Left titlebar actions shared between layout toolbar and SessionStatusBar tier 2. */
export type LayoutChromeContext = {
  readonly state: { sidebarOpen: boolean };
  toggleSidebar: () => void;
  newChat: () => void;
  openCliBrowser: () => void;
  openSettings: () => void;
};

export const LAYOUT_CHROME_CONTEXT_KEY = "layoutChrome";
