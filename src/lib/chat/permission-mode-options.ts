import type { LucideIconName } from "$lib/lucide-icon";
import type { MessageKey } from "$lib/i18n/types";

export type PermissionModeOption = {
  value: string;
  icon: LucideIconName;
  labelKey: MessageKey;
  shortLabelKey: MessageKey;
  descKey: MessageKey;
  cls: string;
};

export const PERMISSION_MODE_OPTIONS: PermissionModeOption[] = [
  {
    value: "default",
    icon: "hand",
    labelKey: "prompt_permAskLabel",
    shortLabelKey: "prompt_permAskShort",
    descKey: "prompt_permAskDesc",
    cls: "text-foreground/70",
  },
  {
    value: "acceptEdits",
    icon: "check-square",
    labelKey: "prompt_permAutoReadLabel",
    shortLabelKey: "prompt_permAutoReadShort",
    descKey: "prompt_permAutoReadDesc",
    cls: "text-miwarp-status-info",
  },
  {
    value: "bypassPermissions",
    icon: "shield",
    labelKey: "prompt_permAutoAllLabel",
    shortLabelKey: "prompt_permAutoAllShort",
    descKey: "prompt_permAutoAllDesc",
    cls: "text-miwarp-status-warning",
  },
  {
    value: "plan",
    icon: "clipboard-list",
    labelKey: "prompt_permPlanLabel",
    shortLabelKey: "prompt_permPlanShort",
    descKey: "prompt_permPlanDesc",
    cls: "text-miwarp-accent-violet",
  },
  {
    value: "auto",
    icon: "bot",
    labelKey: "prompt_permAutoLabel",
    shortLabelKey: "prompt_permAutoShort",
    descKey: "prompt_permAutoDesc",
    cls: "text-miwarp-status-info",
  },
  {
    value: "dontAsk",
    icon: "lock",
    labelKey: "prompt_permDontAskLabel",
    shortLabelKey: "prompt_permDontAskShort",
    descKey: "prompt_permDontAskDesc",
    cls: "text-miwarp-status-error",
  },
];

export function resolvePermissionMode(mode: string): PermissionModeOption {
  return PERMISSION_MODE_OPTIONS.find((m) => m.value === mode) ?? PERMISSION_MODE_OPTIONS[0];
}
