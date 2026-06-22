import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "src/lib"),
      $messages: path.resolve(__dirname, "messages"),
    },
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "scripts/architecture/__tests__/**/*.test.ts",
      "scripts/__tests__/**/*.test.ts",
      "e2e/__tests__/**/*.test.ts",
    ],
    environment: "node",
  },
});
