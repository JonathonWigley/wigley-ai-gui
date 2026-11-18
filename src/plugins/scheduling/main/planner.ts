import type { RunHistoryEntry, ScheduledTask } from '../contract';
import { latestOccurrence, nextOccurrence } from '../schedule';

export interface PlannedRun {
  taskId: string;
  occurrence: number;
  at: number;
  skipWhileBusy: string | null; // the processId of the task's newest history entry with one
}

// One run per task to queue, in task order: a Run now press at `now`, else a catch-up at `now` for the latest
// occurrence missed since the task's last edit, its newest history occurrence and `catchUpFloor`, else the next
// occurrence. None for a paused task or a spent one-time task. Reads no clock: `now` is the caller's.
export function planRuns(input: {
  tasks: readonly ScheduledTask[];
  history: readonly RunHistoryEntry[];
  runNow: readonly string[]; // task ids pressed since the last plan
  now: number;
  // No catch-up window starts before it; null for no floor. The main part passes its start time when history.json
  // failed to load, so a history it could not read fires no catch-up.
  catchUpFloor: number | null;
}): PlannedRun[] {
  const { now, catchUpFloor } = input;
  const pressed = new Set(input.runNow);
  const runs: PlannedRun[] = [];
  for (const task of input.tasks) {
    if (task.paused) {
      continue;
    }
    const entries = input.history.filter((entry) => entry.taskId === task.id);
    const timing = pressed.has(task.id)
      ? { occurrence: now, at: now }
      : plannedTiming(task, entries, now, catchUpFloor);
    if (timing !== null) {
      runs.push({
        taskId: task.id,
        ...timing,
        skipWhileBusy: newestProcessId(entries),
      });
    }
  }
  return runs;
}

// A catch-up at `now` for the latest occurrence missed since the window start, else the next occurrence; null for a
// spent one-time task.
function plannedTiming(
  task: ScheduledTask,
  entries: readonly RunHistoryEntry[],
  now: number,
  catchUpFloor: number | null,
): { occurrence: number; at: number } | null {
  const since = Math.max(
    task.updatedAt,
    ...entries.map((entry) => entry.occurrence),
    catchUpFloor ?? Number.NEGATIVE_INFINITY,
  );
  const missed = latestOccurrence(task.schedule, since, now);
  if (missed !== null) {
    return { occurrence: missed, at: now };
  }
  const next = nextOccurrence(task.schedule, now);
  return next === null ? null : { occurrence: next, at: next };
}

// The processId of the entry with the greatest `at` among those with one; skipped and failed entries carry none.
function newestProcessId(entries: readonly RunHistoryEntry[]): string | null {
  let newest: RunHistoryEntry | null = null;
  for (const entry of entries) {
    const isNewerRun =
      entry.processId !== null && (newest === null || entry.at > newest.at);
    if (isNewerRun) {
      newest = entry;
    }
  }
  return newest?.processId ?? null;
}
