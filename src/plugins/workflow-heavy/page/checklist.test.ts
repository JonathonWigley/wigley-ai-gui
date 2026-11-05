import { describe, expect, it } from 'vitest';
import type { SessionFlow } from '../../workflow/contract';
import {
  EMPTY_HEAVY_STATE,
  HEAVY_WORKFLOW_ID,
  withHeavyState,
} from '../contract';
import type { PlanProgress } from '../plan-reader';
import { heavyChecklist } from './checklist';

const BASE_FLOW: SessionFlow = {
  sessionId: 's1',
  projectDir: '/r',
  workflow: HEAVY_WORKFLOW_ID,
  movedUpFrom: null,
  stage: 'make',
  checklist: null,
  state: EMPTY_HEAVY_STATE,
  missedLevel: false,
  turnRunning: false,
  runningSubagents: [],
};

// A plan of `tasks`, `[wave, done]` each, named by position.
function planOf(tasks: [wave: number | null, done: boolean][]): PlanProgress {
  const lines = tasks.map(([wave, done], index) => ({
    wave,
    done,
    text: `t${index}`,
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
  withHeavyState(BASE_FLOW, { progress });

describe('heavyChecklist', () => {
  it('heavyChecklist_MapsThePlan: progress null gives null', () => {
    expect(heavyChecklist(flowWith(null))).toBeNull();
  });

  it.each<{
    name: string;
    tasks: [wave: number | null, done: boolean][];
    view: unknown;
  }>([
    {
      name: 'one group per wave',
      tasks: [
        [1, true],
        [1, true],
        [2, false],
      ],
      view: {
        title: 'Plan A',
        checked: 2,
        total: 3,
        groups: [
          {
            title: 'Wave 1',
            items: [
              { text: 't0', done: true },
              { text: 't1', done: true },
            ],
          },
          { title: 'Wave 2', items: [{ text: 't2', done: false }] },
        ],
      },
    },
    {
      name: 'a box with no wave',
      tasks: [[null, false]],
      view: {
        title: 'Plan A',
        checked: 0,
        total: 1,
        groups: [{ title: 'Tasks', items: [{ text: 't0', done: false }] }],
      },
    },
    {
      name: 'a split wave keeps its first place',
      tasks: [
        [1, true],
        [2, false],
        [1, false],
      ],
      view: {
        title: 'Plan A',
        checked: 1,
        total: 3,
        groups: [
          {
            title: 'Wave 1',
            items: [
              { text: 't0', done: true },
              { text: 't2', done: false },
            ],
          },
          { title: 'Wave 2', items: [{ text: 't1', done: false }] },
        ],
      },
    },
    {
      name: 'no boxes',
      tasks: [],
      view: { title: 'Plan A', checked: 0, total: 0, groups: [] },
    },
  ])('heavyChecklist_MapsThePlan: $name', ({ tasks, view }) => {
    expect(heavyChecklist(flowWith(planOf(tasks)))).toEqual(view);
  });
});
