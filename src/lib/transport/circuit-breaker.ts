/**
 * Circuit Breaker pattern implementation for resilient transport operations.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is tripped, requests fail fast
 * - HALF_OPEN: Testing if service recovered
 *
 * Transitions:
 * - CLOSED -> OPEN: When failure count exceeds threshold
 * - OPEN -> HALF_OPEN: After recovery timeout
 * - HALF_OPEN -> CLOSED: On successful request
 * - HALF_OPEN -> OPEN: On failed request
 */
enum CircuitState {
  Closed = "closed",
  Open = "open",
  HalfOpen = "half_open",
}

interface CircuitBreakerOptions {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before trying again (default: 30000 = 30s) */
  recoveryTimeoutMs?: number;
  /** Successes in half-open needed to close (default: 1) */
  halfOpenSuccesses?: number;
  /** Filter which errors count toward opening (default: all) */
  shouldCountAsFailure?: (error: Error) => boolean;
  /** Optional name for debugging */
  name?: string;
}

class CircuitBreaker {
  private state = CircuitState.Closed;
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenSuccessCount = 0;

  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly halfOpenSuccesses: number;
  private readonly shouldCountAsFailure: (error: Error) => boolean;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 30_000;
    this.halfOpenSuccesses = options.halfOpenSuccesses ?? 1;
    this.shouldCountAsFailure = options.shouldCountAsFailure ?? (() => true);
    this.name = options.name ?? "circuit-breaker";
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Execute a function with circuit breaker protection.
   * Throws CircuitOpenError if circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.Open) {
      if (Date.now() - this.lastFailureTime >= this.recoveryTimeoutMs) {
        this.transitionTo(CircuitState.HalfOpen);
      } else {
        throw new CircuitOpenError(this.name, this.recoveryTimeoutMs);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (error instanceof CircuitOpenError) throw error;
      this.onFailure(error as Error);
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HalfOpen) {
      this.halfOpenSuccessCount++;
      if (this.halfOpenSuccessCount >= this.halfOpenSuccesses) {
        this.transitionTo(CircuitState.Closed);
      }
    } else if (this.state === CircuitState.Closed) {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  private onFailure(error: Error): void {
    if (!this.shouldCountAsFailure(error)) {
      return;
    }

    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === CircuitState.HalfOpen) {
      this.transitionTo(CircuitState.Open);
    } else if (this.state === CircuitState.Closed && this.failureCount >= this.failureThreshold) {
      this.transitionTo(CircuitState.Open);
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === CircuitState.Closed) {
      this.failureCount = 0;
      this.halfOpenSuccessCount = 0;
    } else if (newState === CircuitState.HalfOpen) {
      this.halfOpenSuccessCount = 0;
    } else if (newState === CircuitState.Open) {
      this.halfOpenSuccessCount = 0;
    }

    // Debug log via console for now (could integrate with dbg system)
    console.debug(`[circuit-breaker] ${this.name}: ${oldState} -> ${newState}`);
  }

  /** Reset circuit to closed state (for testing or manual reset) */
  reset(): void {
    this.transitionTo(CircuitState.Closed);
  }

  /** Force open the circuit (for maintenance or emergencies) */
  trip(): void {
    this.transitionTo(CircuitState.Open);
  }
}

class CircuitOpenError extends Error {
  readonly circuitName: string;
  readonly retryAfterMs: number;

  constructor(circuitName: string, retryAfterMs: number) {
    super(`Circuit '${circuitName}' is open. Retry after ${retryAfterMs}ms`);
    this.name = "CircuitOpenError";
    this.circuitName = circuitName;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Create a circuit breaker that filters out certain error types.
 * Network errors (timeout, connection refused) are counted as failures.
 * Client errors (400-499) are NOT counted.
 */
function createTransportCircuitBreaker(name: string): CircuitBreaker {
  return new CircuitBreaker({
    name,
    failureThreshold: 5,
    recoveryTimeoutMs: 30_000,
    halfOpenSuccesses: 1,
    shouldCountAsFailure: (error: Error) => {
      // Don't count client errors (4xx) as circuit-opening failures
      if (
        error.message.includes("4401") ||
        error.message.includes("403") ||
        error.message.includes("401")
      ) {
        return false;
      }
      // Don't count validation errors
      // Structured TransportError has a `code` field; fall back to message matching
      // for plain Error objects from the Tauri invoke layer.
      const errorCode = (error as { code?: string }).code;
      if (errorCode === "IPC_TIMEOUT" || error.message.includes("IPC_TIMEOUT")) {
        return true; // Timeout IS a failure
      }
      // Count connection errors
      if (errorCode === "CONNECTION_FAILED" || error.message.includes("WebSocket")) {
        return true;
      }
      // Count other transport errors
      return true;
    },
  });
}
