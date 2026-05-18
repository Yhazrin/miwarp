/** Root-relative static asset URLs (work in dev, Tauri production, and browser). */
export function staticAsset(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base}${path.replace(/^\//, "")}`;
}

/** Sidebar / splash logo (~6 KB). */
export const APP_LOGO_URL = staticAsset("logo.png");

/** Large brand mark for dark backgrounds. */
export const APP_LOGO_LIGHT_URL = staticAsset("logo-light.png");
