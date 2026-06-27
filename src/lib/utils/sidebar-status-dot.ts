/** Status dot colors tuned for sidebar glass (readable in dark + light). */
export type SidebarStatusDot = { color: string; animated: boolean };

export function getSidebarStatusDot(status: string): SidebarStatusDot {
  if (status === "running" || status === "waiting_input" || status === "waiting_approval") {
    return { color: "hsl(var(--miwarp-status-info))", animated: true };
  }
  if (status === "completed") {
    return { color: "hsl(var(--miwarp-status-success))", animated: false };
  }
  if (status === "error") {
    return { color: "hsl(var(--miwarp-status-error))", animated: false };
  }
  if (status === "stopped") {
    return { color: "hsl(var(--sidebar-foreground) / 0.42)", animated: false };
  }
  return { color: "hsl(var(--sidebar-foreground) / 0.34)", animated: false };
}
