import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      $messages: path.resolve("./messages"),
    },
  },
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
