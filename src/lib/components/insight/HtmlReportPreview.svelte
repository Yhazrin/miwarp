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
  <div class="preview-container">
    <iframe
      bind:this={iframeEl}
      class="preview-iframe"
      title={t("insight_preview_title")}
      sandbox="allow-same-origin"
    ></iframe>
  </div>
</Modal>

<style>
  .preview-container {
    margin: -24px;
    height: 70vh;
    min-height: 400px;
  }

  .preview-iframe {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 0 0 12px 12px;
    background: white;
  }
</style>
