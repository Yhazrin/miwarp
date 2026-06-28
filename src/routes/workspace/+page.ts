import { redirect } from "@sveltejs/kit";

/** Legacy /workspace bookmarks → project desk. */
export function load() {
  redirect(302, "/workbench");
}
