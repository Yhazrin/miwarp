/**
 * Runs synchronously in <head> before paint so the splash matches saved theme/mode.
 * Keep logic aligned with src/lib/theme/resolve-theme.ts + theme-store init.
 */
(function splashBoot() {
  var doc = document.documentElement;

  /** Keep in sync with BUILTIN_THEME_IDS in resolve-theme.ts */
  var BUILTIN_THEME_IDS = [
    "codex",
    "midnight",
    "ocean",
    "dracula",
    "nord",
    "morandi",
    "dev-preview",
    "carbonPink",
    "deepSeaMilk",
    "auroraPomelo",
    "pomegranateMist",
    "auroraLime",
  ];
  var DEFAULT_THEME_ID = "codex";

  function effectiveMode(mode) {
    if (mode === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return mode === "dark" ? "dark" : "light";
  }

  function migrateBaseId(themeId) {
    if (typeof themeId !== "string" || !themeId) return { base: DEFAULT_THEME_ID, mode: null };
    if (themeId.endsWith("-light")) {
      return { base: themeId.slice(0, -6), mode: "light" };
    }
    return { base: themeId, mode: null };
  }

  function resolveThemeEntry(themeId, customThemes) {
    var migrated = migrateBaseId(themeId || DEFAULT_THEME_ID);
    var base = migrated.base;
    var i;

    for (i = 0; i < BUILTIN_THEME_IDS.length; i += 1) {
      if (BUILTIN_THEME_IDS[i] === base) {
        return { id: base, variants: "both" };
      }
    }

    if (customThemes && customThemes.length) {
      for (i = 0; i < customThemes.length; i += 1) {
        if (customThemes[i] && customThemes[i].id === base) {
          return customThemes[i];
        }
      }
    }

    return { id: DEFAULT_THEME_ID, variants: "both" };
  }

  function resolveCssThemeBase(themeId) {
    var i;
    for (i = 0; i < BUILTIN_THEME_IDS.length; i += 1) {
      if (BUILTIN_THEME_IDS[i] === themeId) return BUILTIN_THEME_IDS[i];
    }

    if (themeId.indexOf("custom-") === 0) {
      var rest = themeId.slice(7);
      var sorted = BUILTIN_THEME_IDS.slice().sort(function (a, b) {
        return b.length - a.length;
      });
      for (i = 0; i < sorted.length; i += 1) {
        var builtinId = sorted[i];
        if (rest === builtinId || rest.indexOf(builtinId + "-") === 0) {
          return builtinId;
        }
      }
    }

    return DEFAULT_THEME_ID;
  }

  function resolveDataThemeValue(cssBase, effective, variants) {
    if (variants === "light" || variants === "dark") return cssBase;
    return effective === "light" ? cssBase + "-light" : cssBase;
  }

  function applyTheme(themeId, mode, colorScheme, customThemes) {
    var effective = effectiveMode(mode);
    var entry = resolveThemeEntry(themeId, customThemes);
    var cssBase = resolveCssThemeBase(entry.id);
    var dataTheme = resolveDataThemeValue(
      cssBase,
      effective,
      entry.variants || "both",
    );

    doc.setAttribute("data-theme", dataTheme);
    doc.classList.remove("dark", "light");
    doc.classList.add(effective === "dark" ? "dark" : "light");
    doc.setAttribute("data-color-scheme", effective);
    doc.style.colorScheme = effective;
    doc.classList.remove("scheme-neutral", "scheme-warm");
    doc.classList.add(colorScheme === "neutral" ? "scheme-neutral" : "scheme-warm");
  }

  try {
    var stored = localStorage.getItem("miwarp-theme");
    if (stored) {
      var cfg = JSON.parse(stored);
      var migrated = migrateBaseId(cfg.currentTheme || DEFAULT_THEME_ID);
      var mode = cfg.mode || migrated.mode || "light";
      applyTheme(
        migrated.base,
        mode,
        cfg.colorScheme === "neutral" ? "neutral" : "warm",
        cfg.customThemes || [],
      );
    } else {
      var legacyTheme = localStorage.getItem("ocv:theme");
      var legacyScheme = localStorage.getItem("ocv:colorScheme");
      if (legacyTheme === "light" || legacyTheme === "dark" || legacyTheme === "system") {
        applyTheme(DEFAULT_THEME_ID, legacyTheme, legacyScheme === "neutral" ? "neutral" : "warm", []);
      } else {
        applyTheme(DEFAULT_THEME_ID, "light", "warm", []);
      }
    }
  } catch (_err) {
    applyTheme(DEFAULT_THEME_ID, "light", "warm", []);
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
