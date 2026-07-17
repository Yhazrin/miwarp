<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { dbg } from "$lib/utils/debug";
  import Icon from "$lib/components/Icon.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import MiPopover from "$lib/ui/MiPopover.svelte";

  interface SkillItem {
    name: string;
    description: string;
  }

  let {
    skills = [],
    agents = [],
    disabled = false,
    onSelect,
  }: {
    skills?: SkillItem[];
    agents?: SkillItem[];
    disabled?: boolean;
    onSelect?: (name: string) => void;
  } = $props();

  let open = $state(false);

  let isEmpty = $derived(skills.length === 0 && agents.length === 0);

  let triggerClass = $derived(
    `flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors ${
      disabled
        ? "cursor-default text-muted-foreground/40"
        : "cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
    }`,
  );

  function handleOpenChange(next: boolean) {
    if (disabled && next) return;
    open = next;
    dbg("skill-selector", "toggle", { open: next });
  }

  function selectSkill(name: string) {
    dbg("skill-selector", "select", { skillName: name });
    open = false;
    onSelect?.(name);
  }
</script>

<MiPopover
  bind:open
  {disabled}
  onOpenChange={handleOpenChange}
  contentClass="max-h-96 w-80 overflow-y-auto p-0"
  sideOffset={4}
>
  {#snippet trigger({ props })}
    <button {...props} type="button" class="{triggerClass} {props.class ?? ''}" {disabled}>
      <svg
        class="h-3 w-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
        />
        <path d="M20 3v4" />
        <path d="M22 5h-4" />
        <path d="M4 17v2" />
        <path d="M5 18H3" />
      </svg>
      {t("skillSelector_label")}
      <Icon
        name="chevron-down"
        size="xs"
        class="text-foreground/30 transition-transform duration-200 data-[state=open]:rotate-180"
      />
    </button>
  {/snippet}
  {#snippet children()}
    {#if isEmpty}
      <EmptyState iconName="zap" title={t("skillSelector_empty")} class="py-4" />
    {:else}
      <div class="p-1">
        {#if skills.length > 0}
          {#each skills as skill (skill.name)}
            <button
              type="button"
              class="group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
              onclick={() => selectSkill(skill.name)}
            >
              <span
                class="shrink-0 font-mono text-[11px] text-muted-foreground transition-colors group-hover:text-primary"
                >/</span
              >
              <span class="shrink-0 text-xs font-medium text-foreground">{skill.name}</span>
              {#if skill.description}
                <span class="min-w-0 truncate text-xs text-muted-foreground">
                  {skill.description}
                </span>
              {/if}
            </button>
          {/each}
        {/if}

        {#if agents.length > 0}
          {#if skills.length > 0}
            <div class="mx-2 my-1 border-t border-border/50"></div>
          {/if}
          <div
            class="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60"
          >
            Agents
          </div>
          {#each agents as agent (agent.name)}
            <div class="flex items-center gap-2 rounded-md px-2.5 py-1.5 opacity-70">
              <svg
                class="h-3 w-3 shrink-0 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2" />
                <path d="M2 14h2" />
                <path d="M20 14h2" />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
              </svg>
              <span class="shrink-0 text-xs font-medium text-foreground/70">{agent.name}</span>
              {#if agent.description}
                <span class="min-w-0 truncate text-xs text-muted-foreground">
                  {agent.description}
                </span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  {/snippet}
</MiPopover>
