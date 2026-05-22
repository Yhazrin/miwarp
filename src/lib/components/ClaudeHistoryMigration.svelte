<script lang="ts">
  import * as api from "$lib/api";
  import type { ExportReport, ImportReport, CliSessionInfo } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";
  import {
    pickClaudeHistoryExportPath,
    pickClaudeHistoryImportPath,
    notifyRunsChanged,
  } from "$lib/utils/claude-history-archive";

  let scannedSessions = $state<CliSessionInfo[]>([]);
  let isScanning = $state(false);
  let scanError = $state<string | null>(null);

  let isExporting = $state(false);
  let exportResult = $state<ExportReport | null>(null);
  let exportPath = $state<string | null>(null);
  let exportError = $state<string | null>(null);

  let isImporting = $state(false);
  let importResult = $state<ImportReport | null>(null);
  let importError = $state<string | null>(null);

  async function handleScan() {
    isScanning = true;
    scanError = null;
    scannedSessions = [];
    try {
      scannedSessions = await api.scanClaudeCodeHistory();
    } catch (e) {
      scanError = e instanceof Error ? e.message : String(e);
    } finally {
      isScanning = false;
    }
  }

  async function handleExport() {
    isExporting = true;
    exportError = null;
    exportResult = null;
    exportPath = null;
    try {
      const outputPath = await pickClaudeHistoryExportPath();
      if (!outputPath) {
        return;
      }
      exportPath = outputPath;
      exportResult = await api.exportClaudeCodeHistoryArchive(outputPath);
    } catch (e) {
      exportError = e instanceof Error ? e.message : String(e);
    } finally {
      isExporting = false;
    }
  }

  async function handleImport() {
    isImporting = true;
    importError = null;
    importResult = null;
    try {
      const archivePath = await pickClaudeHistoryImportPath();
      if (!archivePath) {
        return;
      }
      importResult = await api.importClaudeCodeHistoryArchive(archivePath);
      notifyRunsChanged();
      await handleScan();
    } catch (e) {
      importError = e instanceof Error ? e.message : String(e);
    } finally {
      isImporting = false;
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }
</script>

<Card class="p-6 space-y-4">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Claude Code History
      </h2>
      <p class="text-xs text-muted-foreground mt-1">
        Export and import Claude Code session history into MiWarp runs
      </p>
    </div>
  </div>

  <div class="flex gap-3 flex-wrap">
    <Button variant="secondary" onclick={handleScan} disabled={isScanning}>
      {#if isScanning}
        <span class="animate-spin mr-2">⟳</span>
      {/if}
      Scan
    </Button>

    <Button variant="secondary" onclick={handleExport} disabled={isExporting}>
      {#if isExporting}
        <span class="animate-spin mr-2">⟳</span>
      {/if}
      Export
    </Button>

    <Button variant="secondary" onclick={handleImport} disabled={isImporting}>
      {#if isImporting}
        <span class="animate-spin mr-2">⟳</span>
      {/if}
      Import
    </Button>
  </div>

  {#if scanError}
    <div class="rounded-md bg-red-500/10 border border-red-500/20 p-3">
      <p class="text-sm text-red-400">{scanError}</p>
    </div>
  {/if}

  {#if scannedSessions.length > 0}
    <div class="rounded-md bg-accent/50 border border-border p-3">
      <p class="text-sm font-medium">
        Found {scannedSessions.length} sessions
      </p>
      <div class="mt-2 max-h-40 overflow-y-auto space-y-1">
        {#each scannedSessions.slice(0, 10) as session}
          <div class="text-xs text-muted-foreground flex justify-between">
            <span class="truncate max-w-[200px]" title={session.sessionId}>
              {session.firstPrompt || session.sessionId}
            </span>
            <span class="shrink-0 ml-2">
              {#if session.alreadyImported}
                <span class="text-amber-400">imported</span>
              {:else}
                <span class="text-green-400">new</span>
              {/if}
            </span>
          </div>
        {/each}
        {#if scannedSessions.length > 10}
          <p class="text-xs text-muted-foreground">
            ... and {scannedSessions.length - 10} more
          </p>
        {/if}
      </div>
    </div>
  {/if}

  {#if exportError}
    <div class="rounded-md bg-red-500/10 border border-red-500/20 p-3">
      <p class="text-sm text-red-400">{exportError}</p>
    </div>
  {/if}

  {#if exportResult}
    <div class="rounded-md bg-green-500/10 border border-green-500/20 p-3">
      <p class="text-sm text-green-400 font-medium">Export complete</p>
      <div class="mt-2 text-xs text-muted-foreground space-y-1">
        {#if exportPath}
          <p class="break-all">Saved to: {exportPath}</p>
        {/if}
        <p>Sessions: {exportResult.sessionCount}</p>
        <p>Total size: {formatBytes(exportResult.totalBytes)}</p>
        {#if exportResult.failures.length > 0}
          <p class="text-amber-400">
            Failures: {exportResult.failures.length}
          </p>
        {/if}
      </div>
    </div>
  {/if}

  {#if importError}
    <div class="rounded-md bg-red-500/10 border border-red-500/20 p-3">
      <p class="text-sm text-red-400">{importError}</p>
    </div>
  {/if}

  {#if importResult}
    <div class="rounded-md bg-green-500/10 border border-green-500/20 p-3">
      <p class="text-sm text-green-400 font-medium">Import complete</p>
      <div class="mt-2 text-xs text-muted-foreground space-y-1">
        <p>Imported: {importResult.imported}</p>
        <p>Skipped: {importResult.skipped}</p>
        <p>Duplicates: {importResult.duplicates}</p>
        <p>Failed: {importResult.failed}</p>
        <p>Missing cwd: {importResult.missingCwd}</p>
      </div>
      {#if importResult.details.length > 0}
        <div class="mt-2 max-h-32 overflow-y-auto space-y-1">
          {#each importResult.details.slice(0, 12) as detail}
            <div class="text-xs flex justify-between gap-2">
              <span class="truncate" title={detail.sessionId}>{detail.sessionId}</span>
              <span class="shrink-0">{detail.status}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</Card>
