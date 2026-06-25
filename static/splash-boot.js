/**
 * Runs synchronously in <head> before paint so the splash matches saved theme/mode.
 * Keeps logic aligned with theme-store init (miwarp-theme + legacy ocv: keys).
 */
(function splashBoot() {
  var doc = document.documentElement;

  function effectiveMode(mode) {
    if (mode === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return mode === "dark" ? "dark" : "light";
  }

  function applyTheme(base, mode, colorScheme) {
    var effective = effectiveMode(mode);
    doc.setAttribute("data-theme", effective === "light" ? base + "-light" : base);
    doc.classList.add(effective === "dark" ? "dark" : "light");
    doc.setAttribute("data-color-scheme", effective);
    doc.style.colorScheme = effective;
    doc.classList.add(colorScheme === "neutral" ? "scheme-neutral" : "scheme-warm");
  }

  function migrateBaseId(themeId) {
    if (typeof themeId !== "string" || !themeId) return { base: "codex", mode: "light" };
    if (themeId.endsWith("-light")) {
      return { base: themeId.slice(0, -6), mode: "light" };
    }
    return { base: themeId, mode: null };
  }

  try {
    var stored = localStorage.getItem("miwarp-theme");
    if (stored) {
      var cfg = JSON.parse(stored);
      var migrated = migrateBaseId(cfg.currentTheme || "codex");
      var base = migrated.base;
      var mode = cfg.mode || migrated.mode || "light";
      applyTheme(base, mode, cfg.colorScheme === "neutral" ? "neutral" : "warm");
    } else {
      var legacyTheme = localStorage.getItem("ocv:theme");
      var legacyScheme = localStorage.getItem("ocv:colorScheme");
      if (legacyTheme === "light" || legacyTheme === "dark" || legacyTheme === "system") {
        applyTheme("codex", legacyTheme, legacyScheme === "neutral" ? "neutral" : "warm");
      } else {
        applyTheme("codex", "light", "warm");
      }
    }
  } catch (_err) {
    applyTheme("codex", "light", "warm");
  }

  try {
    var locale = localStorage.getItem("ocv:locale") || "";
    if (!locale && typeof navigator !== "undefined") {
      locale = (navigator.language || "").toLowerCase();
    }
    doc.setAttribute("data-splash-hint", locale.startsWith("zh") ? "正在加载…" : "Loading…");
  } catch (_err2) {
    doc.setAttribute("data-splash-hint", "Loading…");
  }
})();
