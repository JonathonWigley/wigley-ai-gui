import { describe, expect, it } from 'vitest';
import type {
  MainStage,
  SessionFlow,
  WorkflowSignal,
} from '../../workflow/contract';
import { foldFlow, newFlow } from '../../workflow/flow';
import type { PlanProgress } from '../../../shared/plan-progress';
import {
  LARGE_WORKFLOW_ID,
  largeEventOf,
  largeSignal,
  largeStateOf,
  withLargeState,
} from '../contract';
import { largeMainWorkflow } from '../large-workflow';
import { LARGE_MAIN_STAGES } from './index';

const REGISTERED = LARGE_MAIN_STAGES.map((stage) => stage.id);

const PROGRESS: PlanProgress = {
  checked: 2,
  total: 5,
  wave: 1,
  reviewRounds: 1,
  title: 'F',
  tasks: [],
};

// A flow in `stage` that meets every other condition a built-in rule checks:
// a plan read with boxes and a review round since make started, nothing busy.
function flowIn(stage: string): SessionFlow {
  return withLargeState(
    { ...newFlow('s1', '/r'), workflow: LARGE_WORKFLOW_ID, stage },
    {
      planDir: '/r/plan-f',
      planReported: false,
      progress: PROGRESS,
      reviewRoundsAtMake: 0,
      closedFrom: 'review',
    },
  );
}

function skillStarted(skill: string): WorkflowSignal {
  return { type: 'skillStarted', skill, args: '', argsPath: null };
}

const SAMPLE_SIGNALS: readonly WorkflowSignal[] = [
  skillStarted('wigley:feature-primer'),
  skillStarted('wigley:feature'),
  skillStarted('wigley:make'),
  skillStarted('wigley:review'),
  skillStarted('feature-primer'),
  skillStarted('feature'),
  skillStarted('make'),
  skillStarted('review'),
  skillStarted('other:make'),
  { type: 'fileWritten', path: '/r/plan-f/plan.md' },
  { type: 'turnStarted' },
  { type: 'turnEnded' },
  { type: 'subagentStarted', agentId: 'a1' },
  { type: 'subagentFinished', agentId: 'a1' },
  { type: 'cleared' },
  largeSignal({
    type: 'planChanged',
    progress: { ...PROGRESS, reviewRounds: 2 },
  }),
  largeSignal({ type: 'planGone' }),
  largeSignal({ type: 'handedOff' }),
  largeSignal({ type: 'dismissed' }),
  ...REGISTERED.map((step): WorkflowSignal => ({ type: 'stepReported', step })),
];

function signalKey(signal: WorkflowSignal): string {
  switch (signal.type) {
    case 'skillStarted':
      return signal.skill;
    case 'stepReported':
      return `report:${signal.step}`;
    case 'custom':
      return largeEventOf(signal)?.type ?? 'custom';
    default:
      return signal.type;
  }
}

interface Answers {
  // Every stage id the rule returned.
  returned: Set<string>;
  // The signals the rule answered, from any registered stage.
  signals: Set<string>;
  // The registered stages the rule answered from, for any signal.
  fromStages: Set<string>;
}

// Every answer `stage`'s rule gives, over every sample signal from a flow in
// every registered stage.
function answersOf(stage: MainStage): Answers {
  const answers: Answers = {
    returned: new Set(),
    signals: new Set(),
    fromStages: new Set(),
  };
  for (const from of REGISTERED) {
    for (const signal of SAMPLE_SIGNALS) {
      const id = stage.enter(flowIn(from), signal);
      if (id !== null) {
        answers.returned.add(id);
        answers.signals.add(signalKey(signal));
        answers.fromStages.add(from);
      }
    }
  }
  return answers;
}

// A renamed stage id left in another stage's rule turns this red: the rule
// returns an id no stage registers, or a comparison against the old id stops
// it answering a signal or a stage it answered before.
const FEATURE_RUN = ['explore', 'interview', 'plan', 'coldRead', 'planReady'];

const RULE_ROWS: readonly {
  id: string;
  signals: readonly string[];
  fromStages: readonly string[];
}[] = [
  { id: 'idle', signals: ['handedOff', 'dismissed'], fromStages: REGISTERED },
  {
    id: 'primer',
    signals: ['wigley:feature-primer', 'feature-primer'],
    fromStages: REGISTERED,
  },
  {
    id: 'explore',
    signals: ['wigley:feature', 'feature', 'report:explore'],
    fromStages: REGISTERED,
  },
  {
    id: 'interview',
    signals: ['report:interview'],
    fromStages: FEATURE_RUN,
  },
  { id: 'plan', signals: ['report:plan'], fromStages: FEATURE_RUN },
  { id: 'coldRead', signals: ['report:coldRead'], fromStages: FEATURE_RUN },
  {
    id: 'planReady',
    signals: ['turnEnded', 'planChanged'],
    fromStages: ['explore', 'interview', 'plan', 'coldRead'],
  },
  { id: 'make', signals: ['wigley:make', 'make'], fromStages: REGISTERED },
  {
    id: 'review',
    signals: ['wigley:review', 'review', 'planChanged'],
    fromStages: ['make', 'fix'],
  },
  { id: 'fix', signals: ['report:fix'], fromStages: ['make', 'review'] },
  {
    id: 'closed',
    signals: ['planGone', 'planChanged'],
    fromStages: ['make', 'review', 'fix', 'closed'],
  },
];

describe('built-in stage rules name only registered stages', () => {
  it.each(RULE_ROWS)('$id', ({ id, signals, fromStages }) => {
    const stage = LARGE_MAIN_STAGES.find((candidate) => candidate.id === id);
    if (stage === undefined) {
      throw new Error(`no main stage ${id}`);
    }

    const answers = answersOf(stage);

    for (const returned of answers.returned) {
      expect(REGISTERED).toContain(returned);
    }
    expect([...answers.signals].sort()).toEqual([...signals].sort());
    expect([...answers.fromStages].sort()).toEqual([...fromStages].sort());
  });

  it('has a row for every registered stage', () => {
    expect(RULE_ROWS.map((row) => row.id).sort()).toEqual(
      [...REGISTERED].sort(),
    );
  });
});

describe('largeMainWorkflow', () => {
  it.each([
    {
      name: 'wigley:feature claims a new flow at explore',
      signal: skillStarted('wigley:feature'),
      expected: {
        workflow: LARGE_WORKFLOW_ID,
        stage: 'explore',
        movedUpFrom: null,
      },
      planDir: null,
    },
    {
      name: 'wigley:feature-primer claims a new flow, its rule moving it to primer',
      signal: skillStarted('wigley:feature-primer'),
      expected: {
        workflow: LARGE_WORKFLOW_ID,
        stage: 'primer',
        movedUpFrom: null,
      },
      planDir: null,
    },
    {
      name: 'wigley:make of a plan claims a new flow at make, naming the plan',
      signal: {
        ...skillStarted('wigley:make'),
        args: '/r/plan-f',
        argsPath: '/r/plan-f',
      },
      expected: {
        workflow: LARGE_WORKFLOW_ID,
        stage: 'make',
        movedUpFrom: null,
      },
      planDir: '/r/plan-f',
    },
    {
      name: 'wigley:review claims nothing',
      signal: skillStarted('wigley:review'),
      expected: { workflow: null, stage: 'idle', movedUpFrom: null },
      planDir: null,
    },
  ])('$name', ({ signal, expected, planDir }) => {
    const folded = foldFlow(newFlow('s1', '/r'), signal, [largeMainWorkflow]);

    expect(folded).toMatchObject(expected);
    expect(largeStateOf(folded).planDir).toBe(planDir);
  });
});
