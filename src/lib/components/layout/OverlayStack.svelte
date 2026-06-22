<script lang="ts">
  /**
   * OverlayStack — host for the 4 rarely-shown overlays that used to be
   * `{#if}`-gated inline in `src/routes/+layout.svelte`. Each overlay is only
   * mounted while its flag is truthy, and its underlying component is
   * dynamically imported on first open so the heavy chunks (CommandPalette,
   * SetupWizard, CliSessionBrowser, FolderPicker) are NOT pulled into the
   * root-layout's eager preload graph.
   */
  import type { Component } from "svelte";
  import { fade } from "svelte/transition";
  import { dbgWarn } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";

  // Loosely typed so each child component can keep its own strict $$Props type.
  // The call sites below pass the matching prop set, and any mismatch is
  // caught by svelte-check on the `<C />` instantiation (not the loader).
  type OverlayComponent = Component<any>;

  let {
    commandPaletteOpen = $bindable(false),
    commandPaletteCwd = "/",
    onOpenFolderBrowser,
    showSetupWizard = false,
    onSetupComplete,
    folderPickerOpen = $bindable(false),
    folderPickerInitialHost = null as string | null,
    folderPickerInitialPath = "",
    onFolderPicked,
    showCliBrowser = false,
    onCliBrowserClose,
    onCliBrowserImported,
  }: {
    commandPaletteOpen?: boolean;
    commandPaletteCwd?: string;
    onOpenFolderBrowser?: () => void;
    showSetupWizard?: boolean;
    onSetupComplete?: () => void;
    folderPickerOpen?: boolean;
    folderPickerInitialHost?: string | null;
    folderPickerInitialPath?: string;
    onFolderPicked?: (result: { hostName: string | null; path: string }) => void;
    showCliBrowser?: boolean;
    onCliBrowserClose?: () => void;
    onCliBrowserImported?: (runId: string) => void;
  } = $props();

  // Per-overlay dynamic state. Each slot holds:
  //   Component: the loaded Svelte component constructor, null until import resolves
  //   loading:   true while the first import is in flight
  //   error:     human-readable error from a failed import
  // A single in-flight promise is cached so multiple open/close toggles do not
  // stack concurrent imports.
  type Slot = {
    Component: OverlayComponent | null;
    loading: boolean;
    error: string | null;
    ensure: () => Promise<void>;
  };

  function makeSlot(loader: () => Promise<{ default: OverlayComponent }>, label: string): Slot {
    let Component = $state<OverlayComponent | null>(null);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let inFlight: Promise<void> | null = null;

    async function ensure(): Promise<void> {
      if (Component || inFlight) return inFlight ?? Promise.resolve();
      loading = true;
      error = null;
      const promise = (async () => {
        try {
          const mod = await loader();
          Component = mod.default;
        } catch (err) {
          dbgWarn("layout", `overlay import failed: ${label}`, err);
          error = err instanceof Error ? err.message : String(err);
          Component = null;
        } finally {
          loading = false;
          inFlight = null;
        }
      })();
      inFlight = promise;
      return promise;
    }

    return {
      get Component() {
        return Component;
      },
      get loading() {
        return loading;
      },
      get error() {
        return error;
      },
      ensure,
    };
  }

  // Loaders. Each is intentionally a separate dynamic import so the
  // corresponding chunk (and its transitive dependencies) is fetched on first
  // open, not at app start.
  const commandPalette = makeSlot(
    () => import("$lib/components/CommandPalette.svelte"),
    "CommandPalette",
  );
  const setupWizard = makeSlot(() => import("$lib/components/SetupWizard.svelte"), "SetupWizard");
  const cliSessionBrowser = makeSlot(
    () => import("$lib/components/CliSessionBrowser.svelte"),
    "CliSessionBrowser",
  );
  const folderPicker = makeSlot(
    () => import("$lib/components/FolderPicker.svelte"),
    "FolderPicker",
  );

  // Kick off the import as soon as the corresponding open flag goes truthy.
  // After the first successful resolution, ensure() is a no-op so re-opens
  // are free and do not stack timers / listeners inside the child.
  $effect(() => {
    if (commandPaletteOpen) void commandPalette.ensure();
  });
  $effect(() => {
    if (showSetupWizard) void setupWizard.ensure();
  });
  $effect(() => {
    if (folderPickerOpen) void folderPicker.ensure();
  });
  $effect(() => {
    if (showCliBrowser) void cliSessionBrowser.ensure();
  });
</script>

{#if commandPaletteOpen}
  {#if commandPalette.Component}
    {@const C = commandPalette.Component}
    <C
      bind:open={commandPaletteOpen}
      cwd={commandPaletteCwd}
      onOpenFolderBrowser={onOpenFolderBrowser ?? (() => {})}
    />
  {:else if commandPalette.error}
    <div class="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
      <div class="rounded-md bg-card px-4 py-3 text-sm text-destructive shadow-lg">
        {t("overlay_loadFailed", { name: "CommandPalette" })}: {commandPalette.error}
      </div>
    </div>
  {/if}
{/if}

{#if showSetupWizard}
  <div transition:fade={{ duration: 200 }}>
    {#if setupWizard.Component}
      {@const C = setupWizard.Component}
      <C onComplete={onSetupComplete ?? (() => {})} />
    {:else if setupWizard.error}
      <div class="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
        <div class="rounded-md bg-card px-4 py-3 text-sm text-destructive shadow-lg">
          {t("overlay_loadFailed", { name: "SetupWizard" })}: {setupWizard.error}
        </div>
      </div>
    {/if}
  </div>
{/if}

{#if folderPickerOpen}
  {#if folderPicker.Component}
    {@const C = folderPicker.Component}
    <C
      bind:open={folderPickerOpen}
      initialHost={folderPickerInitialHost}
      initialPath={folderPickerInitialPath}
      onConfirm={onFolderPicked ?? (() => {})}
    />
  {:else if folderPicker.error}
    <div class="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
      <div class="rounded-md bg-card px-4 py-3 text-sm text-destructive shadow-lg">
        {t("overlay_loadFailed", { name: "FolderPicker" })}: {folderPicker.error}
      </div>
    </div>
  {/if}
{/if}

{#if showCliBrowser}
  <div transition:fade={{ duration: 200 }}>
    {#if cliSessionBrowser.Component}
      {@const C = cliSessionBrowser.Component}
      <C
        cwd="/"
        onclose={onCliBrowserClose ?? (() => {})}
        onimported={onCliBrowserImported ?? (() => {})}
      />
    {:else if cliSessionBrowser.error}
      <div class="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
        <div class="rounded-md bg-card px-4 py-3 text-sm text-destructive shadow-lg">
          {t("overlay_loadFailed", { name: "CliSessionBrowser" })}: {cliSessionBrowser.error}
        </div>
      </div>
    {/if}
  </div>
{/if}
