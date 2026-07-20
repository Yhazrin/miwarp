/**
 * Single owner for async session load / resume / fork / reload generation
 * and mount lifetime. Shared by SessionStore.loadRun, resumeSession, fork,
 * and recoverFromEventLog → loadRun.
 *
 * Invariants:
 * - Each beginLoad / beginResume bumps generation and invalidates prior async work.
 * - isStale(captured) is true after unmount, invalidate, or a newer begin*.
 * - beginResume is single-flight (returns null when resume already in progress).
 */
export class SessionAsyncLifecycleCoordinator {
  private generation = 0;
  private mounted = true;
  private resumeBusy = false;

  get currentGeneration(): number {
    return this.generation;
  }

  get isMounted(): boolean {
    return this.mounted;
  }

  get resumeInFlight(): boolean {
    return this.resumeBusy;
  }

  /** Invalidate in-flight async work without starting a named op (e.g. reset). */
  invalidate(): number {
    this.generation += 1;
    return this.generation;
  }

  /** loadRun, reload, recoverFromEventLog → loadRun. */
  beginLoad(): number | null {
    if (!this.mounted) return null;
    return this.invalidate();
  }

  /**
   * resumeSession / fork step 1. Returns null when resume is already in flight.
   * Also invalidates concurrent loadRun work.
   */
  beginResume(): number | null {
    if (!this.mounted || this.resumeBusy) return null;
    this.resumeBusy = true;
    return this.invalidate();
  }

  endResume(): void {
    this.resumeBusy = false;
  }

  /**
   * True when `capturedGeneration` is outdated or the store was unmounted.
   * Use after every await in load/resume/fork/reload paths.
   */
  isStale(capturedGeneration: number): boolean {
    return !this.mounted || capturedGeneration !== this.generation;
  }

  /** Predicate for applyEventBatchAsync isStale option. */
  stalePredicate(capturedGeneration: number): () => boolean {
    return () => this.isStale(capturedGeneration);
  }

  /**
   * Page mount: allow the shared SessionStore to accept work again.
   *
   * The store outlives the chat page, so `unmount()` cannot be terminal for
   * the coordinator itself. Bump the generation when reactivating to keep all
   * work captured by the previous page instance stale.
   */
  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.resumeBusy = false;
    this.invalidate();
  }

  /**
   * Page teardown: block future writes and invalidate all in-flight ops.
   * Clears resume single-flight so a later page mount can resume.
   */
  unmount(): void {
    this.mounted = false;
    this.resumeBusy = false;
    this.invalidate();
  }
}
