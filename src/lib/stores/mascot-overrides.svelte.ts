/**
 * Global reactive store for mascot overrides.
 * Maps agent kind → custom image URL or data URI.
 * Updated whenever user settings are loaded or changed.
 */

let _overrides: Record<string, string> = $state({});

export function getMascotOverrides(): Record<string, string> {
  return _overrides;
}

export function setMascotOverrides(overrides: Record<string, string>): void {
  _overrides = overrides ?? {};
}
