/**
 * Bounded chunk assembly for fragmented WebSocket messages.
 *
 * Limits:
 * - Max active assemblies (prevents memory bomb from many incomplete messages)
 * - Max chunks per message
 * - Max total bytes per assembled message
 * - Per-message timeout (cleans up stale incomplete messages)
 *
 * Errors during assembly are logged and the message is discarded,
 * never propagated to the connection layer.
 */

import { dbg, dbgWarn } from "$lib/utils/debug";
import { systemTimers, type TimerApi } from "./timer-api";

interface ChunkBuffer {
  total: number;
  declaredBytes: number | null;
  parts: Map<number, string>;
  totalBytes: number;
  createdAt: number;
}

const textEncoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export interface ChunkAssemblerOptions {
  /** Max concurrent incomplete messages (default: 50) */
  maxActiveMessages?: number;
  /** Max chunks per message (default: 1000) */
  maxChunksPerMessage?: number;
  /** Max total bytes for assembled message (default: 10MB) */
  maxBytesPerMessage?: number;
  /** Timeout in ms for incomplete messages (default: 60000 = 60s) */
  messageTimeoutMs?: number;
  /** Cleanup interval in ms (default: 15000 = 15s) */
  cleanupIntervalMs?: number;
  /** Custom timer functions for testing */
  timers?: TimerApi;
  /** Monotonic-enough clock for expiry decisions */
  now?: () => number;
}

export class ChunkAssembler {
  private buffers = new Map<string, ChunkBuffer>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private readonly maxActiveMessages: number;
  private readonly maxChunksPerMessage: number;
  private readonly maxBytesPerMessage: number;
  private readonly messageTimeoutMs: number;
  private readonly timers: TimerApi;
  private readonly now: () => number;

  /** Called when a complete message is assembled */
  onComplete: ((assembled: string) => void) | null = null;

  constructor(options: ChunkAssemblerOptions = {}) {
    this.maxActiveMessages = options.maxActiveMessages ?? 50;
    this.maxChunksPerMessage = options.maxChunksPerMessage ?? 1000;
    this.maxBytesPerMessage = options.maxBytesPerMessage ?? 10 * 1024 * 1024;
    this.messageTimeoutMs = options.messageTimeoutMs ?? 60_000;
    this.timers = options.timers ?? systemTimers;
    this.now = options.now ?? Date.now;
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 15_000;

    this.cleanupTimer = this.timers.setInterval(() => this.cleanup(), cleanupIntervalMs);
  }

  get activeCount(): number {
    return this.buffers.size;
  }

  /**
   * Process a chunk control message. Returns true if handled (was a chunk message).
   * Returns false if not a chunk message (caller should handle normally).
   */
  handleMessage(msg: Record<string, unknown>): boolean {
    const type = msg.type;
    if (type === "chunk_begin") return this.handleChunkBegin(msg);
    if (type === "chunk") return this.handleChunk(msg);
    if (type === "chunk_end") return this.handleChunkEnd(msg);
    return false;
  }

  private handleChunkBegin(msg: Record<string, unknown>): boolean {
    const msgId = typeof msg.msg_id === "string" ? msg.msg_id : "";
    const total = typeof msg.total === "number" ? msg.total : 0;
    const declaredBytes = typeof msg.size === "number" ? msg.size : null;

    if (!msgId || total <= 0) {
      dbgWarn("transport", "chunk.invalidBegin", { msgId, total });
      return true;
    }

    if (total > this.maxChunksPerMessage) {
      dbgWarn("transport", "chunk.tooManyChunks", { msgId, total, max: this.maxChunksPerMessage });
      return true;
    }

    if (declaredBytes !== null && (declaredBytes < 0 || declaredBytes > this.maxBytesPerMessage)) {
      dbgWarn("transport", "chunk.declaredSizeRejected", {
        msgId,
        declaredBytes,
        max: this.maxBytesPerMessage,
      });
      return true;
    }

    if (this.buffers.has(msgId)) {
      dbgWarn("transport", "chunk.duplicateBegin", { msgId });
      return true;
    }

    if (this.buffers.size >= this.maxActiveMessages) {
      dbgWarn("transport", "chunk.tooManyActive", {
        active: this.buffers.size,
        max: this.maxActiveMessages,
      });
      // Drop the oldest buffer
      const oldest = this.buffers.keys().next().value;
      if (oldest) this.buffers.delete(oldest);
    }

    this.buffers.set(msgId, {
      total,
      declaredBytes,
      parts: new Map(),
      totalBytes: 0,
      createdAt: this.now(),
    });
    return true;
  }

  private handleChunk(msg: Record<string, unknown>): boolean {
    const msgId = typeof msg.msg_id === "string" ? msg.msg_id : "";
    const idx = typeof msg.idx === "number" ? msg.idx : -1;
    const data = typeof msg.data === "string" ? msg.data : "";

    if (!msgId || idx < 0) return true;

    const buffer = this.buffers.get(msgId);
    if (!buffer) {
      dbgWarn("transport", "chunk.orphanPart", { msgId, idx });
      return true;
    }

    // Duplicate index — skip
    if (buffer.parts.has(idx)) {
      dbg("transport", "chunk.duplicateIdx", { msgId, idx });
      return true;
    }

    // Out-of-range index
    if (idx >= buffer.total) {
      dbgWarn("transport", "chunk.outOfRange", { msgId, idx, total: buffer.total });
      return true;
    }

    // Size check
    const newSize = buffer.totalBytes + utf8ByteLength(data);
    if (newSize > this.maxBytesPerMessage) {
      dbgWarn("transport", "chunk.tooLarge", {
        msgId,
        bytes: newSize,
        max: this.maxBytesPerMessage,
      });
      this.buffers.delete(msgId);
      return true;
    }

    buffer.parts.set(idx, data);
    buffer.totalBytes = newSize;

    // Check if complete
    if (buffer.parts.size === buffer.total) {
      this.assembleAndDeliver(msgId, buffer);
    }

    return true;
  }

  private handleChunkEnd(msg: Record<string, unknown>): boolean {
    const msgId = typeof msg.msg_id === "string" ? msg.msg_id : "";
    if (!msgId) return true;

    const buffer = this.buffers.get(msgId);
    if (buffer) {
      // If we have all parts, assemble (chunk_end is just a signal)
      if (buffer.parts.size === buffer.total) {
        this.assembleAndDeliver(msgId, buffer);
      } else {
        dbgWarn("transport", "chunk.endIncomplete", {
          msgId,
          received: buffer.parts.size,
          expected: buffer.total,
        });
        this.buffers.delete(msgId);
      }
    }
    return true;
  }

  private assembleAndDeliver(msgId: string, buffer: ChunkBuffer): void {
    this.buffers.delete(msgId);
    try {
      const assembled = Array.from(buffer.parts.entries())
        .sort(([a], [b]) => a - b)
        .map(([, part]) => part)
        .join("");
      const actualBytes = utf8ByteLength(assembled);
      if (buffer.declaredBytes !== null && actualBytes !== buffer.declaredBytes) {
        dbgWarn("transport", "chunk.sizeMismatch", {
          msgId,
          declaredBytes: buffer.declaredBytes,
          actualBytes,
        });
        return;
      }
      this.onComplete?.(assembled);
    } catch (e) {
      dbgWarn("transport", "chunk.assemblyError", { msgId, error: e });
    }
  }

  /** Clean up stale incomplete messages */
  private cleanup(): void {
    const now = this.now();
    for (const [msgId, buffer] of this.buffers) {
      if (now - buffer.createdAt > this.messageTimeoutMs) {
        dbgWarn("transport", "chunk.timeout", {
          msgId,
          age: now - buffer.createdAt,
          received: buffer.parts.size,
          expected: buffer.total,
        });
        this.buffers.delete(msgId);
      }
    }
  }

  /** Clear all buffers (for disposal or reconnect) */
  clear(): void {
    this.buffers.clear();
  }

  dispose(): void {
    if (this.cleanupTimer !== null) {
      this.timers.clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buffers.clear();
    this.onComplete = null;
  }
}
