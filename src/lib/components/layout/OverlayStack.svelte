<script lang="ts">
  /**
   * OverlayStack — host for the 4 rarely-shown overlays that used to be
   * `{#if}`-gated inline in `src/routes/+layout.svelte`. Each overlay is only
   * mounted while its flag is truthy, so cost is paid only when needed.
   */
  import { fade } from "svelte/transition";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import SetupWizard from "$lib/components/SetupWizard.svelte";
  import CliSessionBrowser from "$lib/components/CliSessionBrowser.svelte";
  import FolderPicker from "$lib/components/FolderPicker.svelte";

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
</script>

{#if commandPaletteOpen}
  <CommandPalette
    bind:open={commandPaletteOpen}
    cwd={commandPaletteCwd}
    onOpenFolderBrowser={onOpenFolderBrowser ?? (() => {})}
  />
{/if}

{#if showSetupWizard}
  <div transition:fade={{ duration: 200 }}>
    <SetupWizard onComplete={onSetupComplete ?? (() => {})} />
  </div>
{/if}

{#if folderPickerOpen}
  <FolderPicker
    bind:open={folderPickerOpen}
    initialHost={folderPickerInitialHost}
    initialPath={folderPickerInitialPath}
    onConfirm={onFolderPicked ?? (() => {})}
  />
{/if}

{#if showCliBrowser}
  <div transition:fade={{ duration: 200 }}>
    <CliSessionBrowser
      cwd="/"
      onclose={onCliBrowserClose ?? (() => {})}
      onimported={onCliBrowserImported ?? (() => {})}
    />
  </div>
{/if}
