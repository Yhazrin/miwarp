<!--
  PromptAttachments — attachment & paste-block preview strip.

  Renders the row of chips above the textarea for pending file attachments,
  path references (directories / large files), and pasted text blocks.
  All removal callbacks are forwarded to the parent (AttachmentController).
-->
<script lang="ts">
  import FileAttachment from "$lib/components/FileAttachment.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { formatPasteSize } from "$lib/utils/format";
  import { isSpreadsheetExt } from "$lib/utils/file-types";
  import type {
    PendingAttachment,
    PastedBlock,
    PathRef,
  } from "$lib/stores/prompt-input-store.svelte";

  let {
    attachments = [],
    pathRefs = [],
    pastedBlocks = [],
    onRemoveAttachment,
    onRemovePathRef,
    onRemovePastedBlock,
  }: {
    attachments?: PendingAttachment[];
    pathRefs?: PathRef[];
    pastedBlocks?: PastedBlock[];
    onRemoveAttachment?: (id: string) => void;
    onRemovePathRef?: (id: string) => void;
    onRemovePastedBlock?: (id: string) => void;
  } = $props();

  const hasAny = $derived(attachments.length > 0 || pastedBlocks.length > 0 || pathRefs.length > 0);
</script>

{#if hasAny}
  <div class="mb-2 flex flex-wrap gap-1.5">
    {#each attachments as att (att.id)}
      <FileAttachment
        name={att.name}
        size={att.size}
        mimeType={att.type}
        isPathRef={!!att.filePath && !att.contentBase64}
        onremove={() => onRemoveAttachment?.(att.id)}
      />
    {/each}
    {#each pathRefs as ref (ref.id)}
      <FileAttachment
        name={ref.name}
        size={0}
        mimeType={ref.isDir ? "inode/directory" : "application/octet-stream"}
        isPathRef={true}
        onremove={() => onRemovePathRef?.(ref.id)}
      />
    {/each}
    {#each pastedBlocks as block (block.id)}
      {@const isSpreadsheet = block.ext ? isSpreadsheetExt(block.ext) : false}
      <span
        class="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--miwarp-status-info)/0.3)] bg-[hsl(var(--miwarp-status-info)/0.05)] text-miwarp-status-info px-2 py-1 text-xs"
      >
        {#if isSpreadsheet}
          <svg
            class="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" />
          </svg>
        {:else}
          <svg
            class="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path
              d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
            />
          </svg>
        {/if}
        <span class="truncate max-w-[200px]">{block.preview}</span>
        <span class="text-miwarp-status-info dark:text-miwarp-status-info"
          >{formatPasteSize(block.lineCount, block.charCount)}</span
        >
        <button
          type="button"
          onclick={() => onRemovePastedBlock?.(block.id)}
          class="ml-0.5 rounded p-0.5 transition-colors hover:bg-[hsl(var(--miwarp-status-info)/0.15)]"
          title={t("prompt_removePaste")}
          aria-label={t("prompt_removePaste")}
        >
          <Icon name="x" size="xs" />
        </button>
      </span>
    {/each}
  </div>
{/if}
