/**
 * Browser Runtime API — Tauri command wrappers.
 *
 * Mirrors `src-tauri/src/commands/browser_runtime.rs`. The store layer
 * (`src/lib/browser/browser-runtime-store.svelte.ts`) consumes these
 * functions rather than touching `getTransport()` directly so that we
 * have a single mocked / real boundary.
 */

import { getTransport } from "$lib/transport";
import { CMD } from "$lib/tauri-commands";

export type BrowserEngine = "chrome" | "webview";

export interface BrowserProfileDto {
  id: string;
  name: string;
  engine: string;
  dataDirectory: string;
  createdAt: string;
  lastUsedAt: string | null;
  allowedOrigins: string[];
}

export interface BrowserTabDto {
  targetId: string;
  url: string;
  title: string;
  attached: boolean;
}

export interface BrowserSessionDto {
  sessionId: string;
  profileId: string;
  engine: string;
  debuggingUrl: string;
  createdAt: string;
  tabs: BrowserTabDto[];
}

export interface ViewportDto {
  width: number;
  height: number;
}

export interface InteractiveElementDto {
  refId: string;
  role: string;
  name: string;
  bounds: [number, number, number, number];
}

export interface BrowserObservationDto {
  url: string;
  title: string;
  visibleText: string;
  screenshot: string | null;
  viewport: ViewportDto;
  interactiveElements: InteractiveElementDto[];
}

export type BrowserActionDto =
  | { type: "Click"; x: number; y: number }
  | { type: "Type"; text: string }
  | { type: "Scroll"; deltaX: number; deltaY: number }
  | { type: "Navigate"; url: string }
  | { type: "GoBack" }
  | { type: "GoForward" }
  | { type: "Refresh" }
  | { type: "Close" };

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}

// ── Profile ──────────────────────────────────────────────────────────────

export function listBrowserProfiles(): Promise<BrowserProfileDto[]> {
  return invoke<BrowserProfileDto[]>(CMD.browser_runtime_list_profiles);
}

export function createBrowserProfile(
  name: string,
  engine: BrowserEngine,
): Promise<BrowserProfileDto> {
  return invoke<BrowserProfileDto>(CMD.browser_runtime_create_profile, {
    name,
    engine,
  });
}

export function getBrowserProfile(profileId: string): Promise<BrowserProfileDto | null> {
  return invoke<BrowserProfileDto | null>(CMD.browser_runtime_get_profile, {
    profileId,
  });
}

export function deleteBrowserProfile(profileId: string): Promise<void> {
  return invoke<void>(CMD.browser_runtime_delete_profile, { profileId });
}

// ── Session ──────────────────────────────────────────────────────────────

export function launchBrowserProfile(
  profileId: string,
  runtimeName?: string,
): Promise<BrowserSessionDto> {
  return invoke<BrowserSessionDto>(CMD.browser_runtime_launch_profile, {
    profileId,
    runtimeName: runtimeName ?? null,
  });
}

export function listBrowserSessions(): Promise<BrowserSessionDto[]> {
  return invoke<BrowserSessionDto[]>(CMD.browser_runtime_list_sessions);
}

export function getBrowserSession(sessionId: string): Promise<BrowserSessionDto | null> {
  return invoke<BrowserSessionDto | null>(CMD.browser_runtime_get_session, {
    sessionId,
  });
}

export function listBrowserTabs(sessionId: string): Promise<BrowserTabDto[]> {
  return invoke<BrowserTabDto[]>(CMD.browser_runtime_list_tabs, { sessionId });
}

export function observeBrowserTab(
  sessionId: string,
  tabId: string,
): Promise<BrowserObservationDto> {
  return invoke<BrowserObservationDto>(CMD.browser_runtime_observe, {
    sessionId,
    tabId,
  });
}

export function navigateBrowserTab(sessionId: string, tabId: string, url: string): Promise<void> {
  return invoke<void>(CMD.browser_runtime_navigate, { sessionId, tabId, url });
}

export function performBrowserAction(
  sessionId: string,
  tabId: string,
  action: BrowserActionDto,
): Promise<void> {
  return invoke<void>(CMD.browser_runtime_perform, { sessionId, tabId, action });
}

export function closeBrowserSession(sessionId: string): Promise<void> {
  return invoke<void>(CMD.browser_runtime_close_session, { sessionId });
}

export function listBrowserRuntimes(): Promise<string[]> {
  return invoke<string[]>(CMD.browser_runtime_list_runtimes);
}
