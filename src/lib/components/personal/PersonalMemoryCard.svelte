<script lang="ts">
  /**
   * Memory & Skills — links out to /skills and explains the in-workspace
   * memory panel. The "skills count" is computed by the parent and passed
   * in so this card never has to know which store owns the data.
   */
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import Icon from "$lib/components/Icon.svelte";
  import PersonalSection from "./PersonalSection.svelte";

  let { skillCount }: { skillCount: number } = $props();

  function lk(key: string, params: Record<string, string> | undefined = undefined): string {
    return t(key as MessageKey, params);
  }
</script>

<PersonalSection
  icon="scroll-text"
  eyebrow={lk("personal_section_memory_eyebrow")}
  title={lk("personal_section_memory_title")}
  description={lk("personal_section_memory_desc")}
>
  <div class="grid gap-3 sm:grid-cols-2">
    <a
      href="/skills"
      onclick={(e) => {
        e.preventDefault();
        goto("/skills");
      }}
      class="group flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-3 transition-colors hover:bg-accent/30"
    >
      <div class="min-w-0">
        <p class="text-sm font-medium text-foreground">{lk("personal_memory_skills")}</p>
        <p class="text-xs text-muted-foreground">
          {lk("personal_memory_skillsDesc", { count: String(skillCount) })}
        </p>
      </div>
      <div class="flex items-center gap-2 text-muted-foreground group-hover:text-foreground">
        <span class="text-sm font-semibold tabular-nums">{skillCount}</span>
        <Icon name="chevron-right" size="sm" />
      </div>
    </a>

    <div class="rounded-lg border border-border/60 bg-background/40 p-3">
      <p class="text-sm font-medium text-foreground">{lk("personal_memory_workspace")}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {lk("personal_memory_workspaceDesc")}
      </p>
    </div>
  </div>
</PersonalSection>
