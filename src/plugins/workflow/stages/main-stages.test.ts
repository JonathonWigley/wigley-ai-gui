import { describe, expect, it } from 'vitest';
import type { MainStage, SessionFlow, WorkflowSignal } from '../contract';
import { newFlow } from '../flow';
import type { PlanProgress } from '../plan-reader';
import { BUILT_IN_MAIN_STAGES } from './index';

const REGISTERED = BUILT_IN_MAIN_STAGES.map((stage) => stage.id);

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
  return {
    ...newFlow('s1', '/r'),
    stage,
    planDir: '/r/plan-f',
    progress: PROGRESS,
    reviewRoundsAtMake: 0,
    hasLeftIdle: true,
  };
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
  { type: 'planChanged', progress: { ...PROGRESS, reviewRounds: 2 } },
  { type: 'planGone' },
  { type: 'handedOff' },
  { type: 'dismissed' },
];

function signalKey(signal: WorkflowSignal): string {
  return signal.type === 'skillStarted' ? signal.skill : signal.type;
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
    id: 'feature',
    signals: ['wigley:feature', 'feature'],
    fromStages: REGISTERED,
  },
  {
    id: 'planReady',
    signals: ['turnEnded', 'planChanged'],
    fromStages: ['feature'],
  },
  { id: 'make', signals: ['wigley:make', 'make'], fromStages: REGISTERED },
  {
    id: 'review',
    signals: ['wigley:review', 'review', 'planChanged'],
    fromStages: ['make'],
  },
  { id: 'closed', signals: ['planGone'], fromStages: ['make', 'review'] },
];

describe('built-in stage rules name only registered stages', () => {
  it.each(RULE_ROWS)('$id', ({ id, signals, fromStages }) => {
    const stage = BUILT_IN_MAIN_STAGES.find((candidate) => candidate.id === id);
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
