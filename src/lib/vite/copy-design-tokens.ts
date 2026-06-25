import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const SOURCE = resolve("src/lib/styles/design-tokens.css");
const TARGET = resolve("static/design-tokens.css");

/** Copy design tokens into /static so app.html splash can load them before Svelte boots. */
export function copyDesignTokensPlugin(): Plugin {
  return {
    name: "miwarp-copy-design-tokens",
    buildStart() {
      if (!existsSync(SOURCE)) return;
      copyFileSync(SOURCE, TARGET);
    },
  };
}
