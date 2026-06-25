import * as api from "$lib/api";
import type {
  TaskCreateInput,
  TaskEvent,
  TaskLinkArtifactInput,
  TaskLinkRunInput,
  TaskMergeDecision,
  TaskQualityGate,
  TaskReconcileReport,
  TaskRecord,
  TaskReviewDecision,
  TaskStatus,
} from "$lib/types/task";
import { isActiveStatus } from "$lib/chat/task-status-helpers";

export type TaskFilter = "all" | "active" | "attention" | "review" | "done" | "failed" | "archived";

export class TaskCoreStore {
  tasks = $state<TaskRecord[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  selectedTaskId = $state<string | null>(null);
  eventsByTaskId = $state<Record<string, TaskEvent[]>>({});
  lastReconcileReport = $state<TaskReconcileReport | null>(null);
  private inFlight: Promise<void> | null = null;
  private eventFlights = new Map<string, Promise<TaskEvent[]>>();

  get selected(): TaskRecord | null {
    if (!this.selectedTaskId) return null;
    return this.tasks.find((task) => task.id === this.selectedTaskId) ?? null;
  }

  get active(): TaskRecord[] {
    return this.tasks.filter((task) => isActiveStatus(task.status));
  }

  get needsAttention(): TaskRecord[] {
    return this.tasks.filter((task) => task.status === "needs_attention");
  }

  get inReview(): TaskRecord[] {
    return this.tasks.filter((task) => task.status === "review");
  }

  get completed(): TaskRecord[] {
    return this.tasks.filter((task) => task.status === "done");
  }

  get failed(): TaskRecord[] {
    return this.tasks.filter((task) => task.status === "failed");
  }

  get archived(): TaskRecord[] {
    return this.tasks.filter((task) => task.status === "archived");
  }

  countByStatus(): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      draft: 0,
      ready: 0,
      running: 0,
      needs_attention: 0,
      verifying: 0,
      review: 0,
      done: 0,
      failed: 0,
      archived: 0,
    };
    for (const task of this.tasks) {
      counts[task.status] += 1;
    }
    return counts;
  }

  filterBy(predicate: TaskFilter): TaskRecord[] {
    switch (predicate) {
      case "all":
        return this.tasks;
      case "active":
        return this.active;
      case "attention":
        return this.needsAttention;
      case "review":
        return this.inReview;
      case "done":
        return this.completed;
      case "failed":
        return this.failed;
      case "archived":
        return this.archived;
      default:
        return this.tasks;
    }
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async performRefresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.tasks = await api.listTasks();
      this.sortTasks();
    } catch (e) {
      this.error = String(e);
    } finally {
      this.loading = false;
    }
  }

  select(id: string | null): void {
    this.selectedTaskId = id;
  }

  eventsFor(id: string): TaskEvent[] {
    return this.eventsByTaskId[id] ?? [];
  }

  loadEvents(id: string): Promise<TaskEvent[]> {
    const existingFlight = this.eventFlights.get(id);
    if (existingFlight) return existingFlight;

    const current = this.eventsFor(id);
    const sinceSeq = current.at(-1)?.seq ?? 0;
    const flight = api
      .listTaskEvents(id, sinceSeq)
      .then((events) => {
        const merged = new Map<number, TaskEvent>();
        for (const event of [...current, ...events]) merged.set(event.seq, event);
        const ordered = [...merged.values()].sort((a, b) => a.seq - b.seq);
        this.eventsByTaskId = { ...this.eventsByTaskId, [id]: ordered };
        return ordered;
      })
      .finally(() => {
        this.eventFlights.delete(id);
      });
    this.eventFlights.set(id, flight);
    return flight;
  }

  async create(input: TaskCreateInput): Promise<TaskRecord> {
    const task = await api.createTask(input);
    this.upsert(task);
    this.selectedTaskId = task.id;
    return task;
  }

  async load(id: string): Promise<TaskRecord> {
    const task = await api.getTask(id);
    this.upsert(task);
    return task;
  }

  async updateStatus(id: string, status: TaskStatus): Promise<TaskRecord> {
    const task = await api.updateTaskStatus(id, status);
    this.upsert(task);
    return task;
  }

  async linkRun(input: TaskLinkRunInput): Promise<TaskRecord> {
    const task = await api.linkTaskRun(input);
    this.upsert(task);
    return task;
  }

  async linkArtifact(input: TaskLinkArtifactInput): Promise<TaskRecord> {
    const task = await api.linkTaskArtifact(input);
    this.upsert(task);
    return task;
  }

  async setQualityGate(id: string, gate: TaskQualityGate): Promise<TaskRecord> {
    const task = await api.setTaskQualityGate(id, gate);
    this.upsert(task);
    return task;
  }

  async setReviewDecision(id: string, decision: TaskReviewDecision): Promise<TaskRecord> {
    const task = await api.setTaskReviewDecision(id, decision);
    this.upsert(task);
    return task;
  }

  async setMergeDecision(id: string, decision: TaskMergeDecision): Promise<TaskRecord> {
    const task = await api.setTaskMergeDecision(id, decision);
    this.upsert(task);
    return task;
  }

  async reconcileAfterRestart(): Promise<TaskReconcileReport> {
    const report = await api.reconcileTasksAfterRestart();
    this.lastReconcileReport = report;
    if (report.moved_to_needs_attention > 0 || report.recovered_pending_mutations > 0) {
      await this.refresh();
    }
    return report;
  }

  async setWorktree(id: string, worktreePath: string, worktreeBranch: string): Promise<TaskRecord> {
    const task = await api.setTaskWorktree(id, worktreePath, worktreeBranch);
    this.upsert(task);
    return task;
  }

  async trackChangedFile(id: string, path: string): Promise<TaskRecord> {
    const task = await api.trackTaskChangedFile(id, path);
    this.upsert(task);
    return task;
  }

  private upsert(task: TaskRecord): void {
    const index = this.tasks.findIndex((existing) => existing.id === task.id);
    if (index >= 0) {
      this.tasks[index] = task;
    } else {
      this.tasks = [task, ...this.tasks];
    }
    this.sortTasks();
  }

  private sortTasks(): void {
    this.tasks = [...this.tasks].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
}

export const taskCoreStore = new TaskCoreStore();
