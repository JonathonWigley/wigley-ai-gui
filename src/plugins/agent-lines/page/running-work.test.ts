import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type {
  Roster,
  RosterAgent,
  RosterOutcome,
  RosterTask,
} from '../../agents/contract';
import { runningWork } from './running-work';

function agent(
  agentId: string,
  startedAt: number,
  outcome: RosterOutcome = 'running',
): RosterAgent {
  return {
    agentId,
    agentType: 'Explore',
    name: agentId,
    description: `${agentId}'s work`,
    startedAt,
    model: null,
    effort: null,
    spendUsd: null,
    tools: [],
    outcome,
  };
}

function task(
  taskId: string,
  startedAt: number,
  outcome: RosterOutcome = 'running',
): RosterTask {
  return {
    taskId,
    agentId: MAIN_AGENT_ID,
    description: `${taskId}'s command`,
    command: null,
    startedAt,
    outcome,
  };
}

describe('runningWork', () => {
  it.each<{ name: string; roster: Roster; expected: unknown }>([
    { name: 'empty', roster: { agents: [], tasks: [] }, expected: null },
    {
      name: 'only finished',
      roster: {
        agents: [agent('a', 10, 'done')],
        tasks: [task('t', 5, 'done')],
      },
      expected: null,
    },
    {
      name: 'earliest running task wins',
      roster: {
        agents: [agent('a', 30), agent('b', 20, 'done')],
        tasks: [task('t', 25), task('u', 1, 'done')],
      },
      expected: { startedAt: 25, agentCount: 1, taskCount: 1 },
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
