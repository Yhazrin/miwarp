export function useFolderPicker() {
  let folderPickerOpen = $state(false);
  let folderPickerInitialHost = $state<string | null>(null);
  let folderPickerInitialPath = $state("");
  let folderPickerHideTarget = $state(false);
  let folderPickerResolve: ((v: { hostName: string | null; path: string } | null) => void) | null =
    null;

  function openFolderPicker(opts: {
    initialHost?: string | null;
    initialPath?: string;
    hideTargetSelector?: boolean;
  }): Promise<{ hostName: string | null; path: string } | null> {
    folderPickerInitialHost = opts.initialHost ?? null;
    folderPickerInitialPath = opts.initialPath ?? "";
    folderPickerHideTarget = opts.hideTargetSelector ?? false;
    folderPickerOpen = true;
    return new Promise((resolve) => {
      folderPickerResolve = resolve;
    });
  }

  function onFolderPickerConfirm(result: { hostName: string | null; path: string }) {
    const fn = folderPickerResolve;
    folderPickerResolve = null;
    fn?.(result);
  }

  function onFolderPickerCancel() {
    const fn = folderPickerResolve;
    folderPickerResolve = null;
    fn?.(null);
  }

  return {
    folderPickerOpen,
    folderPickerInitialHost,
    folderPickerInitialPath,
    folderPickerHideTarget,
    openFolderPicker,
    onFolderPickerConfirm,
    onFolderPickerCancel,
  };
}
