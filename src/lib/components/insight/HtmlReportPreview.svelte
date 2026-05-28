<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import Modal from "$lib/components/Modal.svelte";

  let {
    open = $bindable(false),
    html,
    title,
  }: {
    open?: boolean;
    html: string;
    title?: string;
  } = $props();

  let iframeEl: HTMLIFrameElement | undefined = $state();

  $effect(() => {
    if (open && iframeEl && html) {
      // Write HTML content to iframe after it's mounted
      const doc = iframeEl.contentDocument;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();
      }
    }
  });
</script>

<Modal bind:open title={title || t("insight_preview_title")} size="xl">
  <div class="-m-6 h-[70vh] min-h-[400px]">
    <iframe
      bind:this={iframeEl}
      class="h-full w-full border-0 rounded-b-xl bg-white"
      title={t("insight_preview_title")}
      sandbox="allow-same-origin"
    ></iframe>
  </div>
</Modal>
