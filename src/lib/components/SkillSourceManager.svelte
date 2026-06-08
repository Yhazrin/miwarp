<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbgWarn } from "$lib/utils/debug";
  import { skillSourcesStore } from "$lib/stores/skill-source-store.svelte";
  import SkillSourceSyncLog from "$lib/components/SkillSourceSyncLog.svelte";
  import RemoteSkillCard from "$lib/components/RemoteSkillCard.svelte";
  import AddFeishuSourceDialog from "$lib/components/AddFeishuSourceDialog.svelte";
  import { showToast as globalToast } from "$lib/stores/toast-store.svelte";
  import type { SkillSourceConfig } from "$lib/types/skill";

  interface Props {
    projectCwd: string;
    onSkillsReload?: () => void;
  }

  let { projectCwd, onSkillsReload }: Props = $props();

  const store = skillSourcesStore;
  let addOpen = $state(false);
  let previewUrl = $state("");
  let previewAuth = $state("");
  let previewParser = $state<"strict" | "loose">("strict");
  let installingId = $state<string | null>(null);
  let installScope = $state<"user" | "project">("user");

  onMount(async () => {
    try {
      await store.loadSources();
      await store.runStartupSyncIfNeeded(projectCwd || undefined);
    } catch (e) {
      dbgWarn("skill-source-manager", "onMount failed", e);
    }
  });

  async function handlePreview() {
    const u = previewUrl.trim();
    if (!u) return;
    await store.previewFeishuDoc(
      u,
      previewAuth.trim() || undefined,
      previewParser === "loose" ? "loose" : "strict",
      undefined,
    );
  }

  async function handleCandidateInstall(cid: string, resolution?: "abort" | "copy" | "replace") {
    if (installScope === "project" && !projectCwd) {
      globalToast(t("skillSources_need_project_scope"), "error");
      return;
    }
    if (resolution === "replace") {
      if (!confirm(t("skillSources_confirm_replace"))) return;
    }
    installingId = cid;
    try {
      const ok = await store.installCandidate(
        cid,
        installScope,
        projectCwd || undefined,
        resolution ?? undefined,
      );
      if (ok) {
        globalToast(t("skillSources_installed"), "success");
        await store.loadSources();
        onSkillsReload?.();
      } else if (store.error) {
        globalToast(store.error, "error");
      }
    } finally {
      installingId = null;
    }
  }

  async function toggleEnabled(src: SkillSourceConfig, ev: Event) {
    const el = ev.currentTarget as HTMLInputElement;
    await store.patchSource({ ...src, enabled: el.checked });
  }
</script>

<div class="space-y-6">
  <div>
    <h2 class="text-sm font-semibold text-foreground">{t("skillSources_title")}</h2>
    <p class="text-xs text-muted-foreground">{t("skillSources_subtitle")}</p>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
      onclick={() => {
        store.error = null;
        addOpen = true;
      }}
    >
      {t("skillSources_add_feishu")}
    </button>
    <button
      type="button"
      class="rounded-lg border border-border px-3 py-1.5 text-xs"
      onclick={() => store.loadSources()}
      disabled={store.loading}
    >
      {t("skillSources_refresh")}
    </button>
  </div>

  {#if store.error && !addOpen}
    <p class="text-xs text-destructive">{store.error}</p>
  {/if}

  <div class="rounded-xl border border-border/50 bg-card/30 p-4 space-y-2">
    <h3 class="text-xs font-medium text-muted-foreground">{t("skillSources_preview_heading")}</h3>
    <div class="flex flex-col sm:flex-row gap-2">
      <input
        class="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
        placeholder={t("skillSources_preview_url")}
        bind:value={previewUrl}
      />
      <select
        class="rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
        bind:value={previewParser}
      >
        <option value="strict">{t("skillSources_parser_strict")}</option>
        <option value="loose">{t("skillSources_parser_loose")}</option>
      </select>
      <button type="button" class="rounded-lg bg-muted px-3 py-1.5 text-xs" onclick={handlePreview}>
        {t("skillSources_preview")}
      </button>
    </div>
    <input
      class="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono"
      placeholder={t("skillSources_field_profile")}
      bind:value={previewAuth}
    />

    {#if store.previewCandidate}
      {@const pc = store.previewCandidate}
      <RemoteSkillCard
        candidate={pc}
        busy={installingId === pc.id}
        onInstall={(res) => handleCandidateInstall(pc.id, res)}
      />

      <div class="flex items-center gap-2 text-xs pt-2">
        <span class="text-muted-foreground">{t("skillSources_install_scope")}</span>
        <label class="inline-flex items-center gap-1 cursor-pointer">
          <input type="radio" bind:group={installScope} value="user" />
          {t("plugin_scopeUser")}
        </label>
        <label class="inline-flex items-center gap-1 cursor-pointer">
          <input type="radio" bind:group={installScope} value="project" disabled={!projectCwd} />
          {t("plugin_scopeProject")}
        </label>
      </div>
    {/if}
  </div>

  {#if store.loading && store.sources.length === 0}
    <div class="text-xs text-muted-foreground">{t("skillSources_loading")}</div>
  {:else if store.sources.length === 0}
    <p class="text-xs text-muted-foreground">{t("skillSources_empty")}</p>
  {:else}
    <div class="space-y-3">
      {#each store.sources as src}
        <div class="rounded-xl border border-border/40 bg-card/40 p-4 space-y-2">
          <div class="flex flex-wrap gap-2 items-center justify-between">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium">{src.name}</span>
                <span class="text-[10px] text-muted-foreground font-mono">{src.type}</span>
                {#if !src.enabled}
                  <span class="text-[10px]">{t("skillSources_disabled")}</span>
                {/if}
              </div>
              {#if src.sync.lastSyncedAt}
                <div class="text-[10px] text-muted-foreground mt-1">
                  {t("skillSources_last_sync")}: {src.sync.lastSyncedAt}
                  {#if src.sync.lastStatus}· {src.sync.lastStatus}{/if}
                </div>
              {/if}
            </div>
            <div class="flex flex-wrap gap-1">
              <label class="text-[11px] flex items-center gap-1 mr-2">
                <input
                  type="checkbox"
                  checked={src.enabled}
                  onchange={(e) => toggleEnabled(src, e)}
                />
                {t("skillSources_toggle")}
              </label>
              {#if src.type === "feishu"}
                <button
                  type="button"
                  class="rounded-md border px-2 py-1 text-[11px]"
                  onclick={() => store.testSource(src.id)}
                  disabled={store.syncingSourceIds.has(src.id)}
                >
                  {t("skillSources_test")}
                </button>
                <button
                  type="button"
                  class="rounded-md border px-2 py-1 text-[11px]"
                  onclick={() => store.syncSource(src.id)}
                  disabled={store.syncingSourceIds.has(src.id)}
                >
                  {store.syncingSourceIds.has(src.id)
                    ? t("skillSources_syncing")
                    : t("skillSources_sync")}
                </button>
                <button
                  type="button"
                  class="rounded-md border px-2 py-1 text-[11px]"
                  onclick={() => store.checkUpdates(src.id, projectCwd)}
                >
                  {t("skillSources_updates")}
                </button>
              {/if}
              <button
                type="button"
                class="rounded-md border border-destructive/40 text-destructive px-2 py-1 text-[11px]"
                onclick={() => {
                  if (confirm(t("skillSources_confirm_delete"))) store.removeSource(src.id);
                }}
              >
                {t("skillSources_remove")}
              </button>
            </div>
          </div>

          {#if store.remoteCandidates.some((c) => c.sourceId === src.id && !c.skipped)}
            <div class="space-y-2 pt-2">
              {#each store.remoteCandidates.filter((c) => c.sourceId === src.id && !c.skipped) as cand}
                <RemoteSkillCard
                  candidate={cand}
                  busy={installingId === cand.id}
                  onInstall={(res) => handleCandidateInstall(cand.id, res)}
                />
              {/each}
            </div>
          {:else}
            {#each store.remoteCandidates.filter((c) => c.sourceId === src.id && c.skipped) as sc}
              <p class="text-[11px] text-muted-foreground">{sc.skipReason ?? ""}</p>
            {/each}
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if store.lastUpdatesCheck?.updates?.length}
    <div
      class="rounded-lg border border-[hsl(var(--miwarp-status-info)/0.3)] bg-[hsl(var(--miwarp-status-info)/0.05)] px-3 py-2 text-xs"
    >
      <p class="font-medium">{t("skillSources_updates_heading")}</p>
      <ul class="mt-1 space-y-0.5 font-mono text-[11px]">
        {#each store.lastUpdatesCheck.updates as u}
          <li>{u.skillName}: {u.localHash.slice(0, 8)}→{u.remoteHash.slice(0, 8)}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <SkillSourceSyncLog entries={store.syncLogs} />

  <AddFeishuSourceDialog bind:open={addOpen} {store} onSaved={() => store.loadSources()} />
</div>
