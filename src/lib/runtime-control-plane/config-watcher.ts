import { getTransport } from "$lib/transport";
import type { RuntimeConfigWatchEvent } from "./types";

const DEBOUNCE_MS = 400;

export type ConfigWatchListener = (event: RuntimeConfigWatchEvent) => void;

export class RuntimeConfigWatcher {
  private generation = 0;
  private listener: ConfigWatchListener | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private unlisten: (() => void) | null = null;
  private disposed = false;

  async start(runtimeId: string, listener: ConfigWatchListener): Promise<void> {
    this.dispose();
    this.listener = listener;
    this.disposed = false;
    const transport = getTransport();
    this.unlisten = await transport.listen<{
      event: RuntimeConfigWatchEvent;
    }>("runtime-config-changed", (payload) => {
      if (payload.event.runtimeId !== runtimeId) return;
      this.schedule(runtimeId, payload.event);
    });
    this.generation = await transport.invoke<number>("runtime_hub_start_config_watch", {
      runtimeId,
    });
  }

  private schedule(runtimeId: string, incoming: RuntimeConfigWatchEvent): void {
    if (this.disposed) return;
    const expectedGen = incoming.generation;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      if (this.disposed || expectedGen < this.generation) return;
      this.listener?.({
        ...incoming,
        runtimeId,
        reason: "debounced_config_changed",
      });
    }, DEBOUNCE_MS);
  }

  async stop(runtimeId: string): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.unlisten?.();
    this.unlisten = null;
    this.listener = null;
    await getTransport().invoke("runtime_hub_stop_config_watch", { runtimeId });
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.unlisten?.();
    this.unlisten = null;
    this.listener = null;
  }
}
