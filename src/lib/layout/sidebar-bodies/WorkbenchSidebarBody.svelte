<!--
  WorkbenchSidebarBody — body for `/workflow` workbench routes. Lazy-loaded.
-->
<script lang="ts">
  import WorkbenchSidebar from "$lib/components/workbench/WorkbenchSidebar.svelte";

  interface Props {
    onPickFolder: () => void;
  }

  let { onPickFolder }: Props = $props();
</script>

<WorkbenchSidebar {onPickFolder} />
