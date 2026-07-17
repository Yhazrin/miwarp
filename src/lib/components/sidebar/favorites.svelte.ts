import { STORAGE_KEYS } from "./constants";

/** Reactive set of pinned cwd paths. */
export function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.FAVORITES) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function saveFavorites(favs: Set<string>) {
  localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify([...favs]));
}

export function toggleFavorite(favorites: Set<string>, cwd: string): Set<string> {
  const next = new Set(favorites);
  if (next.has(cwd)) {
    next.delete(cwd);
  } else {
    next.add(cwd);
  }
  return next;
}
