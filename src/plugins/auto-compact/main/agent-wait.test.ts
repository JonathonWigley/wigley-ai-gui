import { describe, expect, it } from 'vitest';
import {
  type AgentEvent,
  MAIN_AGENT_ID,
  type UsageAgentEvent,
} from '../../../contracts/agent';
import {
  CHECKLIST_STAGE,
  CHECKLIST_WORKFLOW_ID,
  type SessionFlow,
  sampleFlow,
} from '../../workflow/contract';
import {
  type AgentWaits,
  agentWaitReason,
  type WaitPhase,
  withCompactStarted,
  withFlow,
  withWaitEvent,
} from './agent-wait';

const MIN_TOKENS = 200000;

function flowOf(
  overrides: Partial<Omit<SessionFlow, 'sessionId' | 'projectDir'>> = {},
): SessionFlow {
  return sampleFlow('s1', '/repo', {
    workflow: 'medium',
    stage: 'build',
    runningSubagents: ['agent-1'],
    ...overrides,
  });
}

function usage(contextTokens: number): UsageAgentEvent {
  return {
    type: 'usage',
    agentId: MAIN_AGENT_ID,
    at: 900_000,
    contextTokens,
    contextWindow: 1_000_000,
    autocompact: { configured: null, reported: null },
    cacheExpiresAt: null,
    spendUsd: null,
  };
}

const REASON = 'auto · agents running · 214k';

describe('agent wait', () => {
  it.each<{
    case: string;
    flow?: SessionFlow;
    noFlow?: boolean;
    tokens?: number | null;
    minTokens?: number;
    phase?: WaitPhase;
    expected: string | null;
  }>([
    { case: 'WaitingAbove', expected: REASON },
    {
      case: 'SmallLevel',
      flow: flowOf({ workflow: 'small' }),
      expected: REASON,
    },
    { case: 'NoWorkflow', flow: flowOf({ workflow: null }), expected: null },
    {
      case: 'ChecklistFlow',
      flow: flowOf({ workflow: CHECKLIST_WORKFLOW_ID, stage: CHECKLIST_STAGE }),
      expected: null,
    },
    { case: 'NoFlow', noFlow: true, expected: null },
    { case: 'ThresholdZero', minTokens: 0, expected: null },
    { case: 'Below', tokens: 150_000, expected: null },
    { case: 'AtThreshold', tokens: 200_000, expected: null },
    { case: 'NoUsage', tokens: null, expected: null },
    {
      case: 'TurnRunning',
      flow: flowOf({ turnRunning: true }),
      expected: null,
    },
    {
      case: 'NoSubagents',
      flow: flowOf({ runningSubagents: [] }),
      expected: null,
    },
    { case: 'CompactingThisWait', phase: 'compacting', expected: null },
    { case: 'SpentThisWait', phase: 'spent', expected: null },
  ])('agentWaitReason_$case', (row) => {
    const tokens = row.tokens === undefined ? 214_000 : row.tokens;
    const reason = agentWaitReason({
      flow: row.noFlow === true ? undefined : (row.flow ?? flowOf()),
      usage: tokens === null ? null : usage(tokens),
      minTokens: row.minTokens ?? MIN_TOKENS,
      phase: row.phase,
    });
    expect(reason).toBe(row.expected);
  });

  const turnStarted: AgentEvent = { type: 'turnStarted', at: 1 };
  const turnEnded: AgentEvent = { type: 'turnEnded', at: 1 };
  const sessionEnded: AgentEvent = { type: 'sessionEnded', at: 1 };
  const compactionEnded: AgentEvent = {
    type: 'compactionEnded',
    at: 1,
    trigger: 'app',
    outcome: 'done',
    beforeTokens: null,
    durationMs: null,
  };
  const agentFinished: AgentEvent = {
    type: 'agentFinished',
    at: 1,
    agentId: 'agent-1',
    outcome: 'done',
  };

  // Each step is an agent event or a flow, applied in order from one start.
  it.each<{
    case: string;
    start: WaitPhase | undefined;
    steps: (AgentEvent | { flow: SessionFlow | undefined })[];
    expected: WaitPhase | undefined;
  }>([
    {
      case: 'CompactionEnd_Spends',
      start: 'compacting',
      steps: [compactionEnded],
      expected: 'spent',
    },
    {
      case: 'CompactionsOwnTurnStart_KeepsCompacting',
      start: 'compacting',
      steps: [turnStarted, turnEnded],
      expected: 'compacting',
    },
    {
      case: 'SubagentsEmptyMidCompaction_StaysUntilTheEnd',
      start: 'compacting',
      steps: [agentFinished, { flow: flowOf({ runningSubagents: [] }) }],
      expected: 'compacting',
    },
    {
      case: 'MainTurnStartsAfterTheEnd_Rearms',
      start: 'compacting',
      steps: [compactionEnded, turnStarted],
      expected: undefined,
    },
    {
      case: 'SubagentsEmptyAfterTheEnd_Rearms',
      start: 'spent',
      steps: [{ flow: flowOf({ runningSubagents: [] }) }],
      expected: undefined,
    },
    {
      case: 'FlowGone_Rearms',
      start: 'spent',
      steps: [{ flow: undefined }],
      expected: undefined,
    },
    {
      case: 'SubagentsStillRunning_StaysSpent',
      start: 'spent',
      steps: [turnEnded, { flow: flowOf() }],
      expected: 'spent',
    },
    {
      case: 'ProcessEnds_Rearms',
      start: 'compacting',
      steps: [sessionEnded],
      expected: undefined,
    },
    {
      case: 'Armed_EventsChangeNothing',
      start: undefined,
      steps: [compactionEnded, turnStarted, { flow: flowOf() }],
      expected: undefined,
    },
  ])('waitPhase_$case', ({ start, steps, expected }) => {
    let waits: AgentWaits =
      start === undefined ? new Map() : new Map([['s1', start]]);
    for (const step of steps) {
      waits =
        'flow' in step
          ? withFlow(waits, 's1', step.flow)
          : withWaitEvent(waits, 's1', step);
    }
    expect(waits.get('s1')).toBe(expected);
  });

  it('withCompactStarted_MarksOnlyItsSession', () => {
    const waits = withCompactStarted(new Map([['s2', 'spent']]), 's1');
    expect([...waits]).toEqual([
      ['s2', 'spent'],
      ['s1', 'compacting'],
    ]);
  });

  it('withWaitEvent_NoChange_ReturnsSameMap', () => {
    const waits: AgentWaits = new Map([['s1', 'spent']]);
    expect(withWaitEvent(waits, 's1', turnEnded)).toBe(waits);
    expect(withFlow(waits, 's1', flowOf())).toBe(waits);
  });
});
