<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { DiagnosticsEvent, DiagnosticsSeverity } from "$lib/types/diagnostics";
  import { relativeTime } from "$lib/utils/format";

  let {
    events,
    selectedEventId,
    onSelect,
  }: {
    events: DiagnosticsEvent[];
    selectedEventId: string | null;
    onSelect: (id: string) => void;
  } = $props();

  const severityTone: Record<DiagnosticsSeverity, string> = {
    info: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    error: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    critical: "bg-rose-700/15 text-rose-700 dark:text-rose-200",
  };

  const severityKey: Record<DiagnosticsSeverity, MessageKey> = {
    info: "diagnostics_severity_info",
    warning: "diagnostics_severity_warning",
    error: "diagnostics_severity_error",
    critical: "diagnostics_severity_critical",
  };

  function moveSelection(delta: number): void {
    if (events.length === 0) return;
    const index = events.findIndex((event) => event.id === selectedEventId);
    const nextIndex =
      index < 0
        ? delta > 0
          ? 0
          : events.length - 1
        : (index + delta + events.length) % events.length;
    const target = events[nextIndex];
    if (target) onSelect(target.id);
  }

  function onListKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    }
  }
</script>

<div
  class="flex-1 overflow-y-auto"
  role="listbox"
  aria-label={t("diagnostics_trace_section")}
  tabindex="0"
  onkeydown={onListKeydown}
>
  {#if events.length === 0}
    <p class="px-4 py-6 text-xs text-muted-foreground">{t("diagnostics_trace_none")}</p>
  {:else}
    <ul class="divide-y divide-border">
      {#each events as event (event.id)}
        <li>
          <button
            type="button"
            class="flex w-full items-start justify-between gap-2 px-4 py-2 text-left text-xs transition-colors hover:bg-muted/40
              {selectedEventId === event.id ? 'bg-primary/5' : ''}"
            aria-current={selectedEventId === event.id ? "true" : undefined}
            aria-label={t("diagnostics_event_aria", { title: event.title })}
            onclick={() => onSelect(event.id)}
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-foreground">{event.title}</span>
              {#if event.detail}
                <span class="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {event.detail}
                </span>
              {/if}
            </span>
            <span class="flex shrink-0 items-center gap-1">
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-semibold {severityTone[
                  event.severity
                ]}"
              >
                {t(severityKey[event.severity])}
              </span>
              <span class="text-[10px] text-muted-foreground">{relativeTime(event.timestamp)}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
