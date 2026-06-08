<script lang="ts">
  /**
   * v1.0.6 follow-up: data + debug tab shell. Receives state via
   * props. History scan/export/import is delegated to the
   * orchestrator's callbacks. Debug card reads its own localStorage
   * for the filter; the orchestrator can pass a default.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { CliSessionInfo, ImportReport } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";

  let {
    scanningHistory = false,
    exportingHistory = false,
    importingHistory = false,
    scanResult = null as CliSessionInfo[] | null,
    importReport = null as ImportReport | null,
    historyError = null as string | null,
    onScanHistory = async () => {},
    onExportHistory = async () => {},
    onImportHistory = async () => {},
  }: {
    scanningHistory?: boolean;
    exportingHistory?: boolean;
    importingHistory?: boolean;
    scanResult?: CliSessionInfo[] | null;
    importReport?: ImportReport | null;
    historyError?: string | null;
    onScanHistory?: () => Promise<void>;
    onExportHistory?: () => Promise<void>;
    onImportHistory?: () => Promise<void>;
  } = $props();
  function lk(key: string): string {
    return t(key as MessageKey);
  }
  function lkp(key: string, params: Record<string, string>): string {
    return t(key as MessageKey, params);
  }
</script>

<div class="space-y-6">
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {lk("settings_data_claude_code_history")}
    </h2>
    <p class="text-sm text-muted-foreground">
      {lk("settings_data_claude_code_history_desc")}
    </p>
    <p class="text-xs text-muted-foreground/80">{lk("settings_data_readonly_note")}</p>

    <div class="flex flex-wrap gap-2">
      <Button variant="secondary" onclick={onScanHistory} disabled={scanningHistory}>
        {scanningHistory ? lk("settings_data_scanning") : lk("settings_data_scan")}
      </Button>
    </div>

    {#if scanResult}
      <div class="text-sm text-muted-foreground">
        {lk("settings_data_found")}
        {scanResult.length}
        {lk("settings_data_sessions")}
      </div>
    {/if}

    {#if scanResult && scanResult.length > 0}
      <div class="max-h-64 overflow-y-auto border rounded-md">
        {#each scanResult as session (session.sessionId)}
          <div class="flex items-center justify-between px-3 py-2 border-b last:border-b-0">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">
                {session.firstPrompt || session.sessionId}
              </div>
              <div class="text-xs text-muted-foreground truncate">{session.cwd}</div>
              <div class="text-xs text-muted-foreground">
                {lkp("settings_data_messageCount", { count: String(session.messageCount) })}
                {#if session.model}· {session.model}{/if}
              </div>
            </div>
            <div class="ml-2 text-xs">
              {#if session.alreadyImported}
                <span class="text-miwarp-status-success">{lk("settings_data_imported")}</span>
              {:else}
                <span class="text-muted-foreground">{lk("settings_data_not_imported")}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex flex-wrap gap-2 pt-2 border-t">
      <Button variant="secondary" onclick={onExportHistory} disabled={exportingHistory}>
        {exportingHistory ? lk("settings_data_exporting") : lk("settings_data_export")}
      </Button>
    </div>

    <div class="flex flex-wrap gap-2 pt-2 border-t">
      <Button variant="secondary" onclick={onImportHistory} disabled={importingHistory}>
        {importingHistory ? lk("settings_data_importing") : lk("settings_data_import")}
      </Button>
    </div>

    {#if importReport}
      <div class="mt-4 p-3 bg-muted rounded-md text-sm">
        <div class="font-medium mb-1">{lk("settings_data_import_report")}</div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span>{lk("settings_data_imported_count")}:</span>
          <span class="text-miwarp-status-success">{importReport.imported}</span>
          <span>{lk("settings_data_duplicates")}:</span>
          <span class="text-miwarp-status-warning">{importReport.duplicates}</span>
          <span>{lk("settings_data_skipped")}:</span>
          <span class="text-miwarp-status-warning">{importReport.skipped}</span>
          <span>{lk("settings_data_failed")}:</span>
          <span class="text-miwarp-status-error">{importReport.failed}</span>
        </div>
      </div>
    {/if}

    {#if historyError}
      <div
        class="p-3 bg-[hsl(var(--miwarp-status-error)/0.1)] border border-[hsl(var(--miwarp-status-error)/0.3)] rounded-md text-sm text-miwarp-status-error"
      >
        {historyError}
      </div>
    {/if}
  </Card>
</div>
