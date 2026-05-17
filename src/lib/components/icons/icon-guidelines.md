# MiWarp Icon Guidelines

MiWarp uses a three-layer icon strategy for a consistent, lightweight desktop workbench aesthetic.

## Icon Libraries

| Layer | Library | Purpose |
|-------|---------|---------|
| Primary | Lucide | All UI icons: sidebar, toolbar, buttons, navigation, status |
| Supplemental | Tabler | Specialized technical icons: MCP, hooks, workflows, automation |
| Empty State | Phosphor | Large illustrations only: empty states, onboarding |

## Core Rules

1. **Business components MUST use `Icon.svelte`** — never import icon libraries directly outside `icon-map.ts`
2. **Do not use emoji as functional icons**
3. **Do not add inline SVG** unless it is a brand logo or special illustration
4. **Use semantic names from `icon-map.ts`** — not library-specific names

## Default Sizes

| Context | Size | Stroke Width |
|---------|------|-------------|
| Navigation/Sidebar icon | 18px | 1.8 |
| Small button icon | 16px | 1.8 |
| Top capsule icon | 15-16px | 1.8 |
| Right panel tab icon | 17-18px | 1.8 |
| Large card icon | 22-24px | 1.6 |
| Empty state icon | 32-44px | Phosphor regular |

## Icon Map Usage

```svelte
<script>
  import Icon from "$lib/components/icons/Icon.svelte";
</script>

<!-- Basic usage -->
<Icon name="settings" />

<!-- With size -->
<Icon name="clock" size={16} />

<!-- Empty state (Phosphor) -->
<Icon name="emptyTasks" size={40} variant="empty" />

<!-- With custom class -->
<Icon name="plugin" class="text-muted-foreground" />

<!-- With aria-label for accessibility -->
<Icon name="notification" ariaLabel="Notifications" />
```

## Adding New Icons

1. Add the icon to `icon-map.ts` with the appropriate variant
2. Use a semantic name (e.g., `settings`, not `gear`)
3. For supplement/empty variants, include a `reason` explaining why that library was chosen
4. Import the icon component at the top of `icon-map.ts`
5. Export it in the `iconMap` object

## Icon Sources

### Lucide (Primary)
Lucide is the default for all UI icons. Import from `lucide-svelte`.

```ts
import { Settings, Home, Search } from "lucide-svelte";
```

### Tabler (Supplemental)
Use Tabler only when Lucide lacks a suitable icon or the Tabler version is significantly better.

```ts
import { IconTopologyComplex, IconWebhook } from "@tabler/icons-svelte";
```

Current Tabler icons in use:
- `mcp` → `IconTopologyComplex` (API/MCP topology)
- `hook` → `IconWebhook` (webhook symbol)
- `workflow` → `IconRouteAltLeft` (automation routing)
- `automation` → `IconSettingsAutomation` (automation settings)
- `marketplace` → `IconApps` (app grid/marketplace)

### Phosphor (Empty State Only)
Use Phosphor only for large empty-state illustrations.

```ts
import { CalendarBlank, Sparkle } from "phosphor-svelte";
```

Current Phosphor icons in use:
- `emptyTasks` → `CalendarBlank` (empty task list)
- `emptyPlugins` → `PhosphorPackage` (empty plugins)
- `emptySearch` → `MagnifyingGlass` (no search results)
- `emptyFolder` → `PhosphorFolderOpen` (empty folder)
- `emptyState` → `Sparkle` (general empty state)

## What NOT To Do

- ❌ Don't use `lucide-svelte` imports outside `icon-map.ts`
- ❌ Don't use `lucide-svelte` directly in components
- ❌ Don't use emoji (😀, 🔧, etc.) as icons
- ❌ Don't mix filled and outline styles
- ❌ Don't use Heroicons, FontAwesome, or Material Icons
- ❌ Don't add inline SVG in components (except brand logos)

## Migration Path

When replacing existing icons:

1. Identify the semantic purpose of the icon
2. Find the corresponding name in `icon-map.ts`
3. Replace `<svg>...</svg>` with `<Icon name="..." />`
4. Adjust size/stroke to match the guidelines above
5. Do NOT change colors, hover states, or layout

## Accessibility

- All icons should be `aria-hidden="true"` by default (decorative)
- If an icon is the only content of a button, provide `aria-label`
- Icons inherit text color via `currentColor`
