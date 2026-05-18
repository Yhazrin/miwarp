import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    target: ["safari16", "chrome105", "edge105"],
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer"))
            return "codemirror-vendor";
          if (id.includes("node_modules/@xterm")) return "xterm-vendor";
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // WKWebView caches dev responses aggressively; stale index.html → old chunk hashes → 404 +
    // "Importing a module script failed" until cache is cleared.
    headers: {
      "Cache-Control": "no-store",
    },
    fs: {
      allow: [".", "messages"],
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
        "**/tmp/**",
        "**/memory/**",
      ],
    },
  },
});
