<script lang="ts">
  /**
   * Step Editor Component
   *
   * Edit individual automation step parameters.
   */
  import { t } from "$lib/i18n/index.svelte";
  import {
    STEP_TYPES,
    getStepTypeInfo,
    type AutomationStep,
    type StepType,
  } from "$lib/types/automation";

  interface Props {
    step: AutomationStep;
    onUpdate: (step: AutomationStep) => void;
  }

  let { step, onUpdate }: Props = $props();

  // Step type info
  const stepInfo = $derived(getStepTypeInfo(step.type));

  // Handle type change
  function handleTypeChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const newType = target.value as StepType;
    onUpdate({
      ...step,
      type: newType,
      params: {}, // Reset params when type changes
    });
  }

  // Handle param change
  function handleParamChange(key: string, value: unknown) {
    onUpdate({
      ...step,
      params: {
        ...step.params,
        [key]: value,
      },
    });
  }

  // Handle description change
  function handleDescriptionChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({
      ...step,
      description: target.value,
    });
  }

  // Handle timeout change
  function handleTimeoutChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({
      ...step,
      timeout: parseInt(target.value) || undefined,
    });
  }

  // Handle onError change
  function handleOnErrorChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    onUpdate({
      ...step,
      onError: target.value as AutomationStep["onError"],
    });
  }

  // Handle enabled toggle
  function handleEnabledChange(e: Event) {
    const target = e.target as HTMLInputElement;
    onUpdate({
      ...step,
      enabled: target.checked,
    });
  }

  // Param field component based on type
  function _getParamInputType(key: string): "text" | "number" | "checkbox" {
    switch (key) {
      case "duration":
      case "scrollAmount":
      case "timeout":
      case "tabId":
      case "index":
        return "number";
      case "enabled":
        return "checkbox";
      default:
        return "text";
    }
  }
</script>

<div class="step-editor space-y-4">
  <!-- Header -->
  <div class="flex items-center gap-3">
    <span class="text-2xl">{stepInfo.icon}</span>
    <div>
      <h3 class="text-sm font-medium">{stepInfo.label}</h3>
      <p class="text-xs text-muted-foreground">{stepInfo.description}</p>
    </div>
  </div>

  <!-- Step Type -->
  <div class="space-y-1.5">
    <span class="text-xs font-medium text-muted-foreground">{t("stepEditor_stepType")}</span>
    <select
      value={step.type}
      onchange={handleTypeChange}
      class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {#each STEP_TYPES as type}
        <option value={type.value}>
          {type.icon}
          {type.label} - {type.labelZh}
        </option>
      {/each}
    </select>
  </div>

  <!-- Description -->
  <div class="space-y-1.5">
    <span class="text-xs font-medium text-muted-foreground">{t("stepEditor_description")}</span>
    <input
      type="text"
      value={step.description}
      oninput={handleDescriptionChange}
      class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      placeholder={t("stepEditor_descriptionPlaceholder")}
    />
  </div>

  <!-- Parameters -->
  <div class="space-y-3">
    <span class="text-xs font-medium text-muted-foreground">{t("stepEditor_parameters")}</span>

    <div class="rounded-lg border bg-card p-3 space-y-3">
      {#if step.type === "navigate"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_url")}</span>
          <input
            type="text"
            value={step.params.url ?? ""}
            oninput={(e) => handleParamChange("url", (e.target as HTMLInputElement).value)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="https://example.com"
          />
        </div>
      {:else if step.type === "click" || step.type === "double_click" || step.type === "right_click" || step.type === "hover"}
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <span class="text-xs text-muted-foreground">{t("stepEditor_coordX")}</span>
            <input
              type="number"
              value={step.params.coordinate?.[0] ?? ""}
              oninput={(e) => {
                const x = parseInt((e.target as HTMLInputElement).value) || 0;
                const y = step.params.coordinate?.[1] ?? 0;
                handleParamChange("coordinate", [x, y]);
              }}
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="500"
            />
          </div>
          <div class="space-y-1.5">
            <span class="text-xs text-muted-foreground">{t("stepEditor_coordY")}</span>
            <input
              type="number"
              value={step.params.coordinate?.[1] ?? ""}
              oninput={(e) => {
                const x = step.params.coordinate?.[0] ?? 0;
                const y = parseInt((e.target as HTMLInputElement).value) || 0;
                handleParamChange("coordinate", [x, y]);
              }}
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="300"
            />
          </div>
        </div>
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_elementRef")}</span>
          <input
            type="text"
            value={step.params.ref ?? ""}
            oninput={(e) => handleParamChange("ref", (e.target as HTMLInputElement).value)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="ref_1"
          />
        </div>
      {:else if step.type === "type"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_text")}</span>
          <textarea
            value={step.params.text ?? ""}
            oninput={(e) => handleParamChange("text", (e.target as HTMLTextAreaElement).value)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            rows="3"
            placeholder="Text to type..."
          ></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <span class="text-xs text-muted-foreground">X</span>
            <input
              type="number"
              value={step.params.coordinate?.[0] ?? ""}
              oninput={(e) => {
                const x = parseInt((e.target as HTMLInputElement).value) || 0;
                const y = step.params.coordinate?.[1] ?? 0;
                handleParamChange("coordinate", [x, y]);
              }}
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="500"
            />
          </div>
          <div class="space-y-1.5">
            <span class="text-xs text-muted-foreground">Y</span>
            <input
              type="number"
              value={step.params.coordinate?.[1] ?? ""}
              oninput={(e) => {
                const x = step.params.coordinate?.[0] ?? 0;
                const y = parseInt((e.target as HTMLInputElement).value) || 0;
                handleParamChange("coordinate", [x, y]);
              }}
              class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="300"
            />
          </div>
        </div>
      {:else if step.type === "wait"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_duration")}</span>
          <input
            type="number"
            value={step.params.duration ?? 1000}
            oninput={(e) =>
              handleParamChange("duration", parseInt((e.target as HTMLInputElement).value) || 1000)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="1000"
          />
        </div>
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_condition")}</span>
          <select
            value={step.params.condition ?? "timeout"}
            onchange={(e) => handleParamChange("condition", (e.target as HTMLSelectElement).value)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="timeout">{t("stepEditor_conditionTimeout")}</option>
            <option value="element_visible">{t("stepEditor_conditionElement")}</option>
            <option value="network_idle">{t("stepEditor_conditionNetwork")}</option>
          </select>
        </div>
      {:else if step.type === "scroll"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_direction")}</span>
          <select
            value={step.params.direction ?? "down"}
            onchange={(e) => handleParamChange("direction", (e.target as HTMLSelectElement).value)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="up">{t("stepEditor_dirUp")}</option>
            <option value="down">{t("stepEditor_dirDown")}</option>
            <option value="left">{t("stepEditor_dirLeft")}</option>
            <option value="right">{t("stepEditor_dirRight")}</option>
          </select>
        </div>
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_scrollAmount")}</span>
          <input
            type="number"
            value={step.params.scrollAmount ?? 3}
            oninput={(e) =>
              handleParamChange(
                "scrollAmount",
                parseInt((e.target as HTMLInputElement).value) || 3,
              )}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      {:else if step.type === "screenshot"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_options")}</span>
          <div class="flex items-center gap-2">
            <input
              type="checkbox"
              id="fullPage"
              checked={step.params.fullPage ?? false}
              onchange={(e) =>
                handleParamChange("fullPage", (e.target as HTMLInputElement).checked)}
              class="h-4 w-4 rounded border-border"
            />
            <label for="fullPage" class="text-sm">{t("stepEditor_fullPage")}</label>
          </div>
        </div>
      {:else if step.type === "find"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_query")}</span>
          <input
            type="text"
            value={step.params.query ?? ""}
            oninput={(e) => handleParamChange("query", (e.target as HTMLInputElement).value)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="search bar, login button, etc."
          />
        </div>
      {:else if step.type === "execute_js"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_javaScript")}</span>
          <textarea
            value={step.params.script ?? ""}
            oninput={(e) => handleParamChange("script", (e.target as HTMLTextAreaElement).value)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            rows="6"
            placeholder="// Your JavaScript code..."
          ></textarea>
        </div>
      {:else if step.type === "switch_tab"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_tabIndex")}</span>
          <input
            type="number"
            value={step.params.tabId ?? 0}
            oninput={(e) =>
              handleParamChange("tabId", parseInt((e.target as HTMLInputElement).value) || 0)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="0"
          />
        </div>
      {:else if step.type === "drag_drop"}
        <div class="space-y-3">
          <div class="text-xs font-medium text-muted-foreground">{t("stepEditor_startPos")}</div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <span class="text-xs text-muted-foreground">{t("stepEditor_startX")}</span>
              <input
                type="number"
                value={step.params.startCoordinate?.[0] ?? ""}
                oninput={(e) => {
                  const x = parseInt((e.target as HTMLInputElement).value) || 0;
                  const y = step.params.startCoordinate?.[1] ?? 0;
                  handleParamChange("startCoordinate", [x, y]);
                }}
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div class="space-y-1.5">
              <span class="text-xs text-muted-foreground">{t("stepEditor_startY")}</span>
              <input
                type="number"
                value={step.params.startCoordinate?.[1] ?? ""}
                oninput={(e) => {
                  const x = step.params.startCoordinate?.[0] ?? 0;
                  const y = parseInt((e.target as HTMLInputElement).value) || 0;
                  handleParamChange("startCoordinate", [x, y]);
                }}
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div class="text-xs font-medium text-muted-foreground">{t("stepEditor_endPos")}</div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <span class="text-xs text-muted-foreground">{t("stepEditor_endX")}</span>
              <input
                type="number"
                value={step.params.endCoordinate?.[0] ?? ""}
                oninput={(e) => {
                  const x = parseInt((e.target as HTMLInputElement).value) || 0;
                  const y = step.params.endCoordinate?.[1] ?? 0;
                  handleParamChange("endCoordinate", [x, y]);
                }}
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div class="space-y-1.5">
              <span class="text-xs text-muted-foreground">{t("stepEditor_endY")}</span>
              <input
                type="number"
                value={step.params.endCoordinate?.[1] ?? ""}
                oninput={(e) => {
                  const x = step.params.endCoordinate?.[0] ?? 0;
                  const y = parseInt((e.target as HTMLInputElement).value) || 0;
                  handleParamChange("endCoordinate", [x, y]);
                }}
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>
      {:else if step.type === "upload_file"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_filePath")}</span>
          <input
            type="text"
            value={step.params.filePath ?? ""}
            oninput={(e) => handleParamChange("filePath", (e.target as HTMLInputElement).value)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="/path/to/file.png"
          />
        </div>
      {:else if step.type === "select_option"}
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_elementRefRequired")}</span>
          <input
            type="text"
            value={step.params.ref ?? ""}
            oninput={(e) => handleParamChange("ref", (e.target as HTMLInputElement).value)}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="select#dropdown"
          />
        </div>
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">{t("stepEditor_valueOrIndex")}</span>
          <input
            type="text"
            value={step.params.value ?? String(step.params.index ?? "")}
            oninput={(e) => {
              const val = (e.target as HTMLInputElement).value;
              handleParamChange("value", val);
            }}
            class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="option value or index number"
          />
        </div>
      {:else}
        <div class="text-sm text-muted-foreground">
          {t("stepEditor_noParams")}
        </div>
      {/if}
    </div>
  </div>

  <!-- Advanced Options -->
  <div class="space-y-3">
    <span class="text-xs font-medium text-muted-foreground">{t("stepEditor_advanced")}</span>

    <div class="rounded-lg border bg-card p-3 space-y-3">
      <!-- Timeout -->
      <div class="space-y-1.5">
        <span class="text-xs text-muted-foreground">{t("stepEditor_timeout")}</span>
        <input
          type="number"
          value={step.timeout ?? 30000}
          oninput={handleTimeoutChange}
          class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="30000"
        />
      </div>

      <!-- On Error -->
      <div class="space-y-1.5">
        <span class="text-xs text-muted-foreground">{t("stepEditor_onError")}</span>
        <select
          value={step.onError}
          onchange={handleOnErrorChange}
          class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="continue">{t("stepEditor_onErrorContinue")}</option>
          <option value="stop">{t("stepEditor_onErrorStop")}</option>
          <option value="retry">{t("stepEditor_onErrorRetry")}</option>
        </select>
      </div>

      <!-- Enabled -->
      <div class="flex items-center gap-2">
        <input
          type="checkbox"
          id="stepEnabled"
          checked={step.enabled}
          onchange={handleEnabledChange}
          class="h-4 w-4 rounded border-border"
        />
        <label for="stepEnabled" class="text-sm">{t("stepEditor_enabled")}</label>
      </div>
    </div>
  </div>
</div>
