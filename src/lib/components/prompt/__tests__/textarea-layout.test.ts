import { describe, expect, it } from "vitest";
import {
  CAPSULE_LINE_HEIGHT_PX,
  MAX_COMPOSER_CONTENT_HEIGHT_PX,
  resolveTextareaLayout,
} from "../textarea-layout";

describe("resolveTextareaLayout", () => {
  it("keeps a one-line draft in the capsule", () => {
    expect(
      resolveTextareaLayout({
        contentHeight: CAPSULE_LINE_HEIGHT_PX,
        hasNewline: false,
        hasText: true,
        isExpanded: false,
        pendingPermission: false,
      }),
    ).toEqual({ expanded: false, contentHeight: CAPSULE_LINE_HEIGHT_PX });
  });

  it("expands immediately once normal typing wraps", () => {
    expect(
      resolveTextareaLayout({
        contentHeight: CAPSULE_LINE_HEIGHT_PX * 2,
        hasNewline: false,
        hasText: true,
        isExpanded: false,
        pendingPermission: false,
      }),
    ).toEqual({ expanded: true, contentHeight: CAPSULE_LINE_HEIGHT_PX * 2 });
  });

  it("does not collapse a wrapped draft after the wider composer reflows it", () => {
    expect(
      resolveTextareaLayout({
        contentHeight: CAPSULE_LINE_HEIGHT_PX,
        hasNewline: false,
        hasText: true,
        isExpanded: true,
        pendingPermission: false,
      }),
    ).toEqual({ expanded: true, contentHeight: CAPSULE_LINE_HEIGHT_PX });
  });

  it("collapses after the draft is cleared and clamps tall content", () => {
    expect(
      resolveTextareaLayout({
        contentHeight: CAPSULE_LINE_HEIGHT_PX * 9,
        hasNewline: false,
        hasText: true,
        isExpanded: true,
        pendingPermission: false,
      }).contentHeight,
    ).toBe(MAX_COMPOSER_CONTENT_HEIGHT_PX);

    expect(
      resolveTextareaLayout({
        contentHeight: 0,
        hasNewline: false,
        hasText: false,
        isExpanded: true,
        pendingPermission: false,
      }),
    ).toEqual({ expanded: false, contentHeight: CAPSULE_LINE_HEIGHT_PX });
  });
});
