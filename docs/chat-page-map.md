# ChatPage Code Map

> Comprehensive analysis of `src/routes/chat/+page.svelte` (~5350 lines) and its related components.
> Generated 2026-05-19.

---

## 1. State Variables Inventory

### UI-Only State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `middlewareReady` | `boolean` | 135 | Guards $effect chains until middleware is initialized |
| `settings` | `UserSettings \| null` | 136 | User settings loaded on mount |
| `xtermRef` | `XTerminal \| undefined` | 137 | Ref to XTerminal component (CLI mode) |
| `promptRef` | `PromptInput \| undefined` | 138 | Ref to PromptInput component |
| `sidebarCollapsed` | `boolean` | 139 | ToolActivity sidebar collapse state |
| `chatAreaRef` | `HTMLDivElement \| undefined` | 155 | Chat scroll container ref |
| `isChatAutoScroll` | `boolean` | 156 | Whether auto-scroll-to-bottom is active |
| `showChatScrollHint` | `boolean` | 159 | "New messages" scroll-down button |
| `shortcutHelpOpen` | `boolean` | 370 | Keyboard shortcut help panel |
| `statusBarRef` | `SessionStatusBar \| undefined` | 371 | Ref to status bar component |
| `statusBarExpanded` | `boolean` | 501 | Status bar expanded/collapsed (persisted in localStorage) |
| `mcpPanelOpen` | `boolean` | 496 | MCP server panel floating state |
| `chatToast` | `string \| null` | 3282 | Auto-dismissing toast message |
| `pageDragActive` | `boolean` | 3331 | File drag-over active |
| `dragProcessingCount` | `number` | 3332 | Number of files being processed from drop |
| `dragProcessing` | `$derived(dragProcessingCount > 0)` | 3333 | Computed from dragProcessingCount |

### Store References

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `store` | `SessionStore` (const) | 131 | Singleton session store (`sessionStore`) |
| `middleware` | `EventMiddleware` (const) | 132 | Singleton event middleware (`getEventMiddleware()`) |
| `processVisibility` | `$derived` | 142 | Normalized view mode from settings: "developer" / "output" / "guided" |
| `inputBlockedByPermission` | `$derived` | 934 | `store.hasPendingPermission \|\| store.hasElicitation` |
| `pendingToolPermissions` | `$derived` | 935 | `store.pendingToolPermissions` |
| `showPermissionPanel` | `$derived` | 936 | `pendingToolPermissions.length > 0 && store.sessionAlive` |

### Session/Run State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `agentSettings` | `AgentSettings \| null` | 160 | Per-agent config (plan_mode, no_session_persistence) |
| `resuming` | `boolean` | 161 | Resume operation in progress |
| `approving` | `boolean` | 163 | Suppresses "Session ended" flash during tool approval restart |
| `lastContinuableRun` | `TaskRun \| null` | 166 | Most recent resumable run (for welcome screen "Continue") |
| `sending` | `$derived(store.phase === "spawning")` | 1194 | Convenience flag for template |
| `loadingRunId` | `string \| null` | 445 | Run ID currently being loaded (for spinner) |
| `verboseEnabled` | `boolean` | 397 | CLI verbose mode toggle state |
| `currentEffort` | `string` | 685 | Current effort level from CLI config |

### Timeline/Rendering State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `timelinePresentation` | `$derived.by` | 450 | Core computed: calls `computeTimelinePresentation()` |
| `filteredTimeline` | `$derived` | 459 | Timeline after tool filter applied |
| `visibleTimeline` | `$derived` | 460 | Progressive-render slice of filteredTimeline |
| `toolNamesInTimeline` | `$derived` | 461 | Tool names present (for filter UI) |
| `timelineIdIndex` | `$derived` | 462 | Map of entry.id -> index (for opacity dimming) |
| `lastClearSepId` | `$derived` | 463 | ID of last context-clear separator |
| `latestPlanToolId` | `$derived` | 464 | ID of most recent ExitPlanMode tool |
| `createdFiles` | `$derived` | 465 | Files created during session |
| `hasCreatedFiles` | `$derived` | 466 | `createdFiles.length > 0` |
| `batchGroups` | `$derived` | 467 | Consecutive >= 3 Task tools grouped |
| `toolBursts` | `$derived` | 468 | Tool burst groups for collapse headers |
| `userCountPrefix` | `$derived` | 469 | Prefix-sum of user messages per entry |
| `toolFilter` | `string \| null` | 442 | Active tool name filter |
| `renderLimit` | `number` | 443 | Progressive render cap (starts at ~200) |
| `loadingMore` | `boolean` | 446 | Loading more entries from top |
| `loadMoreArmed` | `boolean` | 447 | Whether IntersectionObserver can trigger load-more |
| `lastAssistantIdx` | `$derived.by` | 507 | Index of last assistant entry in visibleTimeline |
| `userHistory` | `$derived.by` | 515 | Array of user message contents (most recent first) |
| `sidebarToolsCount` | `$derived` | 649 | Number of unique tools for sidebar badge |

### Permission State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `inputBlockedByPermission` | `$derived` | 934 | Blocks input when permission/elicitation pending |
| `pendingToolPermissions` | `$derived` | 935 | Array of `{tool, requestId}` for PermissionPanel |
| `showPermissionPanel` | `$derived` | 936 | Show floating permission panel |

### Scroll State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `isChatAutoScroll` | `boolean` | 156 | Auto-scroll-to-bottom active |
| `showChatScrollHint` | `boolean` | 159 | "New messages" floating button |
| `topSentinel` | `HTMLDivElement \| null` | 773 | IntersectionObserver sentinel for progressive load |
| `_scrollToInFlight` | `boolean` (non-reactive) | 158 | Suppresses auto-scroll reset during scrollTo navigation |

### Team Dispatch State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `teamDispatchOpen` | `boolean` | 250 | Team dispatch confirmation dialog |
| `teamDispatchPrompt` | `string` | 251 | Prompt text for team dispatch |
| `activeTeamRuns` | `TeamRun[]` | 252 | Currently running team runs |
| `teamHintVisible` | `boolean` | 253 | "@team" hint shown in input |
| `teamPresets` | `TeamPreset[]` | 258 | Available team presets |

### Rewind State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `rewindModalOpen` | `boolean` | 240 | Rewind modal visibility |
| `rewindDirectTarget` | `RewindCandidate \| null` | 241 | Direct rewind target (from message action button) |
| `rewindMarkers` | `RewindMarker[]` | 242 | Applied rewind markers displayed in timeline |
| `rewindCandidates` | `$derived` | 335 | Computed candidates from store.timeline (lazy, only when modal open) |

### Fork Overlay State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `forkOverlay` | `{active, sourceRunId, startedAt, error} \| null` | 1003 | Fork operation overlay |
| `forkElapsed` | `number` | 1009 | Seconds since fork started |

### Thinking Timer State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `thinkingElapsed` | `number` | 1012 | Seconds since thinking started |
| `thinkingExpanded` | `boolean` | 1013 | Thinking panel expanded/collapsed |
| `spinnerVerb` | `string` | 1014 | Random verb for thinking spinner |
| `thinkingVisible` | `boolean` | 1018 | Debounced (300ms) thinking indicator |
| `processingSlashCmd` | `string \| null` | 1028 | Slash command processing indicator |
| `slashCmdSeenRunning` | `boolean` | 1029 | Guard for slash command indicator lifecycle |

### Verbose/CLI Config State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `verboseEnabled` | `boolean` | 397 | CLI verbose mode |
| `verboseRetryTick` | `number` | 400 | Retry counter driving re-fetch on failure |
| `cliVersionInfo` | `$derived` | 651 | Cached CLI version info |
| `channelLatest` | `$derived.by` | 654 | Latest CLI version in channel |
| `platformDisplayName` | `$derived.by` | 660 | Human-readable platform name |
| `platformModels` | `$derived.by` | 670 | Third-party platform model list |
| `effectiveModels` | `$derived` | 684 | Resolved model list (platform or CLI) |
| `localProxyStatuses` | `Record<string, ...>` | 203 | Local proxy running statuses for AuthSourceBadge |

### Project Data State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `folderCwdOverride` | `string` | 154 | Override cwd from ?folder= URL param |
| `preloadedSkills` | `StandaloneSkill[]` | 195 | Project-level skills from filesystem |
| `preloadedAgents` | `AgentDefinitionSummary[]` | 197 | Project-level agent definitions |
| `projectCommands` | `CliCommand[]` | 199 | Project-level slash commands |
| `projectInitStatus` | `ProjectInitStatus \| null` | 232 | CLAUDE.md detection result |
| `preloadGen` | `number` (non-reactive) | 201 | Race guard for reloadProjectData |
| `skillItems` | `$derived.by` | 939 | Merged skill items for PromptInput |
| `authOverview` | `AuthOverview \| null` | 172 | Auth overview for AuthSourceBadge |

### Toast/Notification State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `notificationVisible` | `boolean` | 236 | Task notification banner |
| `latestNotification` | `{task_id, status} \| null` | 237 | Latest task notification |
| `chatToast` | `string \| null` | 3282 | Auto-dismissing chat-level toast |

### Miscellaneous State

| Variable | Type | Line | Purpose |
|----------|------|------|---------|
| `remoteHosts` | `RemoteHost[]` | 168 | Available remote hosts from settings |
| `targetDropdownOpen` | `boolean` | 170 | Remote host dropdown in hero |
| `folderPickerOpen` | `boolean` | 175 | Folder picker dialog |
| `folderPickerInitialHost` | `string \| null` | 176 | Initial host for folder picker |
| `folderPickerInitialPath` | `string` | 177 | Initial path for folder picker |
| `folderPickerHideTarget` | `boolean` | 178 | Hide target selector in folder picker |
| `folderPickerResolve` | `Promise resolver \| null` | 179 | Pending folder picker Promise |
| `stashedInput` | `PromptInputSnapshot \| null` | 372 | Stashed prompt input (session switch) |
| `sidebarRequestedTab` | `ToolActivityPanelTab \| null` | 373 | Sidebar tab requested externally |
| `toolPanelActiveTab` | `ToolActivityPanelTab` | 374 | Currently active sidebar tab |
| `toolPanelIndicators` | `{context, files, tasks}` | 375 | Sidebar tab notification dots |
| `requestedPreviewPath` | `string \| null` | 376 | File path to preview in sidebar |
| `requestedPreviewUrl` | `string \| null` | 377 | URL to preview in sidebar |
| `btwState` | `{active, btwId, question, answer, error, loading}` | 360 | BTW side question drawer |
| `contextHistoryMap` | `Map<string, ContextSnapshot[]>` | 577 | Per-run context snapshots |
| `contextHistory` | `$derived` | 578 | Context history for current run |
| `cumulativeTokens` | `$derived.by` | 582 | Session-cumulative token totals |
| `currentSessionInfo` | `$derived.by` | 607 | Session info for InfoPanel |
| `insight` | composable | 3292 | `useConversationInsight()` for HTML report generation |
| `toolResultCache` | `Map<string, Record>` | 406 | Lazy-loaded tool result cache |
| `toolResultInflight` | `Map<string, Promise>` | 407 | In-flight tool result fetches |

### $effect Inventory

| Line | Trigger | Purpose |
|------|---------|---------|
| 148 | `processVisibility` | Collapse sidebar in output mode |
| 245 | `rewindModalOpen` | Clear direct target on modal close |
| 316 | `store.run?.id` | Reset auto-name latch on run switch |
| 326 | `store.run?.id` | Clear rewind markers on run switch |
| 388 | `store.run?.id` | Clear preview path on run switch |
| 409 | `store.run?.id` | Clear tool result cache on run switch |
| 525 | `batchGroups` | Debug log batch groups |
| 554 | `toolBurstSig` | Sync burst collapse visual states |
| 561 | `store.run?.id` | Reset burst collapse on run switch |
| 689 | model/platform | Effort guard (auto-clear/set effort) |
| 717 | `store.run?.id` | Reset tool filter + auto-focus input |
| 725 | `verboseRetryTick` | Sync verbose state from CLI config |
| 776 | `topSentinel`, `chatAreaRef` | IntersectionObserver for progressive load-more |
| 1021 | `store.thinkingText` | Collapse thinking panel when text clears |
| 1031 | `processingSlashCmd` | Clear slash command indicator lifecycle |
| 1050 | `store.isThinking` | Thinking timer (debounced 300ms visibility) |
| 1081 | `forkOverlay` | Fork overlay elapsed timer |
| 1096 | `forkOverlay`, `store.phase` | Fork overlay phase watcher (error on failure) |
| 1105 | `store.error` | Fork overlay error propagation |
| 1149 | `folderParam`, `hostParam` | Consume ?folder= and ?host= URL params |
| 1475 | `runId`, `hasResumeParam` | **Main run loader** — subscribes middleware + triggers loadRunProgressive |
| 1517 | `scrollTo` param | Handle scrollTo for already-loaded runs |
| 1540 | `resume` param | Consume ?resume= URL param |
| 1787 | `store.run?.id` | Auto-name run after first turn |
| 1806 | scroll state | Auto-scroll to bottom on new content |
| 1821 | `store.isRunning`, `store.streamingText` | Streaming scroll behavior |
| 1913 | permission state | Auto-scroll on inline permission pending |
| 1935 | `pendingToolPermissions` | Permission panel visibility log |
| 2684 | various | Tool filter badge visibility |
| 649 | `sidebarToolsCount` | Sidebar tools badge |

---

## 2. Session Loading Chain

### Triggers

1. **URL `?run=` param change** (line 1475): The main `$effect` watches `runId` (derived from URL). When it changes:
   - Calls `middleware.subscribeCurrent(id, store)` to route bus events
   - Guards against redundant loads (resume in progress, session already alive)
   - Calls `loadRunProgressive(id, xtermRef)`

2. **URL `?resume=` param** (line 1540): Separate `$effect` watches for `?resume=continue|fork`. Cleans URL and calls `handleResume()`.

3. **URL `?folder=` param** (line 1149): Sets `folderCwdOverride`, clears current run via `store.loadRun("")`, cleans URL.

4. **Welcome screen "Continue last session"** (line 1283): `goto(/chat?run=${id}&resume=continue)`.

5. **First message send** (line 2055): `store.startSession()` creates run, then `goto(/chat?run=${runId})`.

### loadRunProgressive Flow (line 857)

```
loadRunProgressive(id, xtermRef)
  1. Reset toolFilter, renderLimit, loadingMore
  2. Set loadingRunId = id (shows spinner)
  3. Set _scrollToInFlight if ?scrollTo present
  4. await store.loadRun(id, xtermRef)
     -> store._setPhase("loading")
     -> store._clearContentState()
     -> api.getRun(id) -> sets store.run
     -> Auto-sync CLI imports if source === "cli_import"
     -> Sets agent, remoteHostName, platformId
     -> Tries IDB snapshot (terminal/idle sessions)
     -> Falls back to api.listRunEvents(id) → applyEventBatchAsync()
     -> Sets phase from run.status
  5. Reset folderCwdOverride
  6. Recompute renderLimit via getInitialRenderLimit(processVisibility, store.timeline)
  7. reloadProjectData(store.effectiveCwd) — skills, agents, commands
  8. Patch MCP disabled state
  9. If ?scrollTo: scrollToMessage() then clean URL
  10. Else: scroll to bottom
  11. Clear loadingRunId
```

### Guards Preventing Redundant Loads

- **Generation counter** (`progressiveGen`): Each call increments; stale async operations bail out via `gen !== progressiveGen` checks
- **Resume guard**: `store.resumeInFlight || resuming` prevents loadRun during resume
- **Session alive guard**: `store.run?.id === id && store.sessionAlive` skips if already loaded
- **Middleware idempotent subscribe**: `subscribeCurrent()` skips if same runId + store

### Middleware Subscription Flow

```
EventMiddleware.subscribeCurrent(runId, store)
  -> Unsubscribes previous run
  -> Subscribes new run via transport
  -> Stores (runId → store) mapping

On bus-event:
  -> Microbatch buffer (16ms interval, max 500 per run)
  -> Flush: calls store.applyEvent(ev) for subscribed store

On hook-event:
  -> Calls store.applyHookEvent(ev)

On _full_reload (WS-only):
  -> Calls store.loadRun(runId) to replay all events
```

---

## 3. Message/Timeline Rendering Chain

### store.timeline

`store.timeline` is a `$state<TimelineEntry[]>([])` on `SessionStore` (line 186). It is the canonical ordered list of all conversation entries. Entries are added by the `_reduce()` method when processing bus events:

- `user_message` → adds `{kind: "user", id, anchorId, content, ts, attachments?, cliUuid?}`
- `assistant_start` / `message_delta` / `message_complete` → adds/updates `{kind: "assistant", id, anchorId, content, ts, thinkingText?}`
- `tool_use` / `tool_end` / `tool_input_delta` → adds/updates `{kind: "tool", id, anchorId, tool: BusToolItem, ts, subTimeline?}`
- `system_message` / `context_clear` → adds `{kind: "separator" | "command_output", ...}`

### TimelineEntry Type (src/lib/types.ts line 1213)

```typescript
type TimelineEntry =
  | { kind: "user"; id: string; anchorId: string; content: string; ts: string;
      attachments?: Attachment[]; cliUuid?: string; }
  | { kind: "assistant"; id: string; anchorId: string; content: string; ts: string;
      thinkingText?: string; model?: string; }
  | { kind: "tool"; id: string; anchorId: string; tool: BusToolItem; ts: string;
      subTimeline?: TimelineEntry[]; }
  | { kind: "separator"; id: string; anchorId: string; content: string; ts: string; }
  | { kind: "command_output"; id: string; anchorId: string; content: string; ts: string; }
```

### filteredTimeline -> visibleTimeline Pipeline

```
store.timeline (raw)
  -> computeTimelinePresentation(store.timeline, toolFilter, renderLimit, toolCount)
     -> filteredTimeline: applies toolFilter (if set, keeps only entries matching tool name)
     -> visibleTimeline: filteredTimeline.slice(max(0, length - renderLimit))
     -> Also computes: toolNames, timelineIdIndex, lastClearSepId, latestPlanToolId,
        createdFiles, batchGroups, toolBursts, userCountPrefix, sidebarToolsCount
```

The `computeTimelinePresentation` function is imported from `$lib/chat/selectors/timeline-presentation`. **Note: this file does not currently exist on disk** — the import at line 35-38 references it, but the file was either deleted or not yet created. The page still compiles because the function is used only in `$derived.by` which defers evaluation.

### Progressive Rendering

- `renderLimit` starts at `getInitialRenderLimit(processVisibility, [])` (~200 entries)
- On loadRunProgressive, it's recomputed for the loaded timeline
- A `topSentinel` div is placed above the visible entries
- `IntersectionObserver` watches the sentinel: when it enters the viewport, `loadMoreEarlier()` grows `renderLimit` by `RENDER_GROWTH_STEP` (100)
- Scroll position is preserved via anchor-element offset compensation
- `loadMoreArmed` flag prevents runaway expansion (re-armed on user scroll)

### Tool Bursts and Burst Collapse

**Tool bursts** (`toolBursts`): Groups of consecutive tool entries in the timeline, used for showing batch headers.

**Burst collapse** (`useToolBurstCollapse` at `src/lib/chat/use-tool-burst-collapse.svelte.ts`):
- State machine: `expanded -> settling -> collapsing -> collapsed`
- `settling` (400ms): All tools completed, keep expanded briefly
- `collapsing` (260ms): Cards animating out, header animating in
- `collapsed`: Only header visible, cards unmounted
- Manual overrides: user can force expand/collapse via `toggleBurst(key)`
- Interaction priority: tools needing permission/ask are always expanded
- Resets on run switch

### Rendering by Entry Kind

**User entries** (line 4380):
- Rendered as `<ChatMessage role="user" content={entry.content} attachments={entry.attachments} />`
- Supports rewind action button (if session alive and not running)
- Supports "Dispatch to Team" button

**Assistant entries** (line 4402):
- Rendered as `<ChatMessage role="assistant" content={entry.content} thinkingText={entry.thinkingText} />`
- Animated if last assistant entry and store is running
- Shows AgentIdentity header (agent icon, name)

**Tool entries** (line 4419):
- `claudeTurnStarts.has(i)`: Adds `pt-3` spacing before first tool after user message
- `burstCollapse.collapsedIndices.has(i)`: Skips rendering (hidden by collapsed burst)
- Three rendering modes based on `processVisibility`:
  - `"output"`: Hidden (zero-height div) unless shouldMountFullToolCardInOutputMode
  - `"guided"`: `GuidedToolTimelineRow` (compact inline row)
  - `"developer"` (default): Full `InlineToolCard` with subTimeline, permission handling, etc.

**Command output / separator entries** (line 4473):
- Separators (`isTimelineSeparatorContent`): Context-clear horizontal rule
- Command outputs: Specialized renderers for ContextUsageGrid, CostSummaryView, ReleaseNotesCard, ANSI codes, or MarkdownContent

### Other Timeline Sections (After Entries)

- **Output mode working hint** (line 4520): Pulsing indicator when routine tools running in output mode
- **Rewind markers** (line 4538): Blue horizontal rules with reverted file lists
- **Last turn usage** (line 4593): Token counts after all entries when not running
- **Active team runs** (line 4616): TeamRunCard components
- **Hook callbacks** (line 4625): HookReviewCard for pending hooks
- **Thinking panel** (line 4632): Expandable thinking text display
- **Streaming text** (line 4714): Live streaming assistant response
- **Slash command indicator** (line 4736): Spinner for slash command processing
- **Thinking indicator** (line 4750): Debounced thinking spinner with elapsed time

---

## 4. Image/Drawing Message Handling

### Current State: Images are ONLY in User Attachments

**There is NO image-specific handling for assistant-generated images, drawings, or artifacts.** The only image support is for user-provided file attachments.

### How Images Flow Today

1. **User attaches files** via PromptInput (drag-drop, paste, file picker, screenshot)
2. Files are converted to `Attachment` objects with `{name, type, size, contentBase64}`
3. `store.sendMessage()` / `store.startSession()` sends attachments to backend
4. Backend returns `user_message` bus event with `attachments` field
5. `_reduce()` creates `{kind: "user", attachments: timelineAttachments(attachments)}`
   - `timelineAttachments()` strips base64 from non-image types (keeps images)
6. ChatPage passes `entry.attachments` to `<ChatMessage attachments={...} />`
7. **ChatMessage.svelte** (line 278-291): Renders images inline:
   ```svelte
   {#if isImage(att) && att.contentBase64}
     <img src="data:{att.type};base64,{att.contentBase64}" ... />
   {:else}
     <FileAttachment name={att.name} size={att.size} mimeType={att.type} />
   {/if}
   ```
8. `isImage()` checks against `IMAGE_TYPES` from `$lib/utils/file-types`

### What Does NOT Exist

- **No `imageUrl`, `imageUrls`, `generatedImages` fields** on TimelineEntry or BusToolItem
- **No image gallery/grid component** for displaying multiple generated images
- **No artifact/image rendering** in assistant message entries
- **No special handling** for image generation tools (e.g., if a CLI tool generates an image, it would appear as a tool entry with text output, not as a rendered image)
- **No image preview modal** or lightbox
- **The `Attachment` type** is only used for user-sent files, not for assistant-generated content

### Attachment Type Definition (src/lib/types.ts line 347)

```typescript
interface Attachment {
  name: string;
  type: string;      // MIME type
  size: number;
  contentBase64: string;
}
```

### ChatMessage Image Handling

`ChatMessage.svelte` imports `IMAGE_TYPES` from `$lib/utils/file-types` and uses it to determine if an attachment is an image. Images with `contentBase64` are rendered as inline `<img>` tags (max 192px height, max 384px width). Non-image attachments are rendered as `<FileAttachment>` chips.

---

## 5. Send Message Chain

### sendMessage() in ChatPage (line 1951)

```
sendMessage(text, attachments)
  1. Guard: !text.trim() → return
  2. Clear store.error, enable auto-scroll
  3. Detect slash command (isKnownSlashCommand)
  4. Team trigger detection: @team / \team → open TeamDispatchConfirm dialog

  5. Three paths:
     a. First message (!store.run):
        - Validate remote host still exists in settings
        - Resolve cwd (remote → getStoredRemoteCwd, desktop → native dialog, browser → FolderPicker)
        - Set processingSlashCmd if slash command
        - await store.startSession(text, cwd, attachments)
        - goto(/chat?run=${runId})
        - Dispatch "ocv:runs-changed" event
        - Re-load CLI version info

     b. Stopped stream session (useStreamSession && !sessionAlive && session_id):
        - Set processingSlashCmd if slash command
        - await handleResume("resume", undefined, text, attachments)
        (Atomic resume + send — message written to CLI stdin at spawn)

     c. Subsequent message (session alive):
        - Set processingSlashCmd if slash command
        - await store.sendMessage(text, attachments)
        - Re-focus prompt input
```

### store.sendMessage() (session-store.svelte.ts line 1874)

```
sendMessage(text, attachments)
  1. Guard: !this.run → return
  2. Clear error, invalidate idle snapshot
  3. Two paths:
     a. Stream session (useStreamSession && sessionAlive):
        - Push optimistic user message (_pushOptimisticUser)
        - api.sendSessionMessage(runId, text, mapAttachments(attachments))
        - Start response timeout (60s) unless slash command
     b. Pipe/PTY mode:
        - Set phase to "running"
        - api.sendChatMessage(runId, text, attachments)
```

### store.startSession() (session-store.svelte.ts line 1759)

```
startSession(prompt, cwd, attachments, permissionModeOverride?)
  1. Set phase to "spawning"
  2. Refresh platformId and permissionMode from latest settings
  3. api.startRun(prompt, cwd, agent, model, ...) → creates TaskRun
  4. Set store.run = run
  5. Push optimistic user message
  6. startSpawnTimeout(runId) — 30s timeout if CLI never responds
  7. middleware.subscribeCurrent(runId, this)
  8. api.startSession(runId) → establishes stream connection
  9. Return runId
```

---

## 6. Template Structure Map

### Outer Layout (line 3931)

```
<div class="relative flex h-full overflow-hidden bg-background">
  <!-- Page-level drag overlay -->
  {#if pageDragActive || dragProcessing}
    <DragOverlay />
  {/if}

  <!-- Main content area -->
  <div class="flex flex-1 flex-col min-w-0 relative">
    <!-- Status bar (SessionStatusBar) -->
    <!-- MCP panel (floating) -->
    <!-- Conversation stage -->
    <div class="chat-conversation-stage">
      {#if store.useStreamSession}
        <!-- API mode: chat messages -->
        <div class="chat-messages-scroll" bind:this={chatAreaRef} onscroll={handleChatScroll}>
          {#if welcomeVisible}
            <!-- Welcome state: logo, quick actions, auth badge -->
          {:else if routeRunLoadFailed}
            <!-- Error state: retry button -->
          {:else if routeRunPending || loading}
            <!-- Loading spinner -->
          {:else}
            <!-- Timeline: data-conversation-root -->
            <!-- Fork badge (if parent_run_id) -->
            <!-- View mode toggle -->
            <!-- Progressive render sentinel -->
            <!-- #each visibleTimeline as entry -->
            <!-- Output mode working hint -->
            <!-- Rewind markers -->
            <!-- Last turn usage -->
            <!-- Active team runs -->
            <!-- Hook callbacks -->
            <!-- Thinking panel -->
            <!-- Streaming text -->
            <!-- Slash command indicator -->
            <!-- Thinking indicator -->
          {/if}
        </div>

        <!-- Scroll-to-bottom hint -->
      {:else if store.run && !pending}
        <!-- CLI mode: XTerminal -->
      {:else}
        <!-- CLI mode: welcome state -->
      {/if}

      <!-- Fork overlay (absolute) -->
      <!-- Classified error card (absolute) -->
    </div>

    <!-- Chat input dock (absolute, bottom) -->
    <div class="chat-input-dock">
      <!-- Resume warning -->
      <!-- Permission panel -->
      <!-- Elicitation dialog -->
      <!-- BTW side question drawer -->
      <!-- Created files panel -->
      <!-- Insight card -->
      <!-- Ralph loop status bar -->
      <!-- PromptInput -->
      <!-- Team hint -->
    </div>
  </div>

  <!-- ToolActivity sidebar (right) -->
  <ToolActivity timeline={store.timeline} tools={store.tools} ... />

  <!-- Modals and overlays -->
  <RewindModal />
  <ShortcutHelpPanel />
  <HtmlReportPreview />
  <FolderPicker />
  <TeamDispatchConfirm />
  <!-- Chat toast -->
</div>
```

### Key Snippets

- `initHintCard()`: Project init hint (CLAUDE.md not found)
- `heroMetaItems()`: CLI version, platform, auth info footer
- `heroMetaFooter()`: Wraps heroMetaItems for welcome screen

### Conditional Rendering Summary

| Condition | What Renders |
|-----------|-------------|
| `welcomeVisible` | Welcome screen with quick actions, continue button |
| `routeRunLoadFailed` | Error state with retry button |
| `routeRunPending \|\| loading` | Loading spinner |
| `store.useStreamSession && !welcome && !loading && !failed` | Full timeline |
| `!store.useStreamSession && store.run && !pending` | XTerminal (CLI mode) |
| `!store.useStreamSession && (!store.run \|\| pending)` | CLI welcome state |
| `forkOverlay` | Fork progress/error overlay |
| `store.error && !forkOverlay` | Classified error card |
| `showPermissionPanel` | Floating permission panel |
| `store.hasElicitation` | Elicitation dialog |

---

## 7. Risk Assessment

### Most Tightly Coupled Areas

1. **store.timeline -> timelinePresentation -> visibleTimeline**: The entire rendering pipeline depends on `store.timeline` structure. The `computeTimelinePresentation()` function (which doesn't exist on disk yet — see note below) is the single point where raw timeline becomes renderable. If this function changes, every downstream derived variable breaks.

2. **burstCollapse <-> toolBursts <-> visibleTimeline**: The burst collapse system indexes into `visibleTimeline` by position. If the timeline slice changes, burst indices become invalid. The `syncStates()` must be called whenever bursts change.

3. **EventMiddleware -> SessionStore -> ChatPage**: The three-layer event pipeline is tightly coupled. Middleware routes events by run_id, store reduces them into state, ChatPage reacts to state changes. Any change to the event schema propagates through all three.

### State Variables with Most Dependencies

1. **`store.timeline`**: Feeds into `timelinePresentation`, `rewindCandidates`, `userHistory`, `insight`, `ToolActivity`, and every rendering path
2. **`store.run`**: Used in 40+ template bindings for conditional rendering, phase checks, ID passing
3. **`store.phase`**: Drives `sending`, `welcomeVisible`, `routeRunPending`, permission visibility, input disabled state, thinking visibility
4. **`store.sessionAlive`**: Controls permission panel, resume button, rewind availability, input state
5. **`processVisibility`**: Controls view mode toggle, tool rendering mode, command output visibility, sidebar collapse

### Highest-Risk Extraction Targets

1. **Timeline rendering block** (lines 4321-4517): The `#each visibleTimeline` loop with its complex conditional rendering for each entry kind. This is the heart of the page and touches burst collapse, batch groups, usage annotations, claude turn starts, and process visibility — all local derived state.

2. **Send message function** (lines 1951-2084): Contains first-message/run-creation logic, remote host validation, folder picker integration, team trigger detection, and three distinct send paths. Highly coupled to `store`, `router`, `remoteHosts`, `settings`.

3. **Load chain effects** (lines 1475-1555): The run-loading effects are the most critical state synchronization point. They coordinate middleware subscription, loadRunProgressive, resume handling, and scrollTo navigation.

4. **Permission handling** (scattered): `handlePermissionRespond`, `handleToolAnswer`, `handleToolApprove` are called from template event handlers and interact with store's timeline entries directly.

### What Would Break if store.timeline Changed Structure

- **Every `#each visibleTimeline` rendering path**: User, assistant, tool, command_output/separator blocks all destructure specific fields
- **burstCollapse**: Index-based references to timeline entries would become stale
- **rewindCandidates**: Filters for `kind === "user"` with `cliUuid`
- **userHistory**: Filters for `kind === "user"` content
- **computeTimelinePresentation**: All downstream derived variables
- **ToolActivity sidebar**: Receives `store.timeline` directly
- **insight composable**: Reads timeline for report generation
- **EventMiddleware batch processing**: The `_reduce()` method assumes specific event shapes

### Missing File: timeline-presentation

The import at line 35-38 references `$lib/chat/selectors/timeline-presentation` which exports `computeTimelinePresentation` and `getInitialRenderLimit`. **This file does not exist on disk** — `src/lib/chat/selectors/` directory does not exist. This is either:
- A planned extraction that hasn't been completed
- A file that was deleted but the import wasn't cleaned up
- A file in a different branch

The page will fail to compile without this file. The `chat-page-store.ts` file at `src/routes/chat/chat-page-store.ts` contains related helper functions (`computeVisibleTimeline`, `computeUsageAnnotations`, `computeClaudeTurnStarts`, etc.) but does NOT export `computeTimelinePresentation` or `getInitialRenderLimit`.
