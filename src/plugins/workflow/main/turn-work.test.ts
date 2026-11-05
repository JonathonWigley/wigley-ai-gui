import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../contracts/agent';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import { createTurnWork } from './turn-work';

const TURN_STARTED: AgentEvent = { type: 'turnStarted', at: 1 };
const COMPACTION_ENDED = { type: 'compactionEnded', at: 1 } as AgentEvent;

function usage(agentId: string): AgentEvent {
  return { type: 'usage', at: 1, agentId } as AgentEvent;
}

function toolStarted(agentId: string): AgentEvent {
  return {
    type: 'toolStarted',
    at: 1,
    agentId,
    toolUseId: 't1',
    tool: 'Read',
    summary: '',
  };
}

describe('createTurnWork', () => {
  it.each<{ name: string; events: AgentEvent[]; worked: boolean }>([
    {
      name: "the main agent's usage",
      events: [TURN_STARTED, usage(MAIN_AGENT_ID)],
      worked: true,
    },
    {
      name: "the main agent's tool",
      events: [TURN_STARTED, toolStarted(MAIN_AGENT_ID)],
      worked: true,
    },
    {
      name: 'a turn with nothing in it',
      events: [TURN_STARTED],
      worked: false,
    },
    {
      name: "a subagent's usage",
      events: [TURN_STARTED, usage('sub-1')],
      worked: false,
    },
    {
      name: "a subagent's tool",
      events: [TURN_STARTED, toolStarted('sub-1')],
      worked: false,
    },
    {
      name: 'the usage of a compaction',
      events: [TURN_STARTED, COMPACTION_ENDED, usage(MAIN_AGENT_ID)],
      worked: false,
    },
    {
      name: 'a reply after the usage of a compaction',
      events: [
        TURN_STARTED,
        COMPACTION_ENDED,
        usage(MAIN_AGENT_ID),
        usage(MAIN_AGENT_ID),
      ],
      worked: true,
    },
    {
      name: 'a new turn after work',
      events: [TURN_STARTED, usage(MAIN_AGENT_ID), TURN_STARTED],
      worked: false,
    },
  ])('$name → $worked', ({ events, worked }) => {
    const turnWork = createTurnWork();

    for (const event of events) {
      turnWork.note('s1', event);
    }

    expect(turnWork.worked('s1')).toBe(worked);
    expect(turnWork.worked('s2')).toBe(false);
  });

  it('forget drops the session', () => {
    const turnWork = createTurnWork();
    turnWork.note('s1', toolStarted(MAIN_AGENT_ID));

    turnWork.forget('s1');

    expect(turnWork.worked('s1')).toBe(false);
  });
});
