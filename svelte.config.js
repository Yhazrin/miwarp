import adapter from "@sveltejs/adapter-static";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    paths: {
      relative: false,
    },
    alias: {
      $messages: path.resolve(__dirname, "messages"),
    },
  },
};

export default config;
