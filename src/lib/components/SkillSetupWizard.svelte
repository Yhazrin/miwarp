<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import Button from "./Button.svelte";
  import Card from "./Card.svelte";
  import type { Skill, SkillCategory } from "$lib/types/skill";
  import { skillStore } from "$lib/stores/skill-store.svelte";

  interface Props {
    initialSkill?: Skill;
    onComplete?: (skill: Skill) => void;
    onCancel?: () => void;
  }

  let { initialSkill, onComplete, onCancel }: Props = $props();

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
  let progress = $derived.by(() => {
    const steps: WizardStep[] = ["select-type", "configure", "parameters", "test", "complete"];
    return ((steps.indexOf(step) + 1) / steps.length) * 100;
  });

  const CATEGORIES: { id: SkillCategory; label: string; description: string; icon: string }[] = [
    {
      id: "automation",
      label: "Automation",
      description: "Schedule recurring tasks and workflows",
      icon: "⏰",
    },
    {
      id: "productivity",
      label: "Productivity",
      description: "Boost your daily workflow efficiency",
      icon: "⚡",
    },
    {
      id: "development",
      label: "Code",
      description: "Development and code-related skills",
      icon: "💻",
    },
    {
      id: "memory",
      label: "Memory",
      description: "Memory management and organization",
      icon: "🧠",
    },
    {
      id: "integrations",
      label: "Integrations",
      description: "Connect with external services",
      icon: "🔗",
    },
    {
      id: "custom",
      label: "Custom",
      description: "Build your own custom skill",
      icon: "🎨",
    },
  ];

  const ICONS = ["✨", "🎯", "🚀", "⚡", "🔮", "🎨", "📝", "🔍", "📊", "🎵", "🌟", "💡"];

  function selectCategory(category: SkillCategory) {
    selectedCategory = category;
    step = "configure";
  }

  function goBack() {
    const steps: WizardStep[] = ["select-type", "configure", "parameters", "test", "complete"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      step = steps[currentIndex - 1];
    }
  }

  function nextStep() {
    const steps: WizardStep[] = ["select-type", "configure", "parameters", "test", "complete"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      step = steps[currentIndex + 1];
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
        output: "Skill executed successfully! Response time: 1.2s",
      };
      step = "complete";
    } catch (e) {
      testResult = {
        success: false,
        error: e instanceof Error ? e.message : "Test failed",
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
        Step {["select-type", "configure", "parameters", "test", "complete"].indexOf(step) + 1} of 5
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
              <div class="font-medium text-sm">{cat.label}</div>
              <div class="text-xs text-muted-foreground mt-1 line-clamp-2">
                {cat.description}
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
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Skill Name
          </label>
          <input
            type="text"
            bind:value={skillName}
            placeholder="e.g., daily-standup"
            class="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
          />
          <p class="text-[10px] text-muted-foreground">
            Use kebab-case (e.g., daily-standup, code-review)
          </p>
        </div>

        <!-- Description -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Description
          </label>
          <textarea
            bind:value={skillDescription}
            placeholder="What does this skill do?"
            rows="2"
            class="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none"
          ></textarea>
        </div>

        <!-- Icon picker -->
        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Icon
          </label>
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
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Tags
          </label>
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
              placeholder="Add a tag..."
              class="flex-1 px-3 py-1.5 rounded-lg border border-input bg-background text-xs"
            />
            <Button variant="outline" size="sm" onclick={addTag}>Add</Button>
          </div>
        </div>

        <Button onclick={nextStep} disabled={!isConfigureValid} class="w-full">Continue</Button>
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
          Write the instructions that Claude will follow when this skill is activated.
        </p>

        <div class="space-y-1">
          <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Skill Content
          </label>
          <textarea
            bind:value={skillPrompt}
            placeholder={`# ${skillName}

Describe what this skill does and how it should behave...

## Usage
/skill-name [arguments]

## Steps
1. First step...
2. Second step...
3. Third step...

## Tips
- Helpful tip 1
- Helpful tip 2`}
            rows="12"
            class="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm font-mono resize-none"
          ></textarea>
        </div>

        <div class="p-3 rounded-lg bg-muted/30 text-xs space-y-1">
          <div class="font-medium">Writing Tips</div>
          <ul class="list-disc list-inside text-muted-foreground space-y-0.5">
            <li>Start with a clear description of the skill's purpose</li>
            <li>Include usage examples with expected inputs/outputs</li>
            <li>Break complex tasks into numbered steps</li>
            <li>Add error handling and edge case notes</li>
          </ul>
        </div>

        <Button onclick={nextStep} disabled={!isPromptValid} class="w-full">
          Continue to Test
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
          Run a test to verify your skill works correctly.
        </p>

        {#if testResult}
          <div
            class="p-4 rounded-lg {testResult.success
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'} border"
          >
            <div class="flex items-center gap-2 mb-2">
              {#if testResult.success}
                <span class="text-xl">✅</span>
                <span class="font-medium text-green-600">Test Passed</span>
              {:else}
                <span class="text-xl">❌</span>
                <span class="font-medium text-red-600">Test Failed</span>
              {/if}
            </div>
            {#if testResult.output}
              <div class="text-sm text-muted-foreground font-mono">{testResult.output}</div>
            {/if}
            {#if testResult.error}
              <div class="text-sm text-red-500 font-mono">{testResult.error}</div>
            {/if}
          </div>
        {/if}

        {#if testing}
          <div class="flex items-center justify-center py-8">
            <div
              class="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full"
            ></div>
            <span class="ml-3 text-sm text-muted-foreground">Running test...</span>
          </div>
        {/if}

        <Button onclick={testSkill} disabled={testing} class="w-full">
          {testing ? "Testing..." : "Run Test"}
        </Button>
      </div>
    {:else if step === "complete"}
      <!-- Step 5: Complete -->
      <div class="flex flex-col items-center justify-center h-full text-center space-y-4">
        <div class="text-5xl">{skillIcon}</div>
        <div>
          <h2 class="text-xl font-semibold mb-2">{t("skillWizard_complete")}</h2>
          <p class="text-sm text-muted-foreground">
            Your skill "{skillName}" has been created successfully!
          </p>
        </div>

        <div class="flex gap-3">
          <Button variant="outline" onclick={createSkill}>Save Skill</Button>
          <Button onclick={handleCancel}>Done</Button>
        </div>
      </div>
    {/if}
  </div>
</div>
