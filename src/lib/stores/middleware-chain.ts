/**
 * Middleware chain pattern for extensibility.
 *
 * Allows plugins to register middleware that processes events with priority ordering.
 * Supports before/after hooks for pre-processing and post-processing.
 *
 * Usage:
 * ```ts
 * const chain = new MiddlewareChain<MyEvent>();
 * chain.register({ priority: 100, name: "logger", before: logEvent });
 * chain.register({ priority: 50, name: "transformer", before: transformEvent });
 * await chain.process(event); // Lower priority runs first (50 before 100)
 * ```
 */

export interface MiddlewareContext {
  /** Unique identifier for the current processing run */
  runId?: string;
  /** Additional context metadata */
  metadata?: Record<string, unknown>;
}

export interface MiddlewareHandler<T> {
  /** Before hook - runs before the event is processed.
   * Return modified event to continue, or null to short-circuit.
   * Can return a Promise for async operations. */
  before?: (event: T, ctx: MiddlewareContext) => T | Promise<T | null>;
  /** Main handler - the core event processing logic.
   * Return modified event to continue, or null to short-circuit. */
  handler: (event: T, ctx: MiddlewareContext) => T | Promise<T | null>;
  /** After hook - runs after the event is processed.
   * Can be used for logging, metrics, etc. */
  after?: (event: T, ctx: MiddlewareContext) => void | Promise<void>;
  /** Priority - lower numbers run first (default: 0).
   * Middleware with same priority maintain insertion order. */
  priority?: number;
  /** Unique name for debugging */
  name: string;
  /** Whether to continue on error (default: true) */
  continueOnError?: boolean;
}

export interface MiddlewareRegistration<T> {
  /** Unique identifier */
  id: string;
  /** Middleware handler */
  middleware: MiddlewareHandler<T>;
  /** Priority for ordering */
  priority: number;
  /** Name for debugging */
  name: string;
  /** Whether middleware is active */
  enabled: boolean;
}

/**
 * Ordered chain of middleware with before/handler/after hooks.
 */
export class MiddlewareChain<T> {
  private _middleware: MiddlewareRegistration<T>[] = [];
  private _sorted = true;

  /**
   * Register a middleware handler.
   * @param middleware - The middleware to register
   * @returns A function to unregister the middleware
   */
  register(middleware: MiddlewareHandler<T>): () => void {
    const id = `middleware_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const registration: MiddlewareRegistration<T> = {
      id,
      middleware,
      priority: middleware.priority ?? 0,
      name: middleware.name,
      enabled: true,
    };

    this._middleware.push(registration);
    this._sorted = false;
    return () => this.unregister(id);
  }

  /**
   * Register a middleware with explicit ID for easier management.
   */
  registerWithId(id: string, middleware: MiddlewareHandler<T>): () => void {
    // Check for duplicate ID
    if (this._middleware.some((m) => m.id === id)) {
      console.warn(`[middleware-chain] duplicate ID: ${id}`);
    }

    const registration: MiddlewareRegistration<T> = {
      id,
      middleware,
      priority: middleware.priority ?? 0,
      name: middleware.name,
      enabled: true,
    };

    this._middleware.push(registration);
    this._sorted = false;
    return () => this.unregister(id);
  }

  /**
   * Unregister a middleware by ID.
   */
  unregister(id: string): boolean {
    const idx = this._middleware.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    this._middleware.splice(idx, 1);
    return true;
  }

  /**
   * Enable or disable a middleware by name.
   */
  setEnabled(name: string, enabled: boolean): void {
    const reg = this._middleware.find((m) => m.name === name);
    if (reg) reg.enabled = enabled;
  }

  /**
   * Get all registered middleware.
   */
  getMiddleware(): ReadonlyArray<MiddlewareRegistration<T>> {
    this._sortIfNeeded();
    return [...this._middleware];
  }

  /**
   * Check if a middleware is registered.
   */
  has(name: string): boolean {
    return this._middleware.some((m) => m.name === name);
  }

  /**
   * Process an event through all middleware.
   * Middleware are sorted by priority (lower first), then processed in order.
   */
  async process(event: T, ctx: MiddlewareContext = {}): Promise<T | null> {
    this._sortIfNeeded();

    let currentEvent: T | null = event;

    for (const reg of this._middleware) {
      if (!reg.enabled) continue;

      const m = reg.middleware;

      try {
        // Before hook
        if (m.before) {
          currentEvent = await m.before(currentEvent as T, ctx);
          if (currentEvent === null) {
            // Short-circuited
            return null;
          }
        }

        // Main handler
        if (m.handler) {
          currentEvent = await m.handler(currentEvent as T, ctx);
          if (currentEvent === null) {
            // Short-circuited
            return null;
          }
        }

        // After hook (fire and forget for async)
        if (m.after) {
          const result = m.after(currentEvent as T, ctx);
          // Don't await - after hooks are for side effects
          if (result instanceof Promise) {
            result.catch((e) => {
              console.error(`[middleware] ${reg.name} after hook failed:`, e);
            });
          }
        }
      } catch (error) {
        if (m.continueOnError !== false) {
          console.error(`[middleware] ${reg.name} error:`, error);
          continue;
        }
        throw error;
      }
    }

    return currentEvent;
  }

  /**
   * Process synchronously (no async support).
   * Use this for middleware that don't need async operations.
   */
  processSync(event: T, ctx: MiddlewareContext = {}): T | null {
    this._sortIfNeeded();

    let currentEvent: T | null = event;

    for (const reg of this._middleware) {
      if (!reg.enabled) continue;

      const m = reg.middleware;

      try {
        // Before hook
        if (m.before) {
          currentEvent = m.before(currentEvent as T, ctx) as T | null;
          if (currentEvent === null) return null;
        }

        // Main handler
        if (m.handler) {
          currentEvent = m.handler(currentEvent as T, ctx) as T | null;
          if (currentEvent === null) return null;
        }

        // After hook (sync only)
        if (m.after) {
          try {
            m.after(currentEvent as T, ctx);
          } catch (e) {
            console.error(`[middleware] ${reg.name} after hook failed:`, e);
          }
        }
      } catch (error) {
        if (m.continueOnError !== false) {
          console.error(`[middleware] ${reg.name} error:`, error);
          continue;
        }
        throw error;
      }
    }

    return currentEvent;
  }

  private _sortIfNeeded(): void {
    if (this._sorted) return;
    this._middleware.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Maintain insertion order for same priority
      return 0;
    });
    this._sorted = true;
  }

  /** Clear all middleware */
  clear(): void {
    this._middleware = [];
    this._sorted = true;
  }

  /** Get count of registered middleware */
  get size(): number {
    return this._middleware.length;
  }
}

/**
 * Create a middleware that filters events based on a predicate.
 */
export function createFilterMiddleware<T>(
  name: string,
  predicate: (event: T) => boolean,
  priority = 0,
): MiddlewareHandler<T> {
  return {
    name,
    priority,
    handler: (event) => {
      if (predicate(event)) return event;
      return null; // Filter out
    },
  };
}

/**
 * Create a middleware that transforms events.
 */
export function createTransformMiddleware<T>(
  name: string,
  transform: (event: T) => T,
  priority = 0,
): MiddlewareHandler<T> {
  return {
    name,
    priority,
    handler: (event) => transform(event),
  };
}

/**
 * Create a middleware that logs events.
 */
export function createLoggingMiddleware<T>(
  name: string,
  logFn: (event: T, ctx: MiddlewareContext) => void,
  priority = -1000, // Run early
): MiddlewareHandler<T> {
  return {
    name,
    priority,
    handler: (event) => event, // Pass through
    after: (event, ctx) => logFn(event, ctx),
  };
}

/**
 * Create a middleware that adds delay (for rate limiting).
 */
export function createDelayMiddleware<T>(
  name: string,
  delayMs: number,
  priority = 0,
): MiddlewareHandler<T> {
  return {
    name,
    priority,
    async handler(event) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return event;
    },
  };
}

/**
 * Create a middleware that caches results.
 */
export function createCachingMiddleware<T, R>(
  name: string,
  computeKey: (event: T) => string,
  computeResult: (event: T) => R,
  cache: Map<string, R>,
  ttlMs = 5000,
  priority = 0,
): MiddlewareHandler<T> {
  const timestamps = new Map<string, number>();

  return {
    name,
    priority,
    handler: (event) => {
      const key = computeKey(event);
      const cached = cache.get(key);
      const timestamp = timestamps.get(key);

      if (cached !== undefined && timestamp !== undefined) {
        if (Date.now() - timestamp < ttlMs) {
          return cached as unknown as T; // Cast back to T, caller handles type mismatch
        }
        cache.delete(key);
        timestamps.delete(key);
      }

      const result = computeResult(event);
      cache.set(key, result);
      timestamps.set(key, Date.now());
      return result as unknown as T;
    },
  };
}

/**
 * Priority constants for common middleware.
 */
export const MiddlewarePriority = {
  /** Very high - critical path, error handling */
  Critical: -1000,
  /** High - logging, metrics */
  High: -500,
  /** Default */
  Normal: 0,
  /** Low - caching, non-essential */
  Low: 500,
  /** Very low - cleanup */
  Cleanup: 1000,
} as const;
