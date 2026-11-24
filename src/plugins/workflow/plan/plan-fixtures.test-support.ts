// The plan capability's test data: the user's `planFormat` from
// docs/features/feature-contributions/design.md § Section: planFormat, and a
// small plan workflow.

import type { PlanFormat } from '../../../contracts/contributions';
import type { DeclaredWorkflow } from '../contract';

export const USER_PLAN_FORMAT: PlanFormat = {
  folder: 'plan-*',
  file: 'plan.md',
  tasksSection: '## Tasks',
  groupHeading: { pattern: '^### Wave (\\d+)', title: 'Wave {1}' },
  titleSuffix: ' — plan',
  counters: {
    reviewRounds: {
      section: '## Run log',
      heading: '### Review rounds',
      itemPrefix: '- ',
    },
  },
  taskDocs: {
    link: 'bareMd',
    statusField: 'Status',
    statusLines: 15,
    statuses: ['not started', 'in progress', 'done'],
    running: 'in progress',
  },
  verificationTask: { lastTaskDocLacking: 'Rung' },
};

export const PLAN_WORKFLOW_ID = 'test:plan';
export const PLAN_SKILL = 'test:make';

// A two-stage plan workflow in `USER_PLAN_FORMAT`: `make`, entered by
// `test:make` with its plan from the argument and recording `reviewRounds`,
// and `closed`, which finishes and reopens, entered when the plan is gone
// after a read. Each call builds a fresh copy.
export function planWorkflowFixture(): DeclaredWorkflow {
  return {
    id: PLAN_WORKFLOW_ID,
    pluginName: 'test',
    planFormat: structuredClone(USER_PLAN_FORMAT),
    decl: {
      id: 'plan',
      label: 'Plan',
      badge: 'P',
      order: 30,
      claims: [PLAN_SKILL],
      sidePane: { kind: 'plan', title: 'Plan' },
      stages: [
        {
          id: 'make',
          label: 'Make',
          status: 'busy',
          records: ['reviewRounds'],
          enter: [{ skill: PLAN_SKILL, planFromArgs: true }],
        },
        {
          id: 'closed',
          label: 'Close',
          status: 'finishing',
          finishes: true,
          reopens: true,
          enter: [{ event: 'planGone', from: ['make'], when: ['planRead'] }],
        },
      ],
    },
  };
}
