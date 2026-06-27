import { describe, expect, it } from "vitest";
import {
  getPermissionStatusPresentation,
  getSendStatusPresentation,
  permissionStatusShellClass,
  sendFailureLabelKey,
  sendStatusLabelKey,
} from "../send-status-presentation";
import type { SendFailure, SendStatusEvent } from "../send-coordinator";

function failedEvent(code: SendFailure["code"], retryable = true): SendStatusEvent {
  return {
    state: "failed",
    runId: "run-1",
    clientMessageId: "msg-1",
    cause: "start",
    generation: 1,
    error: { code, message: "fail", retryable },
  };
}

describe("sendStatusLabelKey", () => {
  it("maps failed unknown to send_status_failed_unknown", () => {
    expect(sendStatusLabelKey(failedEvent("unknown"))).toBe("send_status_failed_unknown");
  });

  it("maps transport failures", () => {
    expect(sendFailureLabelKey(failedEvent("transport_unavailable"))).toBe(
      "send_status_failed_transport",
    );
  });
});

describe("getSendStatusPresentation", () => {
  it("hides accepted state", () => {
    const pres = getSendStatusPresentation({
      state: "accepted",
      runId: "run-1",
      clientMessageId: "msg-1",
      cause: "start",
      generation: 1,
    });
    expect(pres?.visible).toBe(false);
  });

  it("surfaces failed send with retry and error shell", () => {
    const pres = getSendStatusPresentation(failedEvent("unknown"));
    expect(pres?.visible).toBe(true);
    expect(pres?.labelKey).toBe("send_status_failed_unknown");
    expect(pres?.retryable).toBe(true);
    expect(pres?.shellClass).toBe("session-island-send-failed");
  });

  it("uses warning shell for stale identity", () => {
    const pres = getSendStatusPresentation(failedEvent("stale_identity", false));
    expect(pres?.shellClass).toBe("session-island-send-warning");
    expect(pres?.retryable).toBe(false);
  });
});

describe("permissionStatusShellClass", () => {
  it("maps tones onto the unified send-status shell tokens", () => {
    expect(permissionStatusShellClass("info")).toBe("session-island-send-pending");
    expect(permissionStatusShellClass("warning")).toBe("session-island-send-warning");
    expect(permissionStatusShellClass("error")).toBe("session-island-send-failed");
  });
});

describe("getPermissionStatusPresentation", () => {
  it("returns null when no input is provided", () => {
    expect(getPermissionStatusPresentation(null)).toBeNull();
  });

  it("forwards localized text and the matched shell class", () => {
    const pres = getPermissionStatusPresentation({
      text: "权限模式: 免审",
      tone: "info",
    });
    expect(pres?.visible).toBe(true);
    expect(pres?.text).toBe("权限模式: 免审");
    expect(pres?.tone).toBe("info");
    expect(pres?.shellClass).toBe("session-island-send-pending");
  });

  it("uses error shell for permission-failure notifications", () => {
    const pres = getPermissionStatusPresentation({
      text: "权限模式切换失败",
      tone: "error",
    });
    expect(pres?.shellClass).toBe("session-island-send-failed");
  });

  // Regression: pushPermissionStatus must not force `transient: false` or
  // the SessionStatusBar auto-dismiss timer never starts and the overlay
  // stays sticky ("权限模式: 计划" stays visible forever).
  it("defaults to auto-dismiss (transient) unless caller pins transient: false", () => {
    const transient = getPermissionStatusPresentation({
      text: "权限模式: 计划",
      tone: "info",
    });
    const sticky = getPermissionStatusPresentation({
      text: "stays",
      tone: "info",
      transient: false,
    });
    expect(transient).not.toBeNull();
    expect(sticky).not.toBeNull();
    // Presentation layer doesn't filter on `transient`; the caller's intent
    // must be preserved so the SessionStatusBar effect can branch on it.
    expect(transient?.visible).toBe(true);
    expect(sticky?.visible).toBe(true);
  });
});
