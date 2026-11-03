import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type {
  Roster,
  RosterAgent,
  RosterOutcome,
  RosterTask,
} from '../contract';
import { orderRosterLines } from './roster-line-order';

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
  agentId: string,
  startedAt: number,
  outcome: RosterOutcome = 'running',
): RosterTask {
  return {
    taskId,
    agentId,
    description: `${taskId}'s command`,
    command: null,
    startedAt,
    outcome,
  };
}

// Each line as `agent <id>`, `task <id>` or `nested <id>`, so a row reads as
// the order drawn.
function lineNames(roster: Roster): string[] {
  return orderRosterLines(roster).map((line) =>
    line.kind === 'agent'
      ? `agent ${line.agent.agentId}`
      : `${line.isNested ? 'nested' : 'task'} ${line.task.taskId}`,
  );
}

describe('orderRosterLines', () => {
  it.each<{ case: string; roster: Roster; lines: string[] }>([
    { case: 'EmptyRoster', roster: { agents: [], tasks: [] }, lines: [] },
    {
      case: 'AgentsOutOfStartOrder',
      roster: {
        agents: [agent('a3', 3_700), agent('a1', 1_200), agent('a2', 2_900)],
        tasks: [],
      },
      lines: ['agent a1', 'agent a2', 'agent a3'],
    },
    {
      case: 'MainTasksInterleavedWithAgents',
      roster: {
        agents: [agent('a1', 1_200), agent('a2', 4_100)],
        tasks: [
          task('t2', MAIN_AGENT_ID, 5_300),
          task('t1', MAIN_AGENT_ID, 2_600),
        ],
      },
      lines: ['agent a1', 'task t1', 'agent a2', 'task t2'],
    },
    {
      case: 'SubagentTasksRightAfterItNested',
      roster: {
        agents: [agent('a1', 1_200), agent('a2', 2_100)],
        tasks: [
          task('t3', 'a1', 6_400),
          task('main', MAIN_AGENT_ID, 900),
          task('t1', 'a1', 3_500),
          task('later', MAIN_AGENT_ID, 2_800),
        ],
      },
      lines: [
        'task main',
        'agent a1',
        'nested t1',
        'nested t3',
        'agent a2',
        'task later',
      ],
    },
    {
      case: 'TaskWhoseOwnerFinishedIsTopLevel',
      roster: {
        agents: [agent('a2', 2_100)],
        tasks: [task('orphan', 'a1', 1_700)],
      },
      lines: ['task orphan', 'agent a2'],
    },
    {
      case: 'EqualStartKeepsAgentsBeforeTasks',
      roster: {
        agents: [agent('a1', 3_000), agent('a2', 3_000)],
        tasks: [task('t1', MAIN_AGENT_ID, 3_000)],
      },
      lines: ['agent a1', 'agent a2', 'task t1'],
    },
    {
      case: 'FinishedAgentDrawsNoLine',
      roster: {
        agents: [agent('a1', 1_200, 'done'), agent('a2', 2_100)],
        tasks: [],
      },
      lines: ['agent a2'],
    },
    {
      case: 'FinishedTaskDrawsNoLine',
      roster: {
        agents: [agent('a1', 1_200)],
        tasks: [
          task('t1', 'a1', 2_600, 'failed'),
          task('t2', MAIN_AGENT_ID, 3_300, 'done'),
          task('t3', 'a1', 4_000),
        ],
      },
      lines: ['agent a1', 'nested t3'],
    },
    {
      case: 'RunningTaskOfFinishedAgentIsTopLevel',
      roster: {
        agents: [agent('a1', 1_200, 'done'), agent('a2', 2_100)],
        tasks: [task('t1', 'a1', 3_500)],
      },
      lines: ['agent a2', 'task t1'],
    },
  ])('orderRosterLines_Roster_StartOrder ($case)', ({ roster, lines }) => {
    expect(lineNames(roster)).toEqual(lines);
  });
});
