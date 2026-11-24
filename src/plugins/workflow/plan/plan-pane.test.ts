import { describe, expect, it } from 'vitest';
import type { PlanFormat } from '../../../contracts/contributions';
import type { PlanProgress, SessionFlow } from '../contract';
import { newFlow } from '../flow';
import { createPlanPane } from './plan-pane';
import {
  PLAN_WORKFLOW_ID,
  USER_PLAN_FORMAT,
} from './plan-fixtures.test-support';

type TaskRow = [group: number | null, done: boolean, status: string | null];

// A plan of `tasks`, `[group, done, status]` each, named by position.
function planOf(tasks: TaskRow[]): PlanProgress {
  const lines = tasks.map(([group, done, status], index) => ({
    group,
    done,
    text: `t${index}`,
    file: null,
    status,
    verification: false,
  }));
  return {
    checked: lines.filter((line) => line.done).length,
    total: lines.length,
    wave: null,
    counters: { reviewRounds: 0 },
    title: 'Plan A',
    tasks: lines,
  };
}

function flowWith(progress: PlanProgress | null): SessionFlow {
  return {
    ...newFlow('s1', '/r'),
    workflow: PLAN_WORKFLOW_ID,
    stage: 'make',
    plan: {
      dir: '/r/plan-a',
      reported: false,
      unreportedDir: null,
      progress,
      snapshots: {},
    },
  };
}

const checklist = (flow: SessionFlow, format: PlanFormat | null) =>
  createPlanPane().checklist(flow, format);

describe('createPlanPane', () => {
  it('checklist_NoPlan: no plan and no agent list gives null', () => {
    expect(checklist(flowWith(null), USER_PLAN_FORMAT)).toBeNull();
    expect(
      checklist({ ...flowWith(null), plan: null }, USER_PLAN_FORMAT),
    ).toBeNull();
  });

  it('checklist_NoPlan: the agent list shows until a plan is read', () => {
    const items = [
      { text: 'Interview', done: true },
      { text: 'Plan', done: false },
    ];
    const flow = { ...flowWith(null), checklist: items };

    expect(checklist(flow, USER_PLAN_FORMAT)).toEqual({
      title: '',
      checked: 1,
      total: 2,
      groups: [{ title: 'Tasks', items }],
    });
    expect(
      checklist(
        { ...flowWith(planOf([[null, false, null]])), checklist: items },
        USER_PLAN_FORMAT,
      ),
    ).toMatchObject({ title: 'Plan A', total: 1 });
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
  ])('checklist_MapsThePlan: $name', ({ tasks, view }) => {
    expect(checklist(flowWith(planOf(tasks)), USER_PLAN_FORMAT)).toEqual(view);
  });

  it('checklist_GroupTitle_FromFormat', () => {
    const format: PlanFormat = {
      ...USER_PLAN_FORMAT,
      groupHeading: { pattern: '^### Phase (\\d+)', title: 'Phase {1} of {1}' },
    };

    const view = checklist(
      flowWith(
        planOf([
          [3, false, null],
          [null, false, null],
        ]),
      ),
      format,
    );

    expect(view?.groups.map((group) => group.title)).toEqual([
      'Phase 3 of 3',
      'Tasks',
    ]);
  });

  it('checklist_NoGroupHeading_OneTasksGroup', () => {
    const format: PlanFormat = { ...USER_PLAN_FORMAT, groupHeading: undefined };

    const view = checklist(
      flowWith(
        planOf([
          [1, false, null],
          [null, false, null],
        ]),
      ),
      format,
    );

    expect(view?.groups).toEqual([
      {
        title: 'Tasks',
        items: [
          { text: 't0', done: false, running: false },
          { text: 't1', done: false, running: false },
        ],
      },
    ]);
  });

  it.each<{ name: string; format: PlanFormat | null }>([
    {
      name: 'no taskDocs',
      format: { ...USER_PLAN_FORMAT, taskDocs: undefined },
    },
    { name: 'no format', format: null },
  ])('checklist_NoTaskDocs_NothingRuns ($name)', ({ format }) => {
    const view = checklist(
      flowWith(planOf([[1, false, 'in progress']])),
      format,
    );

    expect(view?.groups[0].items).toEqual([
      { text: 't0', done: false, running: false },
    ]);
  });
});
