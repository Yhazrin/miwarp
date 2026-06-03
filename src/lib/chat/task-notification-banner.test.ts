import { describe, expect, it } from "vitest";
import {
  getLatestTaskNotification,
  shouldShowTopTaskNotificationBanner,
} from "./task-notification-banner";
import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";

function item(
  task_id: string,
  status: string,
  startedAt: number,
): TaskNotificationItem {
  return { task_id, status, message: "", startedAt, data: null };
}

describe("task-notification-banner", () => {
  it("picks the notification with the latest startedAt", () => {
    const map = new Map<string, TaskNotificationItem>([
      ["a", item("a", "running", 100)],
      ["b", item("b", "stopped", 200)],
    ]);
    expect(getLatestTaskNotification(map)?.task_id).toBe("b");
  });

  it("does not show top banner for terminal stopped status", () => {
    expect(shouldShowTopTaskNotificationBanner(item("x", "stopped", 1))).toBe(false);
  });

  it("shows top banner for running status", () => {
    expect(shouldShowTopTaskNotificationBanner(item("x", "running", 1))).toBe(true);
  });
});
