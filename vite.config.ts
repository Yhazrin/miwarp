import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import path from "node:path";
import { copyDesignTokensPlugin } from "./src/lib/vite/copy-design-tokens";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [copyDesignTokensPlugin(), sveltekit()],
  build: {
    target: ["safari16", "chrome105", "edge105"],
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Vite synthesizes a single shared preload helper for all `import()` calls.
          // If it lands inside the codemirror-vendor chunk, every consumer of the
          // preload helper (i.e. every chunk with a dynamic import) ends up with a
          // static `import "./codemirror-vendor"` — defeating the lazy-load split.
          // Pin the helper to its own tiny chunk so codemirror-vendor stays leaf-only.
          if (id.includes("\0vite/preload-helper")) return "vite-preload-helper";
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer"))
            return "codemirror-vendor";
          if (id.includes("node_modules/@xterm")) return "xterm-vendor";
          // Heavy vendor modules: pin each into its own chunk so the entry chunk and
          // page chunks stay slim. Without these rules, marked/mermaid/vega/diff get
          // duplicated across every consumer and inflate the initial download.
          if (id.includes("node_modules/highlight.js")) return "vendor-hljs";
          if (id.includes("node_modules/marked")) return "vendor-marked";
          if (id.includes("node_modules/mermaid")) return "vendor-mermaid";
          if (id.includes("node_modules/dompurify")) return "vendor-dompurify";
          if (id.includes("node_modules/vega")) return "vendor-vega";
          if (id.includes("node_modules/exceljs")) return "vendor-exceljs";
          if (id.includes("node_modules/mammoth")) return "vendor-fileconvert";
          if (id.includes("node_modules/turndown")) return "vendor-fileconvert";
          if (id.includes("node_modules/diff/")) return "vendor-diff";
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    fs: {
      allow: [
        path.resolve("."), // cwd + subtree (includes node_modules)
        path.resolve("messages"),
        path.resolve("node_modules/@sveltejs/kit"),
      ],
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Ignore non-frontend paths to prevent CLI agent file operations
      // from triggering page reloads during active sessions.
      ignored: [
        "**/src-tauri/**",
        "**/node_modules/**",
        "**/.git/**",
        "**/build/**",
        "**/target/**",
        "**/apps/**",
        "**/packages/**",
        "**/.next/**",
        "**/dist/**",
        "**/.claude/**",
        "**/.miwarp/**",
        "**/.cursor/**",
        "**/tmp/**",
        "**/memory/**",
      ],
    },
  },
});
