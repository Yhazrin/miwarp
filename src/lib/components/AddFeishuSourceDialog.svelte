<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { SkillSourceConfig } from "$lib/types/skill";
  import type { SkillSourcesStore } from "$lib/stores/skill-source-store.svelte";

  import { showToast as globalToast } from "$lib/stores/toast-store.svelte";

  interface Props {
    open?: boolean;
    store: SkillSourcesStore;
    onClose?: () => void;
    onSaved?: () => void;
  }

  let { open = $bindable(false), store, onClose, onSaved }: Props = $props();

  let name = $state("");
  let urls = $state("");
  let auth = $state("");
  let parser = $state<"strict" | "loose">("strict");

  async function handleSave(e: Event) {
    e.preventDefault();
    try {
      const docUrls = urls
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      const iso = () => new Date().toISOString();
      const id = `fs-${crypto.randomUUID().slice(0, 10)}`;
      const cfg: SkillSourceConfig = {
        id,
        name: name.trim() || id,
        type: "feishu",
        enabled: true,
        feishu: {
          parserMode: parser,
          docUrls,
          authProfile: auth.trim() ? auth.trim() : undefined,
        },
        sync: { mode: "manual" },
        createdAt: iso(),
        updatedAt: iso(),
      };
      await store.addFeishuSource(cfg);
      open = false;
      onSaved?.();
      name = "";
      urls = "";
      auth = "";
      parser = "strict";
    } catch (err) {
      globalToast(err instanceof Error ? err.message : String(err), "error");
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm"
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        open = false;
        onClose?.();
      }
    }}
  >
    <div
      class="w-full max-w-md mx-4 rounded-2xl border border-border bg-background shadow-2xl p-5 space-y-4"
    >
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">{t("skillSources_dialog_title")}</h3>
        <button
          type="button"
          class="rounded-md p-1 text-muted-foreground hover:text-foreground"
          onclick={() => {
            open = false;
            onClose?.();
          }}
        >
          ✕
        </button>
      </div>

      {#if store.error}
        <p class="text-xs text-destructive">{store.error}</p>
      {/if}

      <form class="space-y-3 text-xs" onsubmit={handleSave}>
        <div>
          <label for="feishu-name" class="block text-muted-foreground mb-1"
            >{t("skillSources_field_name")}</label
          >
          <input
            id="feishu-name"
            class="w-full rounded-lg border border-border bg-background px-3 py-1.5"
            bind:value={name}
            required
          />
        </div>
        <div>
          <label for="feishu-urls" class="block text-muted-foreground mb-1"
            >{t("skillSources_field_urls")}</label
          >
          <textarea
            id="feishu-urls"
            rows="5"
            class="w-full rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-[11px]"
            bind:value={urls}
          ></textarea>
        </div>
        <div>
          <label for="feishu-profile" class="block text-muted-foreground mb-1"
            >{t("skillSources_field_profile")}</label
          >
          <input
            id="feishu-profile"
            class="w-full rounded-lg border border-border bg-background px-3 py-1.5"
            bind:value={auth}
          />
        </div>
        <div>
          <label for="feishu-parser" class="block text-muted-foreground mb-1"
            >{t("skillSources_field_parser")}</label
          >
          <select
            id="feishu-parser"
            class="w-full rounded-lg border border-border bg-background px-3 py-1.5"
            bind:value={parser}
          >
            <option value="strict">{t("skillSources_parser_strict")}</option>
            <option value="loose">{t("skillSources_parser_loose")}</option>
          </select>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            class="rounded-lg border border-border px-3 py-1.5"
            onclick={() => {
              open = false;
              onClose?.();
            }}
          >
            {t("common_cancel")}
          </button>
          <button type="submit" class="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground">
            {t("skillSources_save")}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
