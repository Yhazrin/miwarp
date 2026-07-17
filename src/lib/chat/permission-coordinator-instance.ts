/**
 * Singleton accessor for the page-level {@link PermissionCoordinator}.
 *
 * The coordinator must be a single instance per page (not per
 * component) so that the bounded retry ledger and listener set are
 * shared between PermissionPanel, InlineToolCard, and the chat page's
 * handlers. Tests instantiate their own; production uses this
 * singleton accessor.
 */
import { PermissionCoordinator } from "./permission-coordinator";

let singleton: PermissionCoordinator | null = null;

export function getPermissionCoordinator(): PermissionCoordinator {
  if (!singleton) singleton = new PermissionCoordinator();
  return singleton;
}

function resetPermissionCoordinatorForTest(): void {
  singleton?.dispose();
  singleton = null;
}
