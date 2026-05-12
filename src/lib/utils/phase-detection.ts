export type AgentPhase = 'planning' | 'executing' | 'reviewing' | 'idle';

export function detectPhase(toolName: string, toolStatus: string, isLastTool: boolean): AgentPhase {
  // Planning phase: ExitPlanMode, AskUserQuestion, Task (planning)
  if (['ExitPlanMode', 'AskUserQuestion'].includes(toolName)) return 'planning';

  // Executing phase: Bash, Edit, Write, Read, Grep, Glob, Agent, WebFetch, WebSearch
  if (
    [
      'Bash',
      'Edit',
      'Write',
      'Read',
      'Grep',
      'Glob',
      'Agent',
      'WebFetch',
      'WebSearch',
      'MultiEdit',
      'NotebookEdit',
    ].includes(toolName)
  )
    return 'executing';

  // Reviewing phase: last tool completed, or summary-type tools
  if (toolStatus === 'success' && isLastTool) return 'reviewing';

  return 'executing';
}

export function getPhaseLabel(phase: AgentPhase): string {
  switch (phase) {
    case 'planning':
      return 'Planning';
    case 'executing':
      return 'Executing';
    case 'reviewing':
      return 'Reviewing';
    case 'idle':
      return 'Idle';
  }
}

export function getPhaseColor(phase: AgentPhase): string {
  switch (phase) {
    case 'planning':
      return 'hsl(var(--miwarp-accent-violet))';
    case 'executing':
      return 'hsl(var(--miwarp-accent-primary))';
    case 'reviewing':
      return 'hsl(var(--miwarp-status-success))';
    case 'idle':
      return 'hsl(var(--muted-foreground))';
  }
}

export function getPhaseIcon(phase: AgentPhase): string {
  // SVG path for each phase
  switch (phase) {
    case 'planning':
      return 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'; // clipboard check
    case 'executing':
      return 'M13 10V3L4 14h7v7l9-11h-7z'; // zap
    case 'reviewing':
      return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'; // check circle
    case 'idle':
      return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'; // clock
  }
}
