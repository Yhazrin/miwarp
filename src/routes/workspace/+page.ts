import { redirect } from "@sveltejs/kit";

/** Legacy /workspace bookmarks → chat page. */
export function load() {
  redirect(302, "/chat");
}
