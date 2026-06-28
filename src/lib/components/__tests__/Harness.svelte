<script lang="ts">
  /**
   * Test harness for FilePreviewPane. Receives a single `state` prop that
   * the parent passes as a `$state`-backed reference (created via
   * `createHarnessState` from `harness-state.svelte.ts`). The parent then
   * mutates fields on the same reference to trigger reactivity inside
   * this component, which forwards the values to FilePreviewPane.
   *
   * Not part of the production bundle.
   */
  import FilePreviewPane from "../FilePreviewPane.svelte";

  let {
    state,
    onLoaded,
    onLoadFailed,
  }: {
    state: Record<string, unknown>;
    onLoaded?: (path: string) => void;
    onLoadFailed?: (path: string, err: string) => void;
  } = $props();
</script>

<FilePreviewPane
  cwd={(state.cwd as string) ?? ""}
  path={(state.path as string) ?? ""}
  mode={(state.mode as "preview" | "diff") ?? "preview"}
  editable={(state.editable as boolean) ?? false}
  isRemote={(state.isRemote as boolean) ?? false}
  scopeKey={(state.scopeKey as string) ?? ""}
  reloadToken={(state.reloadToken as number) ?? 0}
  {onLoaded}
  {onLoadFailed}
/>
