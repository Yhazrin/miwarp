/**
 * PhaseProcessor - Multi-phase task execution engine
 *
 * Based on Codex Claude Cowork design patterns.
 * Enables handling of complex multi-phase tasks like memory consolidation.
 *
 * Usage:
 * ```typescript
 * const processor = new PhaseProcessor([phase1, phase2, phase3]);
 * const results = await processor.run(context);
 * ```
 */

export interface PhaseContext {
  abort?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PhaseResult {
  phaseId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface Phase {
  /** Unique identifier for this phase */
  id: string;
  /** Human-readable name */
  name: string;
  /** Brief description shown in UI */
  description: string;
  /** Execute the phase logic */
  execute: (ctx: PhaseContext) => Promise<PhaseResult>;
  /** Optional dry-run simulation */
  dryRun?: (ctx: PhaseContext) => Promise<PhaseResult>;
}

export interface PhaseProcessorOptions {
  /** Continue on phase error (default: false) */
  continueOnError?: boolean;
  /** Abort signal */
  signal?: AbortSignal;
}

export class PhaseProcessor {
  private phases: Phase[];
  private currentIndex = 0;
  private results: PhaseResult[] = [];

  constructor(phases: Phase[]) {
    this.phases = phases;
  }

  /**
   * Run all phases sequentially
   */
  async run(ctx: PhaseContext, options?: PhaseProcessorOptions): Promise<PhaseResult[]> {
    this.results = [];
    this.currentIndex = 0;

    const continueOnError = options?.continueOnError ?? false;

    // Handle abort signal
    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        ctx.abort = true;
      });
    }

    for (let i = 0; i < this.phases.length; i++) {
      this.currentIndex = i;
      const phase = this.phases[i];

      // Check for abort
      if (ctx.abort) {
        this.results.push({
          phaseId: phase.id,
          success: false,
          error: "Aborted by user",
          durationMs: 0,
        });
        break;
      }

      const startTime = Date.now();

      try {
        if (options?.signal?.aborted) {
          ctx.abort = true;
        }

        const result = await phase.execute(ctx);
        result.durationMs = Date.now() - startTime;
        this.results.push(result);

        if (!result.success && !continueOnError) {
          break;
        }
      } catch (error) {
        this.results.push({
          phaseId: phase.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        });

        if (!continueOnError) {
          break;
        }
      }
    }

    return this.results;
  }

  /**
   * Run phases in dry-run mode
   */
  async dryRun(ctx: PhaseContext): Promise<PhaseResult[]> {
    this.results = [];
    this.currentIndex = 0;

    for (const phase of this.phases) {
      const startTime = Date.now();

      if (phase.dryRun) {
        const result = await phase.dryRun(ctx);
        result.durationMs = Date.now() - startTime;
        this.results.push(result);
      } else {
        this.results.push({
          phaseId: phase.id,
          success: true,
          output: `Dry-run for "${phase.name}": would execute but no dryRun defined`,
          durationMs: Date.now() - startTime,
        });
      }
    }

    return this.results;
  }

  /**
   * Get current progress (0-100)
   */
  getProgress(): number {
    if (this.phases.length === 0) return 100;
    return Math.round((this.currentIndex / this.phases.length) * 100);
  }

  /**
   * Get current phase info
   */
  getCurrentPhase(): Phase | null {
    return this.phases[this.currentIndex] ?? null;
  }

  /**
   * Check if can resume (not all phases executed)
   */
  canResume(): boolean {
    return this.currentIndex < this.phases.length - 1;
  }

  /**
   * Get all results
   */
  getResults(): PhaseResult[] {
    return [...this.results];
  }

  /**
   * Get success status
   */
  isSuccess(): boolean {
    return this.results.every((r) => r.success);
  }
}

/**
 * Create a simple phase-based task
 */
export function createPhases(config: {
  phases: Array<{
    id: string;
    name: string;
    description: string;
    fn: (ctx: PhaseContext) => Promise<unknown>;
  }>;
}): PhaseProcessor {
  return new PhaseProcessor(
    config.phases.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      execute: async (ctx) => {
        const startTime = Date.now();
        try {
          const output = await p.fn(ctx);
          return {
            phaseId: p.id,
            success: true,
            output,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            phaseId: p.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startTime,
          };
        }
      },
    })),
  );
}
