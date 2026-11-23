// The four example declarations of docs/features/feature-contributions/design.md
// § Example and its `planFormat`, as test data.

import type {
  PlanFormat,
  WorkflowDecl,
} from '../../../contracts/contributions';
import type {
  ContributionSource,
  Strategy,
} from '../../contributions/contract';
import {
  type DeclaredWorkflow,
  type PlanProgress,
  type PlanState,
  type PlanTaskLine,
  qualifiedWorkflowId,
} from '../contract';

export const DESIGN_PLUGIN = 'wigley';

// The design plugin as a reader sees its source.
export const DESIGN_SOURCE: ContributionSource = {
  pluginName: DESIGN_PLUGIN,
  pluginKey: `${DESIGN_PLUGIN}@market`,
  version: '1.0.0',
  root: `/plugins/${DESIGN_PLUGIN}`,
  harnessId: 'claude',
};

export const DESIGN_SMALL: WorkflowDecl = {
  id: 'small',
  label: 'Small',
  badge: 'S',
  badgeColor: 'var(--wg-status-info)',
  order: 10,
  claims: ['wigley:small'],
  sidePane: { kind: 'checklist', title: 'Checklist' },
  stages: [
    {
      id: 'scope',
      label: 'Scope',
      status: 'busy',
      enter: [{ skill: 'wigley:small' }],
    },
    {
      id: 'build',
      label: 'Build',
      step: 'build',
      runsTasks: true,
      status: 'busy',
      progress: ' {checklist}',
      enter: [{ step: 'build' }],
    },
    {
      id: 'check',
      label: 'Check',
      step: 'check',
      status: 'busy',
      enter: [{ step: 'check' }],
    },
    {
      id: 'land',
      label: 'Land',
      step: 'land',
      slot: 'land',
      status: 'busy',
      enter: [{ step: 'land' }],
    },
    {
      id: 'done',
      label: 'Land',
      step: 'done',
      slot: 'land',
      status: 'finishing',
      finishes: true,
      enter: [{ step: 'done' }],
    },
    {
      id: 'answered',
      label: 'Answered',
      step: 'answered',
      inStepper: false,
      status: 'none',
      finishes: true,
      unseenActivity: { word: 'answered', tone: 'success' },
      enter: [{ step: 'answered' }],
    },
  ],
};

export const DESIGN_MEDIUM: WorkflowDecl = {
  id: 'medium',
  label: 'Medium',
  badge: 'M',
  badgeColor: 'var(--wg-accent)',
  order: 20,
  claims: ['wigley:medium'],
  counters: { fix: { counts: 'fix', resetOn: 'claim' } },
  fixCycles: { counter: 'fix' },
  sidePane: { kind: 'checklist', title: 'Checklist' },
  stages: [
    {
      id: 'interview',
      label: 'Interview',
      status: 'busy',
      enter: [{ skill: 'wigley:medium' }],
    },
    {
      id: 'build',
      label: 'Build',
      step: 'build',
      runsTasks: true,
      status: 'busy',
      progress: ' {checklist}',
      enter: [{ step: 'build' }],
    },
    {
      id: 'review',
      label: 'Review',
      step: 'review',
      status: 'busy',
      enter: [{ step: 'review' }],
    },
    {
      id: 'fix',
      label: 'Fix',
      step: 'fix',
      status: 'busy',
      progress: ' · cycle {counter.fix}',
      enter: [{ step: 'fix' }],
    },
    {
      id: 'land',
      label: 'Land',
      step: 'land',
      slot: 'land',
      status: 'busy',
      enter: [{ step: 'land' }],
    },
    {
      id: 'done',
      label: 'Land',
      step: 'done',
      slot: 'land',
      status: 'finishing',
      finishes: true,
      enter: [{ step: 'done' }],
    },
  ],
};

export const DESIGN_SPIKE: WorkflowDecl = {
  id: 'spike',
  label: 'Spike',
  badge: 'X',
  badgeColor: 'var(--wg-fg-secondary)',
  order: 40,
  claims: ['wigley:spike'],
  sidePane: { kind: 'checklist', title: 'Checklist' },
  stages: [
    {
      id: 'interview',
      label: 'Interview',
      step: 'interview',
      status: 'busy',
      enter: [{ skill: 'wigley:spike' }, { step: 'interview' }],
    },
    {
      id: 'build',
      label: 'Build',
      step: 'build',
      runsTasks: true,
      status: 'busy',
      progress: ' {checklist}',
      enter: [{ step: 'build' }],
    },
    {
      id: 'check',
      label: 'Check',
      step: 'check',
      status: 'busy',
      enter: [{ step: 'check' }],
    },
    {
      id: 'land',
      label: 'Land',
      step: 'land',
      slot: 'land',
      status: 'busy',
      enter: [{ step: 'land' }],
    },
    {
      id: 'done',
      label: 'Land',
      step: 'done',
      slot: 'land',
      status: 'finishing',
      finishes: true,
      enter: [{ step: 'done' }],
    },
  ],
};

export const DESIGN_LARGE: WorkflowDecl = {
  id: 'large',
  label: 'Large',
  badge: 'L',
  badgeColor: 'var(--wg-status-warning)',
  order: 30,
  claims: ['wigley:feature', 'wigley:feature-primer', 'wigley:make'],
  groups: {
    featureRun: ['explore', 'interview', 'plan', 'coldRead', 'planReady'],
  },
  fixCycles: { planCounter: 'reviewRounds' },
  sidePane: { kind: 'plan', title: 'Plan' },
  actions: {
    clearAndMake: {
      kind: 'clearAndSend',
      label: 'Clear & make',
      text: '/wigley:make {plan}',
      risky: true,
      enabled: ['idle'],
    },
    makeInNewSession: {
      kind: 'launch',
      label: 'Make in new session',
      text: '/wigley:make {plan}',
      then: 'handedOff',
      key: '<Leader>wn',
    },
    resumeMake: {
      kind: 'clearAndSend',
      label: 'Resume make',
      text: '/wigley:make {plan}',
      risky: true,
      keyOnly: true,
      available: ['idle', 'planOpen'],
      enabled: ['idle'],
      key: '<Leader>wr',
    },
    openPlan: {
      kind: 'openPlan',
      label: 'Open plan',
      keyOnly: true,
      key: '<Leader>wo',
    },
    retro: {
      kind: 'send',
      label: 'Retro',
      text: '/wigley:retro',
      enabled: ['idle'],
      key: '<Leader>wt',
    },
    dismiss: {
      kind: 'event',
      label: 'Dismiss',
      event: 'dismissed',
      keyOnly: true,
      key: '<Leader>wd',
    },
  },
  stages: [
    {
      id: 'idle',
      label: 'Idle',
      inStepper: false,
      status: 'none',
      enter: [
        { event: 'handedOff', clearsPlan: true },
        { event: 'dismissed', from: ['closed'], clearsPlan: true },
      ],
    },
    {
      id: 'primer',
      label: 'Primer',
      slot: 'start',
      status: 'busy',
      enter: [{ skill: 'wigley:feature-primer', clearsPlan: true }],
    },
    {
      id: 'explore',
      label: 'Explore',
      step: 'explore',
      slot: 'start',
      status: 'busy',
      detail: ['{plan.title}'],
      actions: ['openPlan'],
      enter: [
        { skill: 'wigley:feature', clearsPlan: true },
        { step: 'explore', from: ['featureRun'] },
      ],
    },
    {
      id: 'interview',
      label: 'Interview',
      step: 'interview',
      status: 'busy',
      detail: ['{plan.title}'],
      actions: ['openPlan'],
      enter: [{ step: 'interview', from: ['featureRun'] }],
    },
    {
      id: 'plan',
      label: 'Plan',
      step: 'plan',
      status: 'busy',
      detail: ['{plan.title}'],
      actions: ['openPlan'],
      enter: [{ step: 'plan', from: ['featureRun'] }],
    },
    {
      id: 'coldRead',
      label: 'Cold read',
      step: 'cold_read',
      status: 'busy',
      detail: ['{plan.title}'],
      actions: ['openPlan'],
      enter: [{ step: 'cold_read', from: ['featureRun'] }],
    },
    {
      id: 'planReady',
      label: 'Make',
      slot: 'make',
      status: 'ready',
      detail: ['{plan.title}', '{plan.total} tasks'],
      rowActivity: {
        word: 'ready to make',
        tone: 'attention',
        emphasis: 'raised',
      },
      actions: ['clearAndMake', 'makeInNewSession', 'openPlan'],
      auto: 'clearAndMake',
      enter: [
        {
          event: 'turnEnded',
          from: ['featureRun'],
          when: ['idle', 'planHasTasks'],
        },
        {
          event: 'planChanged',
          from: ['featureRun'],
          when: ['idle', 'planHasTasks'],
        },
      ],
    },
    {
      id: 'make',
      label: 'Make',
      slot: 'make',
      runsTasks: true,
      status: 'busy',
      records: ['reviewRounds'],
      progress: ' {plan.build}',
      detail: ['{plan.build}', 'wave {plan.wave}', '{plan.title}'],
      actions: ['resumeMake', 'openPlan'],
      enter: [{ skill: 'wigley:make', planFromArgs: true }],
    },
    {
      id: 'review',
      label: 'Review',
      status: 'busy',
      progress: ' · round {plan.counter.reviewRounds}',
      detail: [
        'round {plan.counter.reviewRounds}',
        '{plan.checked}/{plan.total}',
        '{plan.title}',
      ],
      actions: ['resumeMake', 'openPlan'],
      enter: [
        { skill: 'wigley:review', from: ['make', 'fix'] },
        {
          event: 'planChanged',
          from: ['make'],
          when: [{ counterRose: 'reviewRounds' }],
        },
      ],
    },
    {
      id: 'fix',
      label: 'Fix',
      step: 'fix',
      status: 'busy',
      progress: ' · cycle {plan.counter.reviewRounds}',
      detail: [
        'cycle {plan.counter.reviewRounds}',
        '{plan.checked}/{plan.total}',
        '{plan.title}',
      ],
      actions: ['resumeMake', 'openPlan'],
      enter: [{ step: 'fix', from: ['make', 'review'] }],
    },
    {
      id: 'closed',
      label: 'Close',
      status: 'finishing',
      finishes: true,
      reopens: true,
      progress: ' · {plan.checked}/{plan.total}',
      detail: ['{plan.title} · done'],
      rowActivity: { word: 'closed', tone: 'success', emphasis: 'raised' },
      actions: ['retro', 'dismiss'],
      enter: [
        {
          event: 'planGone',
          from: ['make', 'review', 'fix'],
          when: ['planRead'],
        },
      ],
    },
  ],
};

export const DESIGN_PLAN_FORMAT: PlanFormat = {
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

// The four declarations in the design's order.
export const DESIGN_WORKFLOWS: readonly WorkflowDecl[] = [
  DESIGN_SMALL,
  DESIGN_MEDIUM,
  DESIGN_SPIKE,
  DESIGN_LARGE,
];

export type DesignWorkflowId = 'small' | 'medium' | 'spike' | 'large';

// One accepted section holding `value`, from plugin `pluginName`.
export function strategyOf<V>(pluginName: string, value: V): Strategy<V> {
  return {
    id: pluginName,
    label: pluginName,
    source: {
      pluginName,
      pluginKey: `${pluginName}@market`,
      version: null,
      root: `/plugins/${pluginName}`,
      harnessId: 'claude',
    },
    value,
  };
}

export const SAMPLE_PLAN_DIR = '/r/docs/features/f/plan-x';

// One plan box in group `group`, done when `done`.
export function taskLine(
  text: string,
  done: boolean,
  fields: Partial<PlanTaskLine> = {},
): PlanTaskLine {
  return {
    group: 1,
    text,
    done,
    file: null,
    status: null,
    verification: false,
    ...fields,
  };
}

// A plan at `SAMPLE_PLAN_DIR`, reported, read as `progress`; the counts come
// from `progress.tasks` unless `progress` names them.
export function samplePlan(
  progress: Partial<PlanProgress> | null,
  fields: Partial<PlanState> = {},
): PlanState {
  const tasks = progress?.tasks ?? [];
  return {
    dir: SAMPLE_PLAN_DIR,
    reported: true,
    unreportedDir: null,
    progress:
      progress === null
        ? null
        : {
            title: 'Sample',
            checked: tasks.filter((task) => task.done).length,
            total: tasks.length,
            wave: null,
            counters: {},
            tasks,
            ...progress,
          },
    snapshots: {},
    ...fields,
  };
}

// The design's declaration `id` as the engine enables it: qualified under the
// design's plugin, with that plugin's `planFormat`. Each call builds a fresh
// copy, so a test may change it.
export function designDeclared(id: DesignWorkflowId): DeclaredWorkflow {
  const decl = DESIGN_WORKFLOWS.find((each) => each.id === id);
  if (decl === undefined) {
    throw new Error(`no design workflow ${id}`);
  }
  return {
    id: qualifiedWorkflowId(DESIGN_PLUGIN, id),
    pluginName: DESIGN_PLUGIN,
    decl: structuredClone(decl),
    planFormat: structuredClone(DESIGN_PLAN_FORMAT),
  };
}
