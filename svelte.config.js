import path from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    alias: {
      $messages: path.resolve(__dirname, "messages"),
    },
    // Required for Tauri: absolute "/asset" URLs break after client-side routing.
    paths: {
      relative: true,
    },
  },
};

export default config;
