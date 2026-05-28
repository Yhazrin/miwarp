export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: ToastAction;
}

let _toasts = $state<Toast[]>([]);
let _counter = 0;

export function getToasts(): Toast[] {
  return _toasts;
}

export function showToast(
  message: string,
  type: ToastType = "info",
  duration = 3500,
  action?: ToastAction,
): string {
  const id = `toast-${++_counter}`;
  _toasts = [..._toasts, { id, message, type, duration, action }];
  return id;
}

export function dismissToast(id: string): void {
  _toasts = _toasts.filter((t) => t.id !== id);
}

export function clearAllToasts(): void {
  _toasts = [];
}
