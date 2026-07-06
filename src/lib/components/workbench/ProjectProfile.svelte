<script lang="ts">
  import { projectProfileStore } from "$lib/workbench/project-profile-store.svelte";
  import type { ProjectMetadata } from "$lib/types";
  import { t, tRaw } from "$lib/i18n/index.svelte";

  type CommandKind = "test" | "build" | "dev" | "lint" | "start";

  interface Props {
    cwd: string;
    onCommand?: (kind: CommandKind, command: string) => void;
  }

  let { cwd, onCommand }: Props = $props();

  const profile = $derived<ProjectMetadata | null>(projectProfileStore.profile);
  const loading = $derived(projectProfileStore.loadingProfile);

  const commandSections: ReadonlyArray<{ kind: CommandKind; labelKey: string }> = [
    { kind: "test", labelKey: "workbench_profile_cmdTest" },
    { kind: "build", labelKey: "workbench_profile_cmdBuild" },
    { kind: "dev", labelKey: "workbench_profile_cmdDev" },
    { kind: "lint", labelKey: "workbench_profile_cmdLint" },
    { kind: "start", labelKey: "workbench_profile_cmdStart" },
  ];

  const stackChips = $derived.by(() => {
    if (!profile) return [] as Array<{ key: string; labelKey: string }>;
    const stack = profile.stack;
    const chips: Array<{ key: string; labelKey: string }> = [];
    if (stack.typescript) chips.push({ key: "ts", labelKey: "workbench_profile_stackTypeScript" });
    if (stack.rust) chips.push({ key: "rs", labelKey: "workbench_profile_stackRust" });
    if (stack.python) chips.push({ key: "py", labelKey: "workbench_profile_stackPython" });
    if (stack.go) chips.push({ key: "go", labelKey: "workbench_profile_stackGo" });
    return chips;
  });

  const commandLists = $derived.by(() => {
    if (!profile) {
      return commandSections.map((section) => ({ ...section, items: [] as string[] }));
    }
    return commandSections.map((section) => ({
      ...section,
      items: profile.commands[section.kind] ?? [],
    }));
  });

  function handleCommand(kind: CommandKind, command: string): void {
    onCommand?.(kind, command);
  }

  $effect(() => {
    if (cwd) {
      void projectProfileStore.load(cwd);
    }
  });
</script>

<section
  class="rounded-lg border border-border/40 bg-card/40 p-3"
  aria-label={t("workbench_profile_title")}
  data-project-profile
>
  <h3 class="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
    {t("workbench_profile_title")}
  </h3>

  {#if loading && !profile}
    <p class="text-[11px] text-muted-foreground">{t("workbench_profile_loading")}</p>
  {:else if !profile}
    <p class="text-[11px] text-muted-foreground">{t("workbench_profile_empty")}</p>
  {:else}
    {#if stackChips.length > 0}
      <div class="mb-3 inline-flex flex-wrap gap-1">
        {#each stackChips as chip (chip.key)}
          <span
            class="inline-flex items-center rounded-full border border-border/40 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-foreground/80"
          >
            {tRaw(chip.labelKey)}
          </span>
        {/each}
      </div>
    {/if}

    {#each commandLists as section (section.kind)}
      {#if section.items.length > 0}
        <div class="mb-3 last:mb-0">
          <h4
            class="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
          >
            {tRaw(section.labelKey)}
          </h4>
          <ul class="space-y-1">
            {#each section.items as command, index (`${section.kind}-${index}-${command}`)}
              <li>
                <button
                  type="button"
                  class="block w-full truncate rounded-md border border-border/30 bg-background/40 px-2 py-1 text-left font-mono text-[11px] text-foreground/90 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  onclick={() => handleCommand(section.kind, command)}
                  aria-label={t("workbench_profile_cmdAria", {
                    section: tRaw(section.labelKey),
                    command,
                  })}
                >
                  {command}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/each}

    {#if profile.claude_md.exists}
      <div class="mt-3">
        <h4 class="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {t("workbench_profile_claudeMd")}
        </h4>
        <p class="line-clamp-3 whitespace-pre-wrap break-words text-[11px] text-foreground/80">
          {profile.claude_md.excerpt.slice(0, 200)}
        </p>
      </div>
    {/if}

    {#if profile.readme.exists}
      <div class="mt-3">
        <h4 class="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {t("workbench_profile_readme")}
        </h4>
        <p class="line-clamp-3 whitespace-pre-wrap break-words text-[11px] text-foreground/80">
          {profile.readme.excerpt.slice(0, 200)}
        </p>
      </div>
    {/if}
  {/if}
</section>
