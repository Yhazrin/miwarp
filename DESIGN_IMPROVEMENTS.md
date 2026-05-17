# MiWarp Design Improvement Report

Based on Claude Code CLI Design Patterns

## Executive Summary

This report analyzes Claude Code's CLI design patterns and provides actionable recommendations for improving MiWarp's user experience and interaction design. MiWarp already has a solid foundation with its composable architecture and Svelte 5 reactive state management. The recommendations below focus on enhancing the chat experience, improving code context awareness, and streamlining common workflows.

---

## Part 1: Current Architecture Assessment

### Strengths

**Composable Pattern**
MiWarp uses Svelte 5 composables extensively: `useSlashMenu`, `useAtMention`, `useFileHandling`, `useChatScroll`, `useTeamDispatch`, `useProjectPreload`. This is a clean separation of concerns that makes components modular and testable.

**Session Singleton Pattern**
The `chat-page-singletons.ts` prevents unnecessary re-initialization when navigating between routes. This is excellent for maintaining session state.

**Transport Abstraction**
The `getTransport()` abstraction layer supports both Tauri IPC and WebSocket, enabling browser-based access.

**Component Architecture**
108+ components with clear responsibilities: `PromptInput`, `ToolActivity`, `Sidebar`, `CommandPalette`, `ChatMessage`, etc.

---

## Part 2: Design Improvements

### 2.1 Enhanced Prompt Autocomplete

**Current State:**
Slash commands are detected with `/` and provide enum/free-text selection. File attachments support drag-drop.

**Recommendation: Context-Aware Autocomplete**

```typescript
// src/lib/prompt/use-context-aware-autocomplete.svelte.ts

interface AutocompleteContext {
  cursorInCode: boolean;
  cursorInString: boolean;
  nearestFile: string | null;
  nearestFunction: string | null;
  gitStatus: 'clean' | 'dirty' | 'untracked';
  recentFiles: string[];
}

export function useContextAwareAutocomplete(opts: {
  store: PromptInputStore;
  onContextDetected: (ctx: AutocompleteContext) => void;
}) {
  // Detect when cursor is inside code blocks, strings, function names
  // Suggest relevant completions: file paths, function names, git commands
}
```

**Key Features:**
1. Detect if cursor is inside code block (``` or indentation)
2. Provide file path autocompletion with fuzzy matching
3. Suggest function/class names from project
4. Show git status hint when relevant (e.g., "3 uncommitted changes")

---

### 2.2 Inline Diff Preview

**Current State:**
Diffs are shown in modal dialogs via `DiffModal.svelte`.

**Recommendation: Inline Unified Diff View**

Instead of a modal, show an inline diff view below the tool result:

```
┌─ src/utils/format.ts ───────────────────────┐
│ - export function formatDate(date: Date) {   │
│ + export function formatDate(date: Date |    │
│     string): string {                       │
│     const d = typeof date === 'string'      │
│       ? new Date(date) : date;             │
└─────────────────────────────────────────────┘
```

This is less disruptive than a modal and keeps context visible.

---

### 2.3 Progressive Permission Handling

**Current State:**
Permissions trigger `ElicitationDialog` and `PermissionPanel` modals.

**Recommendation: Inline Permission Cards**

For simple permissions, show an inline card in the chat flow:

```
┌─ Permission Required ──────────────────────┐
│ Allow Read access to /Users/project/data ? │
│                                             │
│ [ Allow Once ]  [ Always Allow ]  [ Deny ]  │
└─────────────────────────────────────────────┘
```

Keep modals only for complex/high-risk permissions.

---

### 2.4 Improved Error Recovery UX

**Current State:**
Errors are displayed in tool output with red styling.

**Recommendation: Structured Error Recovery**

Add quick-fix suggestions for common errors:

```
┌─ Error: Module not found 'lodash' ──────────┐
│                                              │
│   import lodash from 'lodash';               │
│                                              │
│ Did you mean?                                │
│   • npm install lodash                       │
│   • npm install @types/lodash               │
│   • import { debounce } from 'lodash'        │
│                                              │
│ [ Run Fix ]  [ Ignore ]  [ Copy Command ]    │
└──────────────────────────────────────────────┘
```

---

### 2.5 Smart Context Menu

**Current State:**
Right-click context menus are basic.

**Recommendation: Context-Aware Context Menu**

```typescript
const contextMenuItems = $derived.by(() => {
  const items: ContextMenuItem[] = [];

  if (selectedText) {
    items.push(
      { label: 'Ask about selection', action: 'ask-selection' },
      { label: 'Explain code', action: 'explain' },
      { label: 'Copy', action: 'copy' },
    );
  }

  if (cursorOnFile) {
    items.push(
      { label: 'Open in editor', action: 'open-file' },
      { label: 'View history', action: 'view-git' },
      { label: 'Add to context', action: 'add-context' },
    );
  }

  if (cursorOnFunction) {
    items.push(
      { label: 'Refactor', action: 'refactor' },
      { label: 'Add tests', action: 'add-tests' },
      { label: 'View docs', action: 'view-docs' },
    );
  }

  return items;
});
```

---

### 2.6 Command Palette Enhancements

**Current State:**
`CommandPalette.svelte` supports navigation, prompts, and IPC commands.

**Recommendation: Add Natural Language Understanding**

Allow commands like:
- "show me my recent conversations"
- "start a new session in folder X"
- "what was my last task about"
- "export this conversation"

This reduces the learning curve for new users.

---

### 2.7 Tool Streaming Visualization

**Current State:**
Tool activity shows as timeline with status icons.

**Recommendation: Real-time Tool Visualization**

Show live progress for long-running tools:

```
┌─ Search Files ──────────────────────────────┐
│ ○ Searching... 2,340 files scanned          │
│ ○ Analyzing... matches found: 12            │
│ ○ Sorting... by relevance                  │
│                                            │
│ Results (12 matches):                      │
│   src/utils/format.ts:23 "formatDate"       │
│   src/utils/format.ts:45 "formatNumber"     │
└────────────────────────────────────────────┘
```

---

### 2.8 Session Summary Cards

**Current State:**
Session history shows in `RunListItem.svelte` with basic info.

**Recommendation: Rich Session Cards**

```
┌─ Feature: Add user auth ──────────────────┐
│ ○ Completed  •  14:32  •  47 tools       │
│                                            │
│ Created: src/auth/login.ts                │
│ Modified: src/auth/middleware.ts           │
│                                    [+12]   │
│                                            │
│ Cost: $0.12  •  Input: 8.2K tokens        │
└────────────────────────────────────────────┘
```

---

### 2.9 Keyboard Shortcut System

**Current State:**
Basic keyboard handling in `PromptInput.svelte`.

**Recommendation: Comprehensive Shortcut System**

```typescript
// src/lib/stores/keybindings.svelte.ts

interface Keybinding {
  key: string;
  modifiers: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  action: string;
  description: string;
  category: 'navigation' | 'editing' | 'session' | 'tools';
}

const defaultBindings: Keybinding[] = [
  { key: 'k', modifiers: ['meta'], action: 'command-palette', description: 'Open command palette' },
  { key: 'j', modifiers: ['meta'], action: 'new-session', description: 'New chat session' },
  { key: ']', modifiers: ['ctrl'], action: 'next-panel', description: 'Next panel' },
  // ... more bindings
];
```

Show shortcut hints in tooltips and add a shortcut help overlay (Shift+?).

---

### 2.10 Onboarding Improvements

**Current State:**
Setup wizard via `SetupWizard.svelte`.

**Recommendation: Interactive Onboarding**

1. **Welcome Tour**: 3-step introduction to key features
2. **Contextual Tips**: Show tips based on user actions
3. **Quick Start Templates**: Pre-built prompts for common tasks

```typescript
const onboardingSteps = [
  {
    title: 'Welcome to MiWarp',
    content: 'Your AI coding assistant with visual chat interface',
    highlight: 'prompt-input',
  },
  {
    title: 'Slash Commands',
    content: 'Type / to see available commands',
    highlight: 'slash-menu',
  },
  {
    title: 'Session Management',
    content: 'Organize your conversations in folders',
    highlight: 'sidebar',
  },
];
```

---

## Part 3: Implementation Priority

### High Priority (Week 1-2)

1. **Inline Permission Cards** - Reduces modal interruptions
2. **Smart Context Menu** - Improves productivity
3. **Keyboard Shortcut System** - Professional experience

### Medium Priority (Week 3-4)

4. **Command Palette Enhancements** - Natural language understanding
5. **Tool Streaming Visualization** - Better feedback
6. **Session Summary Cards** - Better history browsing

### Lower Priority (Week 5+)

7. **Context-Aware Autocomplete** - Requires more research
8. **Onboarding Improvements** - Can be added incrementally

---

## Part 4: Code Examples

### Example: Inline Permission Card Component

```svelte
<!-- src/lib/components/InlinePermissionCard.svelte -->

<script lang="ts">
  let {
    permission,
    onAllow,
    onDeny,
    onAlwaysAllow,
  }: {
    permission: PermissionRequest;
    onAllow: () => void;
    onDeny: () => void;
    onAlwaysAllow: () => void;
  } = $props();

  let expanded = $state(false);
</script>

<div class="inline-permission rounded-lg border border-border bg-muted/30 p-3">
  <div class="flex items-center gap-2 mb-2">
    <svg class="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01"/>
    </svg>
    <span class="text-sm font-medium">Permission Required</span>
  </div>

  <p class="text-sm text-muted-foreground mb-3">
    {permission.description}
  </p>

  <div class="flex gap-2">
    <button class="btn-primary text-sm" onclick={onAllow}>
      Allow Once
    </button>
    <button class="btn-secondary text-sm" onclick={onAlwaysAllow}>
      Always Allow
    </button>
    <button class="btn-ghost text-sm" onclick={onDeny}>
      Deny
    </button>
  </div>
</div>
```

### Example: Enhanced Command Palette

```typescript
// src/lib/commands/enhanced-commands.ts

interface Command {
  id: string;
  label: string;
  description: string;
  action: () => void | Promise<void>;
  keywords: string[];
}

const enhancedCommands: Command[] = [
  {
    id: 'natural-search',
    label: 'Search conversations naturally',
    description: 'Use natural language to find past sessions',
    action: () => openNaturalSearch(),
    keywords: ['find', 'search', 'look', 'show', 'where'],
  },
  {
    id: 'quick-start',
    label: 'Start from template',
    description: 'Begin with a pre-built prompt template',
    action: () => openTemplates(),
    keywords: ['template', 'start', 'new', 'begin'],
  },
  // ... more commands
];

export function matchNaturalLanguage(query: string): Command | null {
  const normalized = query.toLowerCase().trim();
  const scores = enhancedCommands.map(cmd => ({
    cmd,
    score: calculateMatchScore(cmd, normalized),
  }));

  const best = scores
    .filter(s => s.score > 0.5)
    .sort((a, b) => b.score - a.score)[0];

  return best?.cmd ?? null;
}
```

---

## Conclusion

MiWarp has a solid technical foundation with Svelte 5 composables, singleton patterns, and transport abstraction. The recommendations above focus on enhancing user experience through:

1. **Reduced Friction** - Inline interactions instead of modals
2. **Smart Context** - Context-aware suggestions and menus
3. **Better Feedback** - Real-time progress visualization
4. **Improved Navigation** - Enhanced command palette and shortcuts

Start with high-priority items for immediate impact, then iterate based on user feedback.

---

*Report generated: May 2026*
*Source: Claude Code CLI design patterns analysis*