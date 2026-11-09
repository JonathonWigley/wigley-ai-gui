import { describe, expect, it } from 'vitest';
import type { SessionFlow, WorkflowSignal } from '../../../workflow/contract';
import { foldFlow, newFlow } from '../../../workflow/flow';
import type { PlanProgress } from '../../../../shared/plan-progress';
import {
  LARGE_WORKFLOW_ID,
  largeSignal,
  type LargeState,
  largeStateOf,
  withLargeState,
} from '../../contract';
import { largeMainWorkflow } from '../../large-workflow';

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

type FlowFields = Partial<SessionFlow & LargeState>;

// An explore flow with a plan written, its progress read with three boxes, and
// nothing busy, unless the row's fields say otherwise.
function flowWith(fields: FlowFields): SessionFlow {
  const { planDir, progress: read, ...flow } = fields;
  return withLargeState(
    {
      ...newFlow('s1', '/r'),
      workflow: LARGE_WORKFLOW_ID,
      stage: 'explore',
      ...flow,
    },
    {
      planDir: planDir === undefined ? PLAN_DIR : planDir,
      progress: read === undefined ? progress(3) : read,
    },
  );
}

function skillStarted(skill: string): WorkflowSignal {
  return { type: 'skillStarted', skill, args: '', argsPath: null };
}

function foldAll(
  flow: SessionFlow,
  signals: readonly WorkflowSignal[],
): SessionFlow {
  return signals.reduce(
    (current, signal) => foldFlow(current, signal, [largeMainWorkflow]),
    flow,
  );
}

const TURN_ENDED: WorkflowSignal = { type: 'turnEnded' };

describe('planReadyMainStage', () => {
  it.each<{
    name: string;
    flow: FlowFields;
    signals: readonly WorkflowSignal[];
    expected: FlowFields;
  }>([
    {
      name: 'turnEnded with a plan with boxes',
      flow: {},
      signals: [TURN_ENDED],
      expected: { stage: 'planReady' },
    },
    ...(['interview', 'plan', 'coldRead'] as const).map((stage) => ({
      name: `turnEnded in ${stage}`,
      flow: { stage },
      signals: [TURN_ENDED],
      expected: { stage: 'planReady' },
    })),
    {
      name: 'planChanged with boxes',
      flow: { progress: null },
      signals: [largeSignal({ type: 'planChanged', progress: progress(3) })],
      expected: { stage: 'planReady' },
    },
    {
      name: 'turnEnded with no plan folder',
      flow: { planDir: null },
      signals: [TURN_ENDED],
      expected: { stage: 'explore' },
    },
    {
      name: 'turnEnded with the plan unread',
      flow: { progress: null },
      signals: [TURN_ENDED],
      expected: { stage: 'explore' },
    },
    {
      name: 'turnEnded with a Tasks section holding no box',
      flow: { progress: progress(0) },
      signals: [TURN_ENDED],
      expected: { stage: 'explore' },
    },
    {
      name: 'planChanged while a turn runs',
      flow: { turnRunning: true, progress: null },
      signals: [largeSignal({ type: 'planChanged', progress: progress(3) })],
      expected: { stage: 'explore' },
    },
    {
      name: 'turnEnded while a drafter runs',
      flow: { turnRunning: true, runningSubagents: ['a1'] },
      signals: [TURN_ENDED],
      expected: { stage: 'explore' },
    },
    {
      name: 'subagentFinished of the last subagent waits for the next turn end',
      flow: { runningSubagents: ['a1'] },
      signals: [{ type: 'subagentFinished', agentId: 'a1' }],
      expected: { stage: 'explore' },
    },
    {
      name: 'fileWritten of a plan.md waits for the turn end',
      flow: { turnRunning: true },
      signals: [{ type: 'fileWritten', path: `${PLAN_DIR}/plan.md` }],
      expected: { stage: 'explore' },
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
      expected: { stage: 'explore', planDir: null, progress: null },
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
      expected: { stage: 'explore' },
    },
  ])('$name', ({ flow, signals, expected }) => {
    const folded = foldAll(flowWith(flow), signals);

    expect({ ...folded, ...largeStateOf(folded) }).toMatchObject(expected);
  });
});
