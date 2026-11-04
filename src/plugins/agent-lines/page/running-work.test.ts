import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { Roster, RosterAgent, RosterTask } from '../../agents/contract';
import { runningWork } from './running-work';

function agent(agentId: string, startedAt: number): RosterAgent {
  return {
    agentId,
    agentType: 'Explore',
    name: agentId,
    description: `${agentId}'s work`,
    startedAt,
    model: null,
    effort: null,
    spendUsd: null,
    isBackground: false,
    contextTokens: null,
    contextWindow: null,
    tools: [],
  };
}

function task(taskId: string, startedAt: number): RosterTask {
  return {
    taskId,
    agentId: MAIN_AGENT_ID,
    ownerName: 'main',
    description: `${taskId}'s command`,
    command: null,
    startedAt,
  };
}

describe('runningWork', () => {
  it.each<{ name: string; roster: Roster; expected: unknown }>([
    { name: 'empty', roster: { agents: [], tasks: [] }, expected: null },
    {
      name: 'earliest task wins',
      roster: {
        agents: [agent('a', 30), agent('b', 40)],
        tasks: [task('t', 35), task('u', 25), task('v', 50)],
      },
      expected: { startedAt: 25, agentCount: 2, taskCount: 3 },
    },
    {
      name: 'agents only',
      roster: { agents: [agent('a', 30), agent('b', 40)], tasks: [] },
      expected: { startedAt: 30, agentCount: 2, taskCount: 0 },
    },
  ])(
    'runningWork_Roster_CountsRunningFromEarliest ($name)',
    ({ roster, expected }) => {
      expect(runningWork(roster)).toEqual(expected);
    },
  );
});
