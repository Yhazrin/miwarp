<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import Button from "./Button.svelte";
  import type { Skill, SkillCategory } from "$lib/types/skill";
  import { skillStore } from "$lib/stores/skill-store.svelte";

  interface Props {
    initialSkill?: Skill;
    onComplete?: (skill: Skill) => void;
    onCancel?: () => void;
  }

  let { initialSkill: _initialSkill, onComplete, onCancel }: Props = $props();

  type WizardStep = "select-type" | "configure" | "parameters" | "test" | "complete";

  let step = $state<WizardStep>("select-type");

  // Skill creation state
  let selectedCategory = $state<SkillCategory | null>(null);
  let skillName = $state("");
  let skillDescription = $state("");
  let skillPrompt = $state("");
  let skillTags = $state<string[]>([]);
  let newTag = $state("");
  let skillIcon = $state("✨");

  // Test state
  let testing = $state(false);
  let testResult = $state<{ success: boolean; output?: string; error?: string } | null>(null);

  // Progress tracking
  const WIZARD_STEPS: WizardStep[] = ["select-type", "configure", "parameters", "test", "complete"];
  let stepIndex = $derived(WIZARD_STEPS.indexOf(step));
  let progress = $derived(((stepIndex + 1) / WIZARD_STEPS.length) * 100);

  const CATEGORIES: { id: SkillCategory; labelKey: string; descKey: string; icon: string }[] = [
    {
      id: "automation",
      labelKey: "skillWizard_catAutomation",
      descKey: "skillWizard_catAutomationDesc",
      icon: "⏰",
    },
    {
      id: "productivity",
      labelKey: "skillWizard_catProductivity",
      descKey: "skillWizard_catProductivityDesc",
      icon: "⚡",
    },
    {
      id: "development",
      labelKey: "skillWizard_catCode",
      descKey: "skillWizard_catCodeDesc",
      icon: "💻",
    },
    {
      id: "memory",
      labelKey: "skillWizard_catMemory",
      descKey: "skillWizard_catMemoryDesc",
      icon: "🧠",
    },
    {
      id: "integrations",
      labelKey: "skillWizard_catIntegrations",
      descKey: "skillWizard_catIntegrationsDesc",
      icon: "🔗",
    },
    {
      id: "custom",
      labelKey: "skillWizard_catCustom",
      descKey: "skillWizard_catCustomDesc",
      icon: "🎨",
    },
  ];

  const ICONS = ["✨", "🎯", "🚀", "⚡", "🔮", "🎨", "📝", "🔍", "📊", "🎵", "🌟", "💡"];

  function selectCategory(category: SkillCategory) {
    selectedCategory = category;
    step = "configure";
  }

  function goBack() {
    if (stepIndex > 0) {
      step = WIZARD_STEPS[stepIndex - 1];
    }
  }

  function nextStep() {
    if (stepIndex < WIZARD_STEPS.length - 1) {
      step = WIZARD_STEPS[stepIndex + 1];
    }
  }

  function addTag() {
    const trimmed = newTag.trim();
    if (trimmed && !skillTags.includes(trimmed)) {
      skillTags = [...skillTags, trimmed];
      newTag = "";
    }
  }

  function removeTag(tag: string) {
    skillTags = skillTags.filter((t) => t !== tag);
  }

  async function testSkill() {
    testing = true;
    testResult = null;

    try {
      // Simulate skill test - in real implementation, this would call the skill execution API
      await new Promise((resolve) => setTimeout(resolve, 1500));

      testResult = {
        success: true,
        output: t("skillWizard_testOutput"),
      };
      step = "complete";
    } catch (e) {
      testResult = {
        success: false,
        error: e instanceof Error ? e.message : t("skillWizard_testError"),
      };
    } finally {
      testing = false;
    }
  }

  async function createSkill() {
    const skill = await skillStore.createSkill(
      {
        name: skillName,
        description: skillDescription,
        category: selectedCategory || "custom",
        author: "User",
        trigger: skillTags,
        icon: skillIcon,
      },
      skillPrompt,
    );

    if (skill) {
      onComplete?.({
        id: `skill-${Date.now()}`,
        name: skillName,
        description: skillDescription,
        category: selectedCategory || "custom",
        source: "local",
        isBuiltIn: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: "User",
        tags: skillTags,
        icon: skillIcon,
        content: skillPrompt,
      } as Skill);
    }
  }

  function handleCancel() {
    if (onCancel) {
      onCancel();
    }
  }

  const isConfigureValid = $derived(
    skillName.trim().length > 0 && skillDescription.trim().length > 0,
  );

  const isPromptValid = $derived(skillPrompt.trim().length > 0);
</script>

/** * SkillSetupWizard - Guided setup wizard for skills * * Walks users through skill configuration
step by step, * with progress tracking and helpful hints. */
<div class="flex flex-col h-full">
  <!-- Progress bar -->
  <div class="shrink-0 px-4 pt-4">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-muted-foreground">
        {t("skillWizard_stepProgress", { step: String(stepIndex + 1), total: String(WIZARD_STEPS.length) })}
      </span>
      <span class="text-xs text-muted-foreground">{Math.round(progress)}%</span>
    </div>
    <div class="h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        class="h-full rounded-full bg-primary transition-all duration-300"
        style="width: {progress}%"
      ></div>
    </div>
  </div>

  <!-- Step content -->
  <div class="flex-1 overflow-y-auto p-4">
    {#if step === "select-type"}
      <!-- Step 1: Select category -->
      <div class="space-y-4">
        <div class="text-center mb-6">
          <h2 class="text-lg font-semibold mb-2">{t("skillWizard_selectType")}</h2>
          <p class="text-sm text-muted-foreground">
            {t("skillWizard_selectTypeDesc")}
          </p>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          {#each CATEGORIES as cat}
            <button
              type="button"
              onclick={() => selectCategory(cat.id)}
              class="p-4 rounded-xl border border-border text-left hover:border-primary hover:bg-primary/5 transition-all text-center"
            >
              <div class="text-2xl mb-2">{cat.icon}</div>
              <div class="font-medium text-sm">{t(cat.labelKey as MessageKey)}</div>
              <div class="text-xs text-muted-foreground mt-1 line-clamp-2">
                {t(cat.descKey as MessageKey)}
              </div>
            </button>
          {/each}
        </div>
      </div>
    {:else if step === "configure"}
      <!-- Step 2: Basic configuration -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <button
            type="button"
            onclick={goBack}
            class="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
          <span class="text-xs text-muted-foreground">
            {CATEGORIES.find((c) => c.id === selectedCategory)?.icon}
            {selectedCategory}
          </span>
        </div>

        <h2 class="text-lg font-semibold">{t("skillWizard_basicConfig")}</h2>

        <!-- Name -->
        <div class="space-y-1">
          <label
            for="skill-wizard-name"
            class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
          >
            {t("skillWizard_skillName")}
          </label>
          <input
            id="skill-wizard-name"
            type="text"
            bind:value={skillName}
            placeholder={t("skillWizard_placeholderName")}
            class="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
          />
          <p class="text-[10px] text-muted-foreground">
            {t("skillWizard_helpKebabCase")}
          </p>
        </div>

        <!-- Description -->
        <div class="space-y-1">
          <label
            for="skill-wizard-desc"
            class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
          >
            {t("skillWizard_description")}
          </label>
          <textarea
            id="skill-wizard-desc"
            bind:value={skillDescription}
            placeholder={t("skillWizard_placeholderDesc")}
            rows="2"
            class="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none"
          ></textarea>
        </div>

        <!-- Icon picker -->
        <div class="space-y-1">
          <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("skillWizard_icon")}
          </span>
          <div class="flex flex-wrap gap-2">
            {#each ICONS as icon}
              <button
                type="button"
                onclick={() => (skillIcon = icon)}
                class="w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-all
                  {skillIcon === icon
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 hover:bg-muted'}"
              >
                {icon}
              </button>
            {/each}
          </div>
        </div>

        <!-- Tags -->
        <div class="space-y-1">
          <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("skillWizard_tags")}
          </span>
          <div class="flex flex-wrap gap-1 mb-2">
            {#each skillTags as tag}
              <span class="px-2 py-0.5 text-xs rounded-full bg-muted/50 flex items-center gap-1">
                {tag}
                <button
                  type="button"
                  onclick={() => removeTag(tag)}
                  class="text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </span>
            {/each}
          </div>
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={newTag}
              onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              placeholder={t("skillWizard_placeholderTag")}
              class="flex-1 px-3 py-1.5 rounded-lg border border-input bg-background text-xs"
            />
            <Button variant="outline" size="sm" onclick={addTag}>{t("skillWizard_add")}</Button>
          </div>
        </div>

        <Button onclick={nextStep} disabled={!isConfigureValid} class="w-full">{t("skillWizard_continue")}</Button>
      </div>
    {:else if step === "parameters"}
      <!-- Step 3: Skill prompt/content -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <button
            type="button"
            onclick={goBack}
            class="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
        </div>

        <h2 class="text-lg font-semibold">{t("skillWizard_skillPrompt")}</h2>
        <p class="text-sm text-muted-foreground">
          {t("skillWizard_helpWriteInstructions")}
        </p>

        <div class="space-y-1">
          <label
            for="skill-wizard-content"
            class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
          >
            {t("skillWizard_skillContent")}
          </label>
          <textarea
            id="skill-wizard-content"
            bind:value={skillPrompt}
            placeholder={t("skillWizard_placeholderContent")}
            rows="12"
            class="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm font-mono resize-none"
          ></textarea>
        </div>

        <div class="p-3 rounded-lg bg-muted/30 text-xs space-y-1">
          <div class="font-medium">{t("skillWizard_writingTips")}</div>
          <ul class="list-disc list-inside text-muted-foreground space-y-0.5">
            <li>{t("skillWizard_helpStartDescription")}</li>
            <li>{t("skillWizard_helpUsageExamples")}</li>
            <li>{t("skillWizard_helpNumberedSteps")}</li>
            <li>{t("skillWizard_helpErrorHandling")}</li>
          </ul>
        </div>

        <Button onclick={nextStep} disabled={!isPromptValid} class="w-full">
          {t("skillWizard_continueToTest")}
        </Button>
      </div>
    {:else if step === "test"}
      <!-- Step 4: Test the skill -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <button
            type="button"
            onclick={goBack}
            class="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
        </div>

        <h2 class="text-lg font-semibold">{t("skillWizard_testSkill")}</h2>
        <p class="text-sm text-muted-foreground">
          {t("skillWizard_helpRunTest")}
        </p>

        {#if testResult}
          <div
            class="p-4 rounded-lg {testResult.success
              ? 'bg-[hsl(var(--miwarp-status-success)/0.1)] border-[hsl(var(--miwarp-status-success)/0.3)]'
              : 'bg-[hsl(var(--miwarp-status-error)/0.1)] border-[hsl(var(--miwarp-status-error)/0.3)]'} border"
          >
            <div class="flex items-center gap-2 mb-2">
              {#if testResult.success}
                <span class="text-xl">✅</span>
                <span class="font-medium text-[hsl(var(--miwarp-status-success))]">{t("skillWizard_testPassed")}</span>
              {:else}
                <span class="text-xl">❌</span>
                <span class="font-medium text-[hsl(var(--miwarp-status-error))]">{t("skillWizard_testFailed")}</span>
              {/if}
            </div>
            {#if testResult.output}
              <div class="text-sm text-muted-foreground font-mono">{testResult.output}</div>
            {/if}
            {#if testResult.error}
              <div class="text-sm text-[hsl(var(--miwarp-status-error))] font-mono">{testResult.error}</div>
            {/if}
          </div>
        {/if}

        {#if testing}
          <div class="flex items-center justify-center py-8">
            <Spinner size="xl" class="border-primary/30 border-t-transparent" />
            <span class="ml-3 text-sm text-muted-foreground">{t("skillWizard_runningTest")}</span>
          </div>
        {/if}

        <Button onclick={testSkill} disabled={testing} class="w-full">
          {testing ? t("skillWizard_testing") : t("skillWizard_runTest")}
        </Button>
      </div>
    {:else if step === "complete"}
      <!-- Step 5: Complete -->
      <div class="flex flex-col items-center justify-center h-full text-center space-y-4">
        <div class="text-5xl">{skillIcon}</div>
        <div>
          <h2 class="text-xl font-semibold mb-2">{t("skillWizard_complete")}</h2>
          <p class="text-sm text-muted-foreground">
            {t("skillWizard_createdSuccess", { skillName })}
          </p>
        </div>

        <div class="flex gap-3">
          <Button variant="outline" onclick={createSkill}>{t("skillWizard_saveSkill")}</Button>
          <Button onclick={handleCancel}>{t("skillWizard_done")}</Button>
        </div>
      </div>
    {/if}
  </div>
</div>
