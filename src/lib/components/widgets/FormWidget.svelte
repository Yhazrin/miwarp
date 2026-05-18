<script lang="ts">
  import { ArrowRight, Send } from "lucide-svelte";

  interface Field {
    name: string;
    label: string;
    placeholder?: string;
    type?: "text" | "email" | "password" | "number";
    required?: boolean;
    options?: string[];
  }

  interface FormData {
    title?: string;
    description?: string;
    fields?: Field[];
    submitLabel?: string;
  }

  let {
    data,
    onAction,
  }: {
    data: FormData;
    onAction?: (data: Record<string, string>) => void;
  } = $props();

  const fields = $derived(data.fields || []);
  const submitLabel = $derived(data.submitLabel || "Submit");

  let values = $state<Record<string, string>>({});

  function handleSubmit() {
    onAction?.(values);
  }

  function handleInput(name: string, value: string) {
    values[name] = value;
  }
</script>

<div class="form-widget rounded-lg border border-border bg-muted/20 p-4">
  {#if data.title}
    <h3 class="mb-2 text-sm font-semibold">{data.title}</h3>
  {/if}

  {#if data.description}
    <p class="mb-4 text-xs text-muted-foreground">{data.description}</p>
  {/if}

  <div class="space-y-3">
    {#each fields as field}
      <div class="space-y-1">
        <label for={field.name} class="text-xs font-medium">
          {field.label}
          {#if field.required}
            <span class="text-red-500">*</span>
          {/if}
        </label>

        {#if field.options && field.options.length > 0}
          <select
            id={field.name}
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            onchange={(e) => handleInput(field.name, e.currentTarget.value)}
          >
            <option value="">Select...</option>
            {#each field.options as option}
              <option value={option}>{option}</option>
            {/each}
          </select>
        {:else}
          <input
            type={field.type || "text"}
            id={field.name}
            placeholder={field.placeholder}
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            oninput={(e) => handleInput(field.name, e.currentTarget.value)}
          />
        {/if}
      </div>
    {/each}
  </div>

  <button
    onclick={handleSubmit}
    class="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
  >
    <Send class="h-4 w-4" />
    {submitLabel}
  </button>
</div>
