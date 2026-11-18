import { describe, expect, it } from 'vitest';
import type {
  RunHistoryEntry,
  ScheduledTask,
  ScheduledTaskView,
} from '../contract';
import { createDemoTasks } from './demo-tasks';

const NOW = Date.parse('2026-11-17T12:00:00Z');

function view(
  id: string,
  history: RunHistoryEntry[] = [],
  change: Partial<ScheduledTask> = {},
): ScheduledTaskView {
  return {
    task: {
      id,
      name: `Task ${id}`,
      target: { projectDir: '/scratch' },
      profile: 'demo',
      prompt: 'Do the thing.',
      schedule: { kind: 'daily', time: '09:00' },
      controls: {},
      paused: false,
      updatedAt: NOW,
      ...change,
    },
    nextRun: NOW + 1_000,
    history,
  };
}

function finished(taskId: string, rowId: string, at: number): RunHistoryEntry {
  return {
    taskId,
    occurrence: at,
    at,
    outcome: 'finished',
    reason: null,
    rowId,
    processId: null,
    viewed: false,
  };
}

describe('createDemoTasks', () => {
  it('pauses only the named task', () => {
    const tasks = createDemoTasks();
    tasks.show([view('demo-a'), view('demo-b')]);

    tasks.setPaused('demo-b', true);

    expect(
      tasks.views().map(({ task, nextRun }) => ({
        id: task.id,
        paused: task.paused,
        nextRun,
      })),
    ).toEqual([
      { id: 'demo-a', paused: false, nextRun: NOW + 1_000 },
      { id: 'demo-b', paused: true, nextRun: null },
    ]);
  });

  it('marks a finished run row viewed', () => {
    const tasks = createDemoTasks();
    tasks.show([
      view('demo-a', [finished('demo-a', 'row-2', NOW - 1_000)]),
      view('demo-b', [finished('demo-b', 'row-1', NOW - 5_000)]),
    ]);
    let changes = 0;
    tasks.onChanged(() => {
      changes += 1;
    });

    tasks.markViewed('row-2');

    expect(tasks.runRows()).toEqual(['row-1', 'row-2']);
    expect(tasks.unviewedRows()).toEqual(['row-1']);
    expect(changes).toBe(1);
  });

  it('leaves a later show alone when an earlier one is disposed', () => {
    const tasks = createDemoTasks();
    const first = tasks.show([view('demo-a')]);
    const second = tasks.show([view('demo-b')]);

    first.dispose();

    expect(tasks.views().map(({ task }) => task.id)).toEqual(['demo-b']);
    second.dispose();
    expect(tasks.views()).toEqual([]);
  });
});
