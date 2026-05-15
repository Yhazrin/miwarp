export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

let _toasts = $state<Toast[]>([]);
let _counter = 0;

export function getToasts(): Toast[] {
  return _toasts;
}

export function showToast(message: string, type: ToastType = "info", duration = 3500): string {
  const id = `toast-${++_counter}`;
  _toasts = [..._toasts, { id, message, type, duration }];
  return id;
}

export function dismissToast(id: string): void {
  _toasts = _toasts.filter((t) => t.id !== id);
}

export function clearAllToasts(): void {
  _toasts = [];
}
