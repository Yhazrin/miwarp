# MiWarp Mobile — Design System

## Design Philosophy

MiWarp Mobile inherits the desktop's **Warp-inspired** visual language — a premium developer tool aesthetic that is:

- **Deep dark** — layered dark backgrounds creating depth
- **Glassmorphism** — frosted glass cards with subtle borders
- **Blue/cyan accent** — vibrant accent colors on dark surfaces
- **Compact metadata** — high information density, monospace metadata
- **Calm but powerful** — understated UI that lets content shine
- **Terminal-grade precision** — every pixel intentional

## Desktop → Mobile Token Mapping

### Background Hierarchy

| Token | Desktop CSS Variable | iOS/Android Value | Usage |
|-------|---------------------|-------------------|-------|
| bgDeepest | `--miwarp-bg-deepest` | HSL(220, 18%, 6%) | App background, nav bars |
| bgDeep | `--miwarp-bg-deep` | HSL(220, 16%, 9%) | Modal backgrounds |
| bgBase | `--miwarp-bg-base` | HSL(220, 14%, 12%) | Card backgrounds |
| bgElevated | `--miwarp-bg-elevated` | HSL(220, 12%, 15%) | Elevated surfaces |
| bgSurface | `--miwarp-bg-surface` | HSL(220, 10%, 18%) | Input fields, tool cards |
| bgHover | `--miwarp-bg-hover` | HSL(220, 10%, 21%) | Hover/pressed states |

**Light mode:**
| Token | Value |
|-------|-------|
| bgDeepest | HSL(0, 0%, 98%) |
| bgDeep | HSL(0, 0%, 96%) |
| bgBase | HSL(0, 0%, 100%) |
| bgSurface | HSL(210, 20%, 97%) |
| bgHover | HSL(210, 14%, 94%) |

### Glassmorphism

| Token | Dark Value | Light Value |
|-------|-----------|-------------|
| glassBg | HSL(220, 18%, 11%) @ 0.72 opacity | HSL(0, 0%, 100%) @ 0.85 opacity |
| glassBorder | HSL(220, 30%, 50%) @ 0.12 opacity | HSL(210, 20%, 75%) @ 0.30 opacity |
| glassBlur | 16px | 12px |

**Mobile implementation:**
- iOS: `UIVisualEffectView` with `.systemUltraThinMaterialDark` + custom tint, or solid color approximation
- Android: Custom `Modifier.background()` with alpha, or `BlurEffect` on API 31+

Note: Full backdrop-filter blur is expensive on mobile. Use solid semi-transparent backgrounds as the primary approach, with blur only on key surfaces (modals, sheets).

### Accent Colors

| Token | HSL | Hex (Dark) | Usage |
|-------|-----|------------|-------|
| accentPrimary | HSL(210, 100%, 60%) | #33A6FF | Primary actions, active states |
| accentCyan | HSL(185, 85%, 55%) | #20B2D9 | Secondary accent, gradients |
| accentBlue | HSL(199, 89%, 48%) | #2D9FD9 | Tertiary, info states |

**Gradient**: `linear-gradient(135deg, accentPrimary, accentCyan)` for accent borders and highlights.

### Text Hierarchy

| Token | Dark HSL | Light HSL | Usage |
|-------|----------|-----------|-------|
| textPrimary | HSL(0, 0%, 94%) | HSL(220, 18%, 12%) | Headings, primary content |
| textSecondary | HSL(220, 10%, 62%) | HSL(220, 10%, 42%) | Descriptions, metadata |
| textTertiary | HSL(220, 10%, 42%) | HSL(220, 10%, 55%) | Placeholders, disabled |

### Status Colors

| Token | HSL | Semantic |
|-------|-----|----------|
| statusSuccess | HSL(152, 55%, 55%) | Completed, passed |
| statusWarning | HSL(38, 80%, 55%) | Pending, needs attention |
| statusError | HSL(0, 72%, 60%) | Failed, rejected |
| statusRunning | HSL(217, 91%, 60%) | Active, running |
| statusDone | HSL(160, 84%, 39%) | Finished successfully |
| statusFailed | HSL(0, 72%, 51%) | Terminated with error |
| statusPending | HSL(38, 92%, 50%) | Queued, waiting |
| statusIdle | HSL(220, 9%, 64%) | Inactive, dormant |

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| spacing.xs | 4pt/dp | Tight gaps (icon-text) |
| spacing.sm | 8pt/dp | Component padding |
| spacing.md | 12pt/dp | Card padding |
| spacing.lg | 16pt/dp | Section gaps |
| spacing.xl | 20pt/dp | Large section dividers |
| spacing.2xl | 24pt/dp | Page margins |
| spacing.3xl | 32pt/dp | Major section spacing |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| radius.sm | 6pt/dp | Small elements (pills, tags) |
| radius.md | 8pt/dp | Buttons, inputs |
| radius.lg | 10pt/dp | Cards (base radius) |
| radius.xl | 14pt/dp | Large cards, modals |

### Typography

| Role | Font | Size | Weight |
|------|------|------|--------|
| Large Title | System sans | 28pt | Bold |
| Title | System sans | 20pt | Semibold |
| Headline | System sans | 17pt | Semibold |
| Body | System sans | 17pt | Regular |
| Callout | System sans | 16pt | Regular |
| Subheadline | System sans | 15pt | Regular |
| Footnote | System sans | 13pt | Regular |
| Caption | System sans | 12pt | Regular |
| Mono | Monospaced | 13pt | Regular |
| Mono Small | Monospaced | 11pt | Regular |

Monospaced font is used for: session IDs, file paths, run IDs, seq numbers, terminal output, diff content.

### Motion

| Token | Value | Usage |
|-------|-------|-------|
| motion.fast | 120ms | Micro-interactions |
| motion.normal | 180ms | Standard transitions |
| motion.slow | 280ms | Page transitions |
| ease.standard | cubic-bezier(0.2, 0, 0, 1) | Default easing |
| ease.emphasized | cubic-bezier(0.16, 1, 0.3, 1) | Spring-like, entrances |

### Shadows / Elevation

| Level | Value | Usage |
|-------|-------|-------|
| elevation-1 | 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2) | Cards at rest |
| elevation-2 | 0 4px 12px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.2) | Elevated cards |
| elevation-3 | 0 8px 24px rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.25) | Modals, sheets |

## Component Catalog

### MWGlassCard

The foundational card component.

**Properties:**
- `elevation`: 1-3 (default: 1)
- `accent`: Boolean — show left accent gradient border
- `interactive`: Boolean — hover/press states

**Visual:**
- Background: `glassBg` with opacity
- Border: 1px solid `glassBorder` with opacity
- Border radius: `radius.lg` (10pt/dp)
- Optional left border: 3-4pt gradient from accentPrimary to accentCyan

### MWStatusPill

A compact pill showing run status.

**States:**
- Running: blue bg, pulsing dot
- Idle: gray bg, static dot
- Completed: green bg, checkmark
- Failed: red bg, x-mark
- Waiting: amber bg, pulsing dot
- Stopped: dark red bg, square

**Visual:**
- Border radius: `radius.sm` (6pt/dp)
- Padding: 4pt/dp vertical, 8pt/dp horizontal
- Font: Mono, 11pt, medium weight
- Icon: 6pt/dp circle or SF Symbol / Material Icon

### MWSessionCard

Displays a session in the Session Hub list.

**Content:**
- Title (bold, textPrimary) — session name or prompt preview
- Subtitle (textSecondary) — cwd path, truncated
- Status pill (right-aligned)
- Metadata row: agent badge, model, message count, last activity time
- Indicators: approval pending (amber dot), files changed (blue dot), artifacts (purple dot)

**Visual:**
- Glass card background
- Padding: 12pt/dp
- Title: 16pt, semibold
- Metadata: 12pt, mono, textTertiary
- Tap → navigate to ChatView

### MWChatBubble

**User bubble:**
- Right-aligned
- Background: accentPrimary @ 0.15 opacity
- Border: 1px accentPrimary @ 0.2 opacity
- Text: textPrimary
- Max width: 85% of screen

**Assistant bubble:**
- Left-aligned
- Background: bgSurface
- Border: 1px glassBorder @ 0.1 opacity
- Text: textPrimary
- Max width: 90% of screen

**Both:**
- Border radius: 14pt/dp (rounded corners, smaller at arrow side)
- Padding: 10pt/dp vertical, 14pt/dp horizontal
- Font: 15pt regular for body text
- Code blocks: mono 13pt, bgDeepest background, 6pt radius

### MWToolCallCard

Collapsible card for tool invocations.

**Collapsed state:**
- Tool name (mono, accentPrimary)
- Status icon (running spinner / success check / error x)
- Brief input preview (1 line, textTertiary)

**Expanded state:**
- Full input (JSON, mono 13pt, syntax-colored)
- Full output (mono 13pt, bgDeepest background)
- Duration
- Copy button

**Visual:**
- Background: bgSurface
- Border: 1px glassBorder @ 0.1
- Border radius: 8pt/dp
- Left accent: 2pt accentPrimary

### MWApprovalCard

Permission prompt card.

**Content:**
- Warning icon (amber)
- Tool name and description
- Input preview (what the tool wants to do)
- "Dangerous" badge if flagged
- Buttons: "Allow Once", "Allow for Session", "Deny"
- Optional deny message input

**Visual:**
- Background: bgSurface with amber accent border (left)
- Border: 1px statusWarning @ 0.3
- Buttons: accentPrimary for allow, bgSurface for deny
- "Dangerous" tools: red accent border, stronger warning

### MWDiffFileRow

File change row in artifacts/diff view.

**Content:**
- File path (mono, truncated with ellipsis)
- Status badge: Added (green), Modified (amber), Deleted (red)
- Expandable diff preview

**Visual:**
- Background: bgBase
- Padding: 8pt/dp
- Status badge: 6pt radius, small mono text
- Diff preview: mono 13pt, added/removed color coding

### MWInputBar

Chat input area at bottom of ChatView.

**Content:**
- Multiline text field
- Send button (accentPrimary, disabled when empty)
- Stop button (statusError, shown when session running)
- Fork button (textSecondary)
- Quick prompt chips (horizontally scrollable)

**Visual:**
- Background: bgDeepest with glass overlay
- Border top: 1px glassBorder @ 0.1
- Input: bgSurface, 8pt radius, 12pt padding
- Chips: bgSurface, accentPrimary text, 6pt radius

### MWReconnectBanner

Shown when connection is lost.

**Content:**
- "Reconnecting..." with spinner
- Attempt count
- "Retry Now" button

**Visual:**
- Background: statusWarning @ 0.15
- Border: 1px statusWarning @ 0.3
- Position: top of screen, sliding in from top
- Animation: slide-down 280ms emphasized

## Dark/Light Mode

Both modes are fully supported. Default is dark.

**Mode switching:**
- Follows system appearance by default
- Can be overridden in mobile settings
- All tokens have both dark and light values
- Glass effects are lighter in light mode (higher opacity, less blur)

## Platform Adaptations

### iOS-Specific

- Use SF Symbols for icons
- Native iOS navigation patterns (NavigationStack)
- iOS-style sheets and alerts
- Haptic feedback for key interactions
- Respect Dynamic Type for accessibility

### Android-Specific

- Use Material Icons (outlined style)
- Material 3 navigation (NavigationBar)
- Android-style bottom sheets and dialogs
- Respect system font scale
- Edge-to-edge with transparent status/nav bars

### Shared

- Same color tokens
- Same spacing scale
- Same typography scale
- Same component semantics
- Same information density
- Same glassmorphism approach (platform-adapted)
