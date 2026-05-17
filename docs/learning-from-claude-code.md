# Learning from Claude Code/Cowork - Design Patterns for MiWarp

Based on research into Claude Code CLI patterns and Codex Cowork design, here are actionable patterns to enhance MiWarp.

## Implemented Features

### 1. Dual-Signal Status Indicators ✅

**File**: `src/lib/components/StatusIcon.svelte`

Dual-signal status combining:
- **State (color)**: running (emerald), waiting (amber), idle (muted), completed (emerald), failed (red)
- **Process type (shape)**: active `*`, exited `·`, sleeping `◈`

```svelte
<StatusIcon status="running" processType="active" size="sm" />
```

### 2. View Mode Toggle ✅

**Files**:
- `src/lib/stores/view-mode-store.svelte.ts` - Store with Normal/Detailed/Summary modes
- `src/lib/components/ViewModeToggle.svelte` - Toggle component

Usage:
```svelte
import { viewModeStore } from "$lib/stores/view-mode-store.svelte";
import ViewModeToggle from "$lib/components/ViewModeToggle.svelte";

// In template
<ViewModeToggle showLabels={true} compact={false} />
```

### 3. Phase-based Workflow Types ✅

**File**: `src/lib/types/skill.ts`

Added types for multi-step workflow support:
- `SkillPhase` - Phase with checkpoint support
- `WorkflowStep` - Individual steps with retry logic
- `WorkflowContext` - Execution context with variables
- `WorkflowCheckpoint` - Saved rollback points
- `createPhase()` / `createSkillStep()` - Helper functions

## Planned Features (Priority Order)

### P1 - Short-term
1. **Context Usage Visualization** - Segmented progress bar showing context consumption
2. **Checkpoint Timeline** - Auto-save before major changes with restore options
3. **Real-time Summaries** - Haiku-powered 15-second summary generation
4. **Peek Panel** - Space key preview without leaving list

### P2 - Medium-term
5. **Skill Pipeline with Retry Logic** - PipelineStage with conditional branching
6. **User Role System** - Role-based skill recommendations
7. **Self-Contained Prompt Validator** - Detect forbidden references

### P3 - Long-term
8. **Cloud Agent + Artifact Delivery** - Remote agent output delivery
9. **Remote Desktop Takeover** - Agent testing verification
10. **Flow Awareness** - Proactive next-step suggestions

## Key Patterns

### Session Actor Pattern
One tokio actor per CLI session, owned child process, all mutations through bounded mpsc mailbox.

### Event Microbatching
```typescript
// 16ms intervals for UI updates
private pendingEvents: Event[] = [];
private flushBatch() {
  const events = this.pendingEvents.splice(0);
  events.forEach(e => this.dispatch(e));
}
```

### Self-Contained Prompt Design
Prompts must be entirely self-contained — never reference "current conversation" or "above".

### Intervention Levels
```typescript
type InterventionLevel = 
  | "autonomous"      // fully autonomous
  | "pre-confirm"      // confirm before execution  
  | "plan-approval"    // require plan approval
  | "full-handoff";    // complete handover
```

## Files to Review

**Frontend**:
- `src/lib/stores/skill-store.svelte.ts` - Enhanced execution
- `src/lib/stores/view-mode-store.svelte.ts` - View modes (NEW)
- `src/lib/components/StatusIcon.svelte` - Dual-signal status (ENHANCED)
- `src/lib/components/ViewModeToggle.svelte` - Toggle component (NEW)

**Backend**:
- `src-tauri/src/agent/mod.rs` - Agent logic
- `src-tauri/src/commands/scheduler.rs` - Task scheduling

## Reference

Claude Code features analyzed:
- Session management with dual-signal status
- Context window visualization
- View mode toggle (Normal/Detailed/Summary)
- Peek panel for quick preview
- Real-time summaries with Haiku
- Phase-based workflow organization
- Checkpoint timeline with rollback
- Self-contained prompt design
- Intervention level control
- Role-based personalization
