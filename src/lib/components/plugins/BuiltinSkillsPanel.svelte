<script lang="ts">
  import {
    listRecommendedBuiltInSkills,
    installBuiltInSkill,
    installAllBuiltInSkills,
  } from "$lib/skills/install-builtin";
  import { showToast } from "$lib/stores/toast-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";

  interface Props {
    installedNames: ReadonlySet<string>;
    projectCwd?: string | null;
    onInstalled?: () => void | Promise<void>;
  }

  let { installedNames, projectCwd = null, onInstalled }: Props = $props();

  const builtInSkills = listRecommendedBuiltInSkills();
  let scope = $state<"user" | "project">("user");
  let installingName = $state<string | null>(null);
  let installingAll = $state(false);

  const missingCount = $derived(
    builtInSkills.filter((skill) => !installedNames.has(skill.name)).length,
  );

  async function handleInstall(name: string) {
    if (installedNames.has(name) || installingName || installingAll) return;
    installingName = name;
    try {
      await installBuiltInSkill(name, scope, projectCwd || undefined);
      showToast(t("plugin_installedBuiltin", { name }), "success");
      await onInstalled?.();
    } catch (error) {
      showToast(t("plugin_failedInstallBuiltin", { error: String(error) }), "error");
    } finally {
      installingName = null;
    }
  }

  async function handleInstallAll() {
    if (missingCount === 0 || installingName || installingAll) return;
    installingAll = true;
    try {
      const count = await installAllBuiltInSkills(scope, installedNames, projectCwd || undefined);
      showToast(t("plugin_builtinInstalledAll", { count: String(count) }), "success");
      await onInstalled?.();
    } catch (error) {
      showToast(t("plugin_failedInstallBuiltin", { error: String(error) }), "error");
    } finally {
      installingAll = false;
    }
  }
</script>

<section class="rounded-2xl border border-border/50 bg-card/30 p-4 space-y-3">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name="sparkles" size="sm" />
        </div>
        <h3 class="text-sm font-semibold text-foreground">{t("plugin_builtinSkillsTitle")}</h3>
      </div>
      <p class="mt-1 text-xs text-muted-foreground max-w-2xl">{t("plugin_builtinSkillsDesc")}</p>
    </div>

    <div class="flex flex-wrap items-center gap-2 shrink-0">
      <div class="flex rounded-lg border border-border p-0.5">
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs font-medium transition-colors {scope === 'user'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (scope = "user")}>{t("plugin_scopeUser")}</button
        >
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed {scope ===
          'project'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
          disabled={!projectCwd}
          onclick={() => (scope = "project")}>{t("plugin_scopeProject")}</button
        >
      </div>

      {#if missingCount > 0}
        <button
          type="button"
          class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          disabled={installingAll || installingName !== null}
          onclick={handleInstallAll}
        >
          {#if installingAll}
            <span class="inline-flex items-center gap-1.5">
              <Spinner size="xs" />
              {t("plugin_installingAllBuiltin")}
            </span>
          {:else}
            {t("plugin_installAllBuiltin", { count: String(missingCount) })}
          {/if}
        </button>
      {/if}
    </div>
  </div>

  <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
    {#each builtInSkills as skill (skill.id)}
      {@const isInstalled = installedNames.has(skill.name)}
      <div class="rounded-xl border border-border/40 bg-background/60 px-3 py-2.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-foreground truncate">{skill.name}</div>
            <p class="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{skill.description}</p>
            {#if skill.tags && skill.tags.length > 0}
              <div class="mt-1.5 flex flex-wrap gap-1">
                {#each skill.tags.slice(0, 3) as tag}
                  <span
                    class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >{tag}</span
                  >
                {/each}
              </div>
            {/if}
          </div>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 {isInstalled
              ? 'bg-[hsl(var(--miwarp-status-success)/0.1)] text-miwarp-status-success cursor-default'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'}"
            disabled={isInstalled || installingAll || installingName === skill.name}
            onclick={() => handleInstall(skill.name)}
          >
            {#if installingName === skill.name}
              ...
            {:else if isInstalled}
              {t("plugin_installed")}
            {:else}
              {t("plugin_installBuiltin")}
            {/if}
          </button>
        </div>
      </div>
    {/each}
  </div>
</section>
