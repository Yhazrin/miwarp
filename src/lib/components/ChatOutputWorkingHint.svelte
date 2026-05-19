<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
</script>

<div class="w-full py-2 animate-fade-in">
  <div class="chat-content-width pl-7">
    <div
      class="flex items-center gap-2.5 rounded-lg border border-border/40 bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground"
      data-output-working-hint
    >
      <span class="h-2 w-2 shrink-0 rounded-full bg-primary/70 animate-pulse" aria-hidden="true"
      ></span>
      <span>{t("chat_outputWorkingHint")}</span>
    </div>
  </div>
</div>
