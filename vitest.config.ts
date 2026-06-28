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
    // Force browser conditions so `import { mount } from "svelte"` resolves
    // to the client build (mount() exists) rather than the server stub
    // (which throws `lifecycle_function_unavailable`). The default Vite SSR
    // resolution otherwise picks `svelte/src/index-server.js`.
    conditions: ["browser"],
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "scripts/architecture/__tests__/**/*.test.ts",
      "scripts/__tests__/**/*.test.ts",
      "e2e/__tests__/**/*.test.ts",
    ],
    environment: "node",
    // Same conditions need to apply during dependency optimisation / SSR-style
    // module resolution performed by Vitest's vite pipeline.
    server: {
      deps: {
        inline: ["svelte"],
      },
    },
  },
});
