import type { Clock } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import {
  DEMO_TASK_IDS,
  type RunHistoryEntry,
  type ScheduledTaskView,
} from '../contract';
import { nextOccurrence } from '../schedule';

export interface DemoTasks {
  // Replaces any views shown; the dispose clears them unless a later `show` replaced them.
  show(views: readonly ScheduledTaskView[]): Disposable;
  views(): ScheduledTaskView[];
  has(taskId: string): boolean;
  setPaused(taskId: string, paused: boolean): void;
  markViewed(rowId: string): void;
  // Each demo entry's rowId once, oldest first.
  runRows(): string[];
  // The rows of finished entries not yet viewed.
  unviewedRows(): string[];
  onChanged(listener: () => void): Disposable;
}

const DEMO_IDS: readonly string[] = Object.values(DEMO_TASK_IDS);

export function isDemoTaskId(taskId: string): boolean {
  return DEMO_IDS.includes(taskId);
}

// The demo step's task views, in memory only: nothing here reaches the task file, history, the planner or the
// session host. A resumed task's next run is its schedule's next occurrence after the moment it was resumed.
export function createDemoTasks(clock: Clock): DemoTasks {
  let shown: ScheduledTaskView[] = [];
  // Each `show` gets a fresh token, so a stale dispose leaves a later show alone.
  let showToken: object | null = null;
  const listeners = new Set<() => void>();

  const changed = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const rowsOf = (entries: readonly RunHistoryEntry[]): string[] => {
    const rows: string[] = [];
    for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
      if (entry.rowId !== null && !rows.includes(entry.rowId)) {
        rows.push(entry.rowId);
      }
    }
    return rows;
  };

  const entries = (): RunHistoryEntry[] =>
    shown.flatMap((view) => view.history);

  return {
    show(views) {
      const token = {};
      showToken = token;
      shown = [...views];
      changed();
      return {
        dispose() {
          if (showToken !== token) {
            return;
          }
          showToken = null;
          shown = [];
          changed();
        },
      };
    },
    views: () => [...shown],
    has: (taskId) => shown.some((view) => view.task.id === taskId),
    setPaused(taskId, paused) {
      shown = shown.map((view) =>
        view.task.id === taskId
          ? {
              ...view,
              task: { ...view.task, paused },
              nextRun: paused
                ? null
                : nextOccurrence(view.task.schedule, clock.now()),
            }
          : view,
      );
      changed();
    },
    markViewed(rowId) {
      const isUnviewedOfRow = (entry: RunHistoryEntry) =>
        entry.rowId === rowId && entry.outcome === 'finished' && !entry.viewed;
      if (!entries().some(isUnviewedOfRow)) {
        return;
      }
      shown = shown.map((view) => ({
        ...view,
        history: view.history.map((entry) =>
          isUnviewedOfRow(entry) ? { ...entry, viewed: true } : entry,
        ),
      }));
      changed();
    },
    runRows: () => rowsOf(entries()),
    unviewedRows: () =>
      rowsOf(
        entries().filter(
          (entry) => entry.outcome === 'finished' && !entry.viewed,
        ),
      ),
    onChanged(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}
