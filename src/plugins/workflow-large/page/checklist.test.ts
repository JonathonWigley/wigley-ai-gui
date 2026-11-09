import { describe, expect, it } from 'vitest';
import type { SessionFlow } from '../../workflow/contract';
import {
  EMPTY_LARGE_STATE,
  LARGE_WORKFLOW_ID,
  withLargeState,
} from '../contract';
import type { PlanProgress, TaskStatus } from '../../../shared/plan-progress';
import { largeChecklist } from './checklist';

const BASE_FLOW: SessionFlow = {
  sessionId: 's1',
  projectDir: '/r',
  workflow: LARGE_WORKFLOW_ID,
  movedUpFrom: null,
  stage: 'make',
  checklist: null,
  state: EMPTY_LARGE_STATE,
  missedLevel: false,
  turnRunning: false,
  runningSubagents: [],
};

type TaskRow = [wave: number | null, done: boolean, status: TaskStatus | null];

// A plan of `tasks`, `[wave, done, status]` each, named by position.
function planOf(tasks: TaskRow[]): PlanProgress {
  const lines = tasks.map(([wave, done, status], index) => ({
    wave,
    done,
    text: `t${index}`,
    file: null,
    status,
  }));
  return {
    checked: lines.filter((line) => line.done).length,
    total: lines.length,
    wave: null,
    reviewRounds: 0,
    title: 'Plan A',
    tasks: lines,
  };
}

const flowWith = (progress: PlanProgress | null) =>
  withLargeState(BASE_FLOW, { progress });

describe('largeChecklist', () => {
  it('largeChecklist_MapsThePlan: progress null gives null', () => {
    expect(largeChecklist(flowWith(null))).toBeNull();
  });

  it.each<{
    name: string;
    tasks: TaskRow[];
    view: unknown;
  }>([
    {
      name: 'one group per wave',
      tasks: [
        [1, true, null],
        [1, true, null],
        [2, false, null],
      ],
      view: {
        title: 'Plan A',
        checked: 2,
        total: 3,
        groups: [
          {
            title: 'Wave 1',
            items: [
              { text: 't0', done: true, running: false },
              { text: 't1', done: true, running: false },
            ],
          },
          {
            title: 'Wave 2',
            items: [{ text: 't2', done: false, running: false }],
          },
        ],
      },
    },
    {
      name: 'a box with no wave',
      tasks: [[null, false, null]],
      view: {
        title: 'Plan A',
        checked: 0,
        total: 1,
        groups: [
          {
            title: 'Tasks',
            items: [{ text: 't0', done: false, running: false }],
          },
        ],
      },
    },
    {
      name: 'a split wave keeps its first place',
      tasks: [
        [1, true, null],
        [2, false, null],
        [1, false, null],
      ],
      view: {
        title: 'Plan A',
        checked: 1,
        total: 3,
        groups: [
          {
            title: 'Wave 1',
            items: [
              { text: 't0', done: true, running: false },
              { text: 't2', done: false, running: false },
            ],
          },
          {
            title: 'Wave 2',
            items: [{ text: 't1', done: false, running: false }],
          },
        ],
      },
    },
    {
      name: 'a task in progress runs',
      tasks: [
        [1, true, 'done'],
        [1, false, 'in progress'],
        [1, false, 'not started'],
        [1, false, null],
      ],
      view: {
        title: 'Plan A',
        checked: 1,
        total: 4,
        groups: [
          {
            title: 'Wave 1',
            items: [
              { text: 't0', done: true, running: false },
              { text: 't1', done: false, running: true },
              { text: 't2', done: false, running: false },
              { text: 't3', done: false, running: false },
            ],
          },
        ],
      },
    },
    {
      name: 'no boxes',
      tasks: [],
      view: { title: 'Plan A', checked: 0, total: 0, groups: [] },
    },
  ])('largeChecklist_MapsThePlan: $name', ({ tasks, view }) => {
    expect(largeChecklist(flowWith(planOf(tasks)))).toEqual(view);
  });
});
