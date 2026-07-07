/**
 * Notification store — single-slot capsule notifications.
 *
 * v1.0.6 (Wave 4): collapsed the queue into one slot. New notifications
 * replace the current one with a status-color morph, matching the
 * session-island's start/end flash language. Rich payload supports a
 * primary message, optional description, an action button, and a
 * quiet/silent flag (sound opt-out).
 *
 * v1.1.1: listener pattern — the chat page registers a listener so
 * toasts are routed through the SessionStatusBar overlay instead of the
 * standalone ToastHost capsule. When no listener is registered (non-chat
 * pages) toasts are silently dropped (the SessionStatusBar IS the toast
 * surface now).
 */
import { playNotificationCue } from "$lib/utils/notification-cue";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  /** Primary message rendered as the capsule headline. */
  message: string;
  /** Optional secondary line shown beneath the headline. */
  description?: string;
  type: ToastType;
  /** Auto-dismiss delay in ms. 0 means sticky (no auto-dismiss). */
  duration: number;
  action?: ToastAction;
  /** When false, suppresses the optional sound cue (default true). */
  sound?: boolean;
}

const DEFAULT_DURATION_MS = 3500;

let _current = $state<Toast | null>(null);
let _counter = 0;
let _timer: ReturnType<typeof setTimeout> | null = null;

/** Listener registered by the chat page's SessionStatusBar. */
type ToastListener = (toast: Toast) => void;
let _listener: ToastListener | null = null;

export function registerToastListener(listener: ToastListener | null): void {
  _listener = listener;
}

export function getCurrentToast(): Toast | null {
  return _current;
}

function clearTimer(): void {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}

function isReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Replace any active toast with a new one. Returns the new toast id. */
export function showToast(
  message: string,
  type: ToastType = "info",
  duration: number = DEFAULT_DURATION_MS,
  options: { description?: string; action?: ToastAction; sound?: boolean } = {},
): string {
  clearTimer();
  _counter += 1;
  const id = `toast-${_counter}`;
  const soundEnabled = options.sound !== false;
  const toast: Toast = {
    id,
    message,
    description: options.description,
    type,
    duration,
    action: options.action,
    sound: soundEnabled,
  };
  _current = toast;

  // Route through SessionStatusBar listener when registered (chat page).
  if (_listener) {
    _listener(toast);
  }

  if (duration > 0) {
    _timer = setTimeout(() => {
      if (_current?.id === id) _current = null;
      _timer = null;
    }, duration);
  }
  if (soundEnabled && !isReducedMotion()) {
    void playNotificationCue(type);
  }
  return id;
}

export function dismissToast(): void {
  clearTimer();
  _current = null;
}

export function clearAllToasts(): void {
  clearTimer();
  _current = null;
}

/** @deprecated Use {@link getCurrentToast} — the store is now a single slot. */
export function getToasts(): Toast[] {
  return _current ? [_current] : [];
}
