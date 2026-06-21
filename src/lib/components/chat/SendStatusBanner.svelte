<script lang="ts">
  /**
   * Visible status banner for the desktop send path.
   *
   * Listens to a SendCoordinator and shows the user-visible state of the
   * current submit (submitting, accepted, queued, failed). When failed,
   * surfaces a Retry CTA that re-uses the captured draft. Replaces the
   * raw-error-string pattern with actionable localized text.
   */
  import type { SendCoordinator, SendStatusEvent, SendState } from "$lib/chat/send-coordinator";
  import { t as tFn } from "$lib/i18n/index.svelte";

  const t = tFn;

  type Tone = "warning" | "error" | "info";

  let {
    coordinator,
    onRetry,
  }: {
    coordinator: SendCoordinator;
    onRetry?: (event: SendStatusEvent) => void;
  } = $props();

  let current: SendStatusEvent | null = $state(null);
  let unsub: (() => void) | null = null;

  $effect(() => {
    unsub?.();
    unsub = coordinator.subscribe((event) => {
      current = event;
    });
    return () => {
      unsub?.();
      unsub = null;
    };
  });

  function getState(): SendState | null {
    return current ? current.state : null;
  }

  function getErrorCode(): string | undefined {
    return current?.error?.code;
  }

  const visible = $derived.by(() => {
    if (!current) return false;
    return current.state !== "accepted";
  });
  const tone: Tone = $derived.by(() => {
    const s = getState();
    if (s === "submitting" || s === "queued") return "info";
    if (s === "failed") {
      return getErrorCode() === "stale_identity" ? "warning" : "error";
    }
    return "info";
  });
  const label = $derived.by(() => {
    if (!current) return "";
    return bannerLabel(current, (k) => t(k as Parameters<typeof t>[0]));
  });
  const retryable = $derived.by(() => {
    if (!current) return false;
    return Boolean(current.error?.retryable);
  });

  function bannerLabel(event: SendStatusEvent, t: (k: string) => string): string {
    switch (event.state) {
      case "submitting":
        return t("send_status_submitting");
      case "queued":
        return t("send_status_queued");
      case "failed":
        return failureLabel(event, t);
      case "accepted":
        return t("send_status_accepted");
      default:
        return "";
    }
  }

  function failureLabel(event: SendStatusEvent, t: (k: string) => string): string {
    const code = event.error?.code ?? "unknown";
    switch (code) {
      case "transport_unavailable":
        return t("send_status_failed_transport");
      case "rejected":
        return t("send_status_failed_rejected");
      case "stale_identity":
        return t("send_status_failed_stale");
      case "timeout":
        return t("send_status_failed_timeout");
      default:
        return t("send_status_failed_unknown");
    }
  }

  function bannerClass(tone: Tone): string {
    if (tone === "warning") {
      return "border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.1)] text-miwarp-status-warning";
    }
    if (tone === "error") {
      return "border-[hsl(var(--miwarp-status-error)/0.3)] bg-[hsl(var(--miwarp-status-error)/0.1)] text-miwarp-status-error";
    }
    return "border-[hsl(var(--miwarp-status-info)/0.3)] bg-[hsl(var(--miwarp-status-info)/0.1)] text-miwarp-status-info";
  }
</script>

{#if visible}
  <div
    class={`pointer-events-auto mx-3 mb-2 flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-xs ${bannerClass(tone)}`}
    data-send-state={getState() ?? ""}
    data-send-code={getErrorCode() ?? ""}
    role="status"
    aria-live="polite"
  >
    <span class="truncate">{label}</span>
    {#if retryable && onRetry}
      <button
        type="button"
        class="shrink-0 rounded-md border border-current/40 px-2 py-0.5 text-xs font-medium transition hover:bg-current/10"
        onclick={() => onRetry?.(current!)}
      >
        {t("send_retry")}
      </button>
    {/if}
  </div>
{/if}
