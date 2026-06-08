# Bits UI Integration Guide

## 概述

Bits UI 是 MiWarp 的 headless UI 基础设施，提供 Dialog、Popover、Select、DropdownMenu、Tooltip、Tabs、Command、ContextMenu 等交互 primitives。

**核心规则**：业务组件不得直接 `import { ... } from "bits-ui"`。所有 bits-ui 引用必须通过 `src/lib/ui/*` 封装。

## 已封装的 Wrapper 组件

| Wrapper | 路径 | 用途 |
|---------|------|------|
| `MiPopover` | `src/lib/ui/MiPopover.svelte` | 浮层面板（模型菜单、上下文详情） |
| `MiDialog` | `src/lib/ui/MiDialog.svelte` | 模态对话框（设置、关于、命令面板） |
| `MiSelect` | `src/lib/ui/MiSelect.svelte` | 下拉选择器（权限模式、可见性级别） |
| `MiTooltip` | `src/lib/ui/MiTooltip.svelte` | 工具提示 |
| `MiDropdownMenu` | `src/lib/ui/MiDropdownMenu.svelte` | 下拉菜单（右键菜单、操作菜单） |
| `MiAlertDialog` | `src/lib/ui/MiAlertDialog.svelte` | 危险操作确认（删除、重置） |
| `MiTabs` | `src/lib/ui/MiTabs.svelte` | 选项卡（Inspector、设置、右侧面板） |

## 导入方式

```svelte
<!-- 简单场景：直接从 $lib/ui 导入 -->
<script>
  import { MiPopover, MiDialog, MiTooltip, MiAlertDialog, MiTabs } from "$lib/ui";
</script>

<!-- Select 自定义 item 渲染场景 -->
<script>
  import MiSelect from "$lib/ui/MiSelect.svelte";
  import { Select } from "$lib/ui/select-primitives";
</script>
```

## MiSelect 使用模式

### 简单模式（items 数组）

```svelte
<MiSelect
  bind:value
  items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]}
  onValueChange={(v) => handleChange(v)}
/>
```

### 自定义模式（children snippet + Select.Item）

```svelte
<MiSelect bind:value bind:open items={selectItems} contentClass="w-[200px]">
  {#snippet trigger({ props })}
    <button {...props} type="button" class="my-trigger-class">
      {currentLabel}
    </button>
  {/snippet}
  {#each options as opt (opt.value)}
    <Select.Item value={opt.value} label={opt.label} class="my-item-class">
      {#snippet children({ selected })}
        {#if selected}<Icon name="check" />{/if}
        <span>{opt.label}</span>
      {/snippet}
    </Select.Item>
  {/each}
</MiSelect>
```

## 已迁移的业务组件

| 组件 | 原依赖 | 迁移后 |
|------|--------|--------|
| `PermissionModePicker` | `Select` from bits-ui | `MiSelect` + `Select.Item` from select-primitives |
| `ProcessVisibilityPicker` | `Select` from bits-ui | `MiSelect` + `Select.Item` from select-primitives |
| `StatusBarModelMenu` | `Popover` from bits-ui | `MiPopover` |
| `ContextIndicator` | `Popover` from bits-ui | `MiPopover` |
| `MiConfirmDialog` | `./MiDialog.svelte` (已删除) | `$lib/ui/MiDialog.svelte` |

## 已使用 Wrapper 的组件（未改动）

| 组件 | 使用的 Wrapper |
|------|---------------|
| `AboutModal` | `MiDialog` |
| `CommandPalette` | `MiDialog` |
| `Modal` | `MiDialog` |
| `ShortcutHelpPanel` | `MiDialog` |
| `SkillPreviewDialog` | `MiDialog` |
| `AuthSourceBadge` | `MiPopover` |
| `ModelSelector` | `MiPopover` |
| `SkillSelector` | `MiPopover` |

## 移动端连接流程组件

基于 wrapper 构建的桌面端移动连接管理组件：

| 组件 | 路径 | 用途 |
|------|------|------|
| `MobilePairingSheet` | `src/lib/components/mobile/MobilePairingSheet.svelte` | QR 配对弹窗 |
| `MobileConnectionDialog` | `src/lib/components/mobile/MobileConnectionDialog.svelte` | 完整连接流程 |
| `MobileServerPicker` | `src/lib/components/mobile/MobileServerPicker.svelte` | 远程主机选择 |
| `MobileConnectionDiagnosticsDialog` | `src/lib/components/mobile/MobileConnectionDiagnosticsDialog.svelte` | 连接诊断 |

所有移动端组件均使用 MiDialog/MiSelect/MiTabs wrapper，确保：
- 窄屏不溢出（`max-w-sm`/`w-[min(...,calc(100vw-32px))]`）
- 键盘导航（Tab/Esc）正常
- 焦点陷阱由 bits-ui Dialog 自动管理

## 暂不迁移的组件

- **Settings 页面内部组件**：大量表单控件，暂无 bits-ui 依赖
- **Chat Timeline 组件**：纯渲染，不涉及交互 primitives
- **Terminal 组件**：xterm.js 封装，不涉及 bits-ui

## Surface Token 体系

所有 wrapper 使用 `src/lib/ui/miwarp-surfaces.ts` 中定义的 CSS 类：

| Token | 用途 |
|-------|------|
| `MIWARP_POPOVER_CONTENT_CLASS` | Popover/Select 下拉面板 |
| `MIWARP_STATUSBAR_MENU_CLASS` | 状态栏二级菜单 |
| `MIWARP_DETAIL_POPOVER_CLASS` | 详情浮层（上下文 %） |
| `MIWARP_MENU_PANEL_CLASS` | 紧凑菜单（认证、设置） |
| `MIWARP_SELECT_ITEM_CLASS` | Select 选项行 |
| `MIWARP_DIALOG_*` | Dialog 各尺寸 |

## 后续迁移规则

1. **新增 UI 交互**：必须使用 `src/lib/ui/*` wrapper，不得直接 import bits-ui
2. **新增 wrapper**：只在 `src/lib/ui/` 下创建，使用 miwarp-surfaces token
3. **高级自定义**：需要 bits-ui 子组件时，通过 `select-primitives.ts` 模式重导出
4. **PR 检查**：`grep -r "from.*bits-ui" src/ --include="*.svelte" | grep -v "src/lib/ui/"` 应为空
