import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../contract';
import { foldFlow, newFlow } from '../../flow';
import type { PlanProgress } from '../../plan-reader';
import { BUILT_IN_MAIN_STAGES } from '../index';

const PLAN_DIR = '/r/docs/features/f/plan-f';

function progress(total: number): PlanProgress {
  return {
    checked: 0,
    total,
    wave: total > 0 ? 1 : null,
    reviewRounds: 0,
    title: 'F',
    tasks: [],
  };
}

// A feature flow with a plan written, its progress read with three boxes, and
// nothing busy, unless the row's fields say otherwise.
function flowWith(fields: Partial<SessionFlow>): SessionFlow {
  return {
    ...newFlow('s1', '/r'),
    stage: 'feature',
    planDir: PLAN_DIR,
    progress: progress(3),
    ...fields,
  };
}

function skillStarted(skill: string): WorkflowSignal {
  return { type: 'skillStarted', skill, args: '', argsPath: null };
}

function foldAll(
  flow: SessionFlow,
  signals: readonly WorkflowSignal[],
): SessionFlow {
  return signals.reduce(
    (current, signal) => foldFlow(current, signal, BUILT_IN_MAIN_STAGES),
    flow,
  );
}

const TURN_ENDED: WorkflowSignal = { type: 'turnEnded' };

describe('planReadyMainStage', () => {
  it.each<{
    name: string;
    flow: Partial<SessionFlow>;
    signals: readonly WorkflowSignal[];
    expected: Partial<SessionFlow>;
  }>([
    {
      name: 'turnEnded with a plan with boxes',
      flow: {},
      signals: [TURN_ENDED],
      expected: { stage: 'planReady' },
    },
    {
      name: 'planChanged with boxes',
      flow: { progress: null },
      signals: [{ type: 'planChanged', progress: progress(3) }],
      expected: { stage: 'planReady' },
    },
    {
      name: 'turnEnded with no plan folder',
      flow: { planDir: null },
      signals: [TURN_ENDED],
      expected: { stage: 'feature' },
    },
    {
      name: 'turnEnded with the plan unread',
      flow: { progress: null },
      signals: [TURN_ENDED],
      expected: { stage: 'feature' },
    },
    {
      name: 'turnEnded with a Tasks section holding no box',
      flow: { progress: progress(0) },
      signals: [TURN_ENDED],
      expected: { stage: 'feature' },
    },
    {
      name: 'planChanged while a turn runs',
      flow: { turnRunning: true, progress: null },
      signals: [{ type: 'planChanged', progress: progress(3) }],
      expected: { stage: 'feature' },
    },
    {
      name: 'turnEnded while a drafter runs',
      flow: { turnRunning: true, runningSubagents: ['a1'] },
      signals: [TURN_ENDED],
      expected: { stage: 'feature' },
    },
    {
      name: 'subagentFinished of the last subagent waits for the next turn end',
      flow: { runningSubagents: ['a1'] },
      signals: [{ type: 'subagentFinished', agentId: 'a1' }],
      expected: { stage: 'feature' },
    },
    {
      name: 'fileWritten of a plan.md waits for the turn end',
      flow: { turnRunning: true },
      signals: [{ type: 'fileWritten', path: `${PLAN_DIR}/plan.md` }],
      expected: { stage: 'feature' },
    },
    {
      name: 'turnEnded in make',
      flow: { stage: 'make' },
      signals: [TURN_ENDED],
      expected: { stage: 'make' },
    },
    {
      name: 'wigley:feature from closed clears the plan',
      flow: { stage: 'closed' },
      signals: [skillStarted('wigley:feature')],
      expected: { stage: 'feature', planDir: null, progress: null },
    },
    {
      name: 'wigley:feature-primer from closed clears the plan',
      flow: { stage: 'closed' },
      signals: [skillStarted('wigley:feature-primer')],
      expected: { stage: 'primer', planDir: null, progress: null },
    },
    {
      name: "a closed run's plan never makes the interview plan ready",
      flow: { stage: 'closed' },
      signals: [skillStarted('wigley:feature'), TURN_ENDED],
      expected: { stage: 'feature' },
    },
  ])('$name', ({ flow, signals, expected }) => {
    expect(foldAll(flowWith(flow), signals)).toMatchObject(expected);
  });
});
