import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID, type AgentEvent } from '../../contracts/agent';
import type { RunningAgent } from './contract';
import { foldAgentEvent } from './roster';

const a: RunningAgent = {
  agentId: 'toolu_a',
  agentType: 'Explore',
  description: 'Find adapters',
  startedAt: 1000,
  toolCalls: 0,
};
const b: RunningAgent = {
  agentId: 'toolu_b',
  agentType: 'general-purpose',
  description: 'Write the reducer',
  startedAt: 2500,
  toolCalls: 3,
};

function spawned(agent: RunningAgent): AgentEvent {
  return {
    type: 'agentSpawned',
    at: agent.startedAt,
    agentId: agent.agentId,
    parentAgentId: MAIN_AGENT_ID,
    agentType: agent.agentType,
    description: agent.description,
  };
}

function toolStarted(agentId: string): AgentEvent {
  return {
    type: 'toolStarted',
    at: 4000,
    agentId,
    toolUseId: 'toolu_tool',
    tool: 'Read',
  };
}

function finished(agentId: string): AgentEvent {
  return { type: 'agentFinished', at: 5000, agentId, outcome: 'done' };
}

interface Row {
  case: string;
  before: readonly RunningAgent[];
  event: AgentEvent;
  after?: readonly RunningAgent[];
  same?: true;
}

describe('foldAgentEvent', () => {
  it.each<Row>([
    { case: 'SpawnIntoEmpty', before: [], event: spawned(a), after: [a] },
    {
      case: 'SpawnAppendsInOrder',
      before: [a],
      event: spawned({ ...b, toolCalls: 0 }),
      after: [a, { ...b, toolCalls: 0 }],
    },
    {
      case: 'SpawnOfListedId',
      before: [a],
      event: spawned({ ...a, startedAt: 9000 }),
      same: true,
    },
    {
      case: 'ToolStartedCountsOnlyItsAgent',
      before: [a, b],
      event: toolStarted(b.agentId),
      after: [a, { ...b, toolCalls: 4 }],
    },
    {
      case: 'ToolStartedOnMain',
      before: [a],
      event: toolStarted(MAIN_AGENT_ID),
      same: true,
    },
    {
      case: 'ToolStartedOnUnlistedId',
      before: [a],
      event: toolStarted('toolu_gone'),
      same: true,
    },
    {
      case: 'FinishedRemovesItsAgent',
      before: [a, b],
      event: finished(a.agentId),
      after: [b],
    },
    {
      case: 'FinishedOnUnlistedId',
      before: [a, b],
      event: finished('toolu_gone'),
      same: true,
    },
    {
      case: 'SessionEndedFinishesEveryAgent',
      before: [a, b],
      event: { type: 'sessionEnded', at: 6000 },
      after: [],
    },
    {
      case: 'SessionEndedWhileEmpty',
      before: [],
      event: { type: 'sessionEnded', at: 6000 },
      same: true,
    },
    {
      case: 'Usage',
      before: [a],
      event: {
        type: 'usage',
        agentId: a.agentId,
        at: 7000,
        contextTokens: 1200,
        contextWindow: 200_000,
        autocompact: { configured: null, reported: null },
        cacheExpiresAt: null,
        spendUsd: null,
      },
      same: true,
    },
    {
      case: 'Compacted',
      before: [a],
      event: {
        type: 'compacted',
        at: 7000,
        beforeTokens: 150_000,
        afterTokens: 20_000,
      },
      same: true,
    },
    {
      case: 'UserMessage',
      before: [a],
      event: { type: 'userMessage', at: 7000 },
      same: true,
    },
    {
      case: 'SessionStarted',
      before: [a],
      event: { type: 'sessionStarted', at: 7000 },
      same: true,
    },
    {
      case: 'ToolFinished',
      before: [a],
      event: {
        type: 'toolFinished',
        at: 7000,
        agentId: a.agentId,
        toolUseId: 'toolu_tool',
        ok: true,
      },
      same: true,
    },
  ])(
    'foldAgentEvent_Event_FoldsRoster ($case)',
    ({ before, event, after, same }) => {
      const result = foldAgentEvent(before, event);
      if (same) {
        expect(result).toBe(before);
      } else {
        expect(result).toEqual(after);
      }
    },
  );
});
