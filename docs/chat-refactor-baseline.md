# Chat Page Refactor Baseline

> Generated 2026-05-19. Phase 0 of incremental ChatPage decomposition.

---

## Current State

- **File**: `src/routes/chat/+page.svelte` — 5350 lines
- **Branch**: `feat/31bfd8ad` (worktree)
- **Status**: Clean working tree, no uncommitted changes

## Critical Pre-existing Issue

The import at line 35-38 references `$lib/chat/selectors/timeline-presentation` which does **not exist** on this branch. The file exists in the main project directory (`D:\project\miwarp\src\lib\chat\selectors\timeline-presentation.ts`) as an untracked file — it was extracted from ChatPage but never committed. **The build will fail on this branch until this file is added.**

This file contains `computeTimelinePresentation()` and `getInitialRenderLimit()` — pure selector functions that were already extracted from ChatPage in a previous session.

## Must-Preserve Behaviors

1. **Default entry**: Opening the app auto-loads the last continuable run (or shows welcome screen)
2. **Run switching**: Clicking a session in the sidebar loads its timeline via `loadRunProgressive()`
3. **User message sending**: Three paths — first message (creates run), stopped session (resume+send), subsequent message
4. **Timeline rendering**: Progressive rendering with `renderLimit`, tool burst collapse, tool filter
5. **Permission handling**: Inline permission cards, elicitation dialogs, tool approval
6. **Scroll behavior**: Auto-scroll on new content, scroll-to-message for search results
7. **Session resume**: Continue, fork, restart modes
8. **Team dispatch**: @team / /team trigger detection and parallel execution
9. **Slash commands**: Virtual commands (help, diff, rename, etc.) handled locally
10. **Fork overlay**: Two-step fork with progress feedback
11. **Rewind**: Undo to a previous user message
12. **Context snapshots**: Auto-context tracking per turn

## Image/Drawing Handling — Current State

**There is NO assistant-generated image support.** The only image handling is:

- User-provided `Attachment` objects (drag-drop, paste, screenshot)
- `ChatMessage.svelte` renders images from `entry.attachments` using `isImage()` check
- Images are displayed as inline `<img>` tags with base64 data URLs
- No image gallery, no artifact rendering, no generated image display

If "drawing messages" refers to user-attached images, they flow through:
```
PromptInput → Attachment[] → store.sendMessage() → bus event → _reduce() → TimelineEntry.attachments → ChatMessage
```

## High-Risk Fields

These fields/functions have the most downstream dependencies:

| Field/Function | Dependents | Risk Level |
|---|---|---|
| `store.timeline` | timelinePresentation, rewindCandidates, userHistory, insight, ToolActivity, every rendering path | **CRITICAL** |
| `store.run` | 40+ template bindings, conditional rendering, phase checks | **CRITICAL** |
| `store.phase` | sending, welcomeVisible, routeRunPending, permission visibility, thinking visibility | HIGH |
| `store.sessionAlive` | permission panel, resume, rewind, input state | HIGH |
| `processVisibility` | view mode, tool rendering, sidebar collapse | HIGH |
| `loadRunProgressive()` | Run loading, scroll-to, progressive render init | HIGH |
| `sendMessage()` | First message, resume+send, subsequent message | HIGH |
| `computeTimelinePresentation()` | All timeline derived state | HIGH (but already extracted) |
| `burstCollapse` | Tool burst visual state, index-based references | MEDIUM |

## State Variable Summary (~100+ variables)

| Category | Count | Examples |
|---|---|---|
| UI-only state | ~15 | sidebarCollapsed, chatAreaRef, isChatAutoScroll |
| Store references | ~4 | store, middleware, processVisibility |
| Session/run state | ~8 | agentSettings, resuming, loadingRunId |
| Timeline/rendering | ~18 | timelinePresentation, filteredTimeline, renderLimit, toolFilter |
| Permission | ~3 | inputBlockedByPermission, pendingToolPermissions |
| Scroll | ~4 | isChatAutoScroll, topSentinel, _scrollToInFlight |
| Team dispatch | ~5 | teamDispatchOpen, activeTeamRuns, teamPresets |
| Rewind | ~4 | rewindModalOpen, rewindMarkers, rewindCandidates |
| Fork overlay | ~2 | forkOverlay, forkElapsed |
| Thinking timer | ~6 | thinkingElapsed, thinkingExpanded, processingSlashCmd |
| Verbose/CLI | ~8 | verboseEnabled, cliVersionInfo, platformModels |
| Project data | ~7 | preloadedSkills, projectCommands, projectInitStatus |
| Toast/notification | ~3 | chatToast, notificationVisible |
| Miscellaneous | ~15 | remoteHosts, folderPickerOpen, btwState, contextHistoryMap |

## $effect Blocks (~30)

Major effects by category:
- **Run lifecycle**: runId watcher (line 1475), resume param (line 1540), scrollTo (line 1517)
- **Run switch cleanup**: clear markers, preview, cache, burst collapse, tool filter
- **Scroll**: auto-scroll on content change, scroll state reset on run change
- **Thinking**: timer, debounced visibility, slash command indicator
- **Fork**: elapsed timer, phase watcher, error propagation
- **Model**: restore model, effort guard, contamination self-heal
- **Progressive render**: IntersectionObserver setup

## Recommended Safe Extraction Order

Based on the analysis, here is the safest incremental extraction order:

### Phase 1 (Already done — just needs committing)
- `src/lib/chat/selectors/timeline-presentation.ts` — already extracted, just untracked

### Phase 2 (Pure functions — zero behavior change)
- Extract `handleVirtualCommand()` helper functions (slash command handlers)
- Extract `buildSummaryHtml()` (pure HTML generation)
- Extract permission mode translation maps (`CLI_TO_APP_MODE`, `APP_TO_CLI_MODE`)

### Phase 3 (Leaf display components — no state)
- Extract `initHintCard()` snippet → component
- Extract `heroMetaItems()` snippet → component
- Extract welcome screen block → `ChatWelcome.svelte`
- Extract fork overlay → `ChatForkOverlay.svelte`
- Extract thinking indicator → `ChatThinkingIndicator.svelte`

### Phase 4 (Message list — display only, no loading)
- Extract the `#each visibleTimeline` rendering loop → `ChatTimeline.svelte`
- Pass all derived state as props, no store access in child

### Phase 5 (Input area — no message store)
- Extract input dock area → `ChatInputDock.svelte`
- Keep sendMessage handler in parent, pass as callback

### Phase 6 (Session loading — adapter first)
- Wrap `loadRunProgressive()` in a service
- Add request token for race protection (already has progressiveGen)
- Keep store.loadRun() as the actual implementation

### Phase 7 (State store — facade first)
- Create `chatPageStore.ts` facade
- Expose: currentSession, messages, isLoading, isSending, error
- Internal first version just delegates to sessionStore

## Verification Checklist

After each phase, verify:

- [ ] `npm run check` passes (svelte type check)
- [ ] `npm run build` passes
- [ ] `npm run dev` starts without errors
- [ ] Default entry loads last session or shows welcome
- [ ] Clicking sessions in sidebar loads correct timeline
- [ ] User messages send correctly (first + subsequent)
- [ ] Timeline renders with progressive loading
- [ ] Tool bursts collapse/expand correctly
- [ ] Permission cards appear and respond
- [ ] Scroll-to-message works for search results
- [ ] Fork overlay shows progress and handles errors
- [ ] Console has no new undefined/null errors
