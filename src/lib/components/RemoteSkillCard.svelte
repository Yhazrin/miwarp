<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { RemoteSkillCandidate } from "$lib/types/skill";

  interface Props {
    candidate: RemoteSkillCandidate;
    busy?: boolean;
    onInstall?: (resolution?: "abort" | "copy" | "replace") => void;
  }

  let { candidate, busy = false, onInstall }: Props = $props();

  function badgeClass(status: string) {
    switch (status) {
      case "installed":
        return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
      case "update_available":
        return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
      case "conflict":
        return "bg-amber-500/15 text-amber-800 dark:text-amber-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  }

  function statusLabel(status: string) {
    if (status === "installed") return t("skillSources_status_installed");
    if (status === "update_available") return t("skillSources_status_update_available");
    if (status === "conflict") return t("skillSources_status_conflict");
    return t("skillSources_status_not_installed");
  }
</script>

<div
  class="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm p-4 space-y-3"
  class:opacity-60={candidate.skipped}
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <h4 class="text-sm font-semibold text-foreground truncate">{candidate.name}</h4>
        <span
          class="text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-violet-500/10 text-violet-700 dark:text-violet-400"
          >{t("skillSources_badge_feishu")}</span
        >
        <span class="text-[10px] font-medium rounded-full px-1.5 py-0.5 {badgeClass(candidate.status)}">
          {statusLabel(candidate.status)}
        </span>
      </div>
      {#if candidate.description}
        <p class="text-xs text-muted-foreground mt-1 line-clamp-2">{candidate.description}</p>
      {/if}
      {#if candidate.skipped && candidate.skipReason}
        <p class="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
          {candidate.skipReason}
        </p>
      {/if}
      <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground font-mono">
        <span>hash:{candidate.contentHash.slice(0, 10)}…</span>
      </div>
    </div>
    {#if candidate.remoteUrl}
      <a
        href={candidate.remoteUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="text-[11px] text-primary hover:underline shrink-0">{t("skillSources_open_origin")}</a
      >
    {/if}
  </div>

  {#if !candidate.skipped}
    <div class="flex flex-wrap gap-2">
      {#if candidate.status === "conflict"}
        <button
          type="button"
          class="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
          onclick={() => onInstall?.("copy")}
          disabled={busy}
        >
          {t("skillSources_install_copy")}
        </button>
        <button
          type="button"
          class="rounded-lg border border-destructive/40 text-destructive px-3 py-1.5 text-xs disabled:opacity-50"
          onclick={() => onInstall?.("replace")}
          disabled={busy}
        >
          {t("skillSources_install_replace")}
        </button>
      {:else}
        {#if candidate.status !== "installed"}
          <button
            type="button"
            class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            onclick={() => onInstall?.()}
            disabled={busy}
          >
            {t("skillSources_install")}
          </button>
        {/if}
        {#if candidate.status === "update_available"}
          <button
            type="button"
            class="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
            onclick={() => onInstall?.("copy")}
            disabled={busy}
          >
            {t("skillSources_install_copy")}
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>
