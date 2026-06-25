import { describe, it, expect } from "vitest";
import { ScheduledTasksService } from "./scheduled-tasks-service";

describe("ScheduledTasksService.validateCronExpression", () => {
  it("accepts well-formed expressions", () => {
    expect(ScheduledTasksService.validateCronExpression("0 9 * * *")).toBe(true);
    expect(ScheduledTasksService.validateCronExpression("*/5 * * * *")).toBe(true);
    expect(ScheduledTasksService.validateCronExpression("00 09 * * 1-5")).toBe(true);
    expect(ScheduledTasksService.validateCronExpression("30 8 * * 1,3,5")).toBe(true);
  });

  it("rejects out-of-range fields with the per-field error key", () => {
    expect(ScheduledTasksService.cronFieldError("60 * * * *")).toBe("minute");
    expect(ScheduledTasksService.cronFieldError("0 24 * * *")).toBe("hour");
    expect(ScheduledTasksService.cronFieldError("0 0 32 * *")).toBe("day");
    expect(ScheduledTasksService.cronFieldError("0 0 * 13 *")).toBe("month");
    expect(ScheduledTasksService.cronFieldError("0 0 * * 7")).toBe("weekday");
  });

  it("rejects malformed shape", () => {
    expect(ScheduledTasksService.cronFieldError("not a cron")).toBe("shape");
    expect(ScheduledTasksService.cronFieldError("0 0 * *")).toBe("shape");
  });

  it("returns null for valid expressions", () => {
    expect(ScheduledTasksService.cronFieldError("0 9 * * *")).toBeNull();
    expect(ScheduledTasksService.cronFieldError("*/15 * * * *")).toBeNull();
  });
});
