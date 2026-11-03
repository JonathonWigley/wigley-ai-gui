import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID, type AgentEvent } from '../../contracts/agent';
import type { Roster, RunningAgent, RunningTask } from './contract';
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

// A task the main agent started and one subagent `a` started.
const mainTask: RunningTask = {
  taskId: 'task_main',
  agentId: MAIN_AGENT_ID,
  description: 'npm run build',
  startedAt: 1500,
};
const aTask: RunningTask = {
  taskId: 'task_a',
  agentId: a.agentId,
  description: 'Watch the tests',
  startedAt: 3000,
};

// A roster holding these agents and tasks.
function roster(agents: RunningAgent[], tasks: RunningTask[] = []): Roster {
  return { agents, tasks };
}

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

function taskStarted(task: RunningTask): AgentEvent {
  return {
    type: 'taskStarted',
    at: task.startedAt,
    taskId: task.taskId,
    agentId: task.agentId,
    description: task.description,
  };
}

function taskFinished(taskId: string): AgentEvent {
  return { type: 'taskFinished', at: 5500, taskId, outcome: 'done' };
}

interface Row {
  case: string;
  before: Roster;
  event: AgentEvent;
  after?: Roster;
  same?: true;
}

describe('foldAgentEvent', () => {
  it.each<Row>([
    {
      case: 'SpawnIntoEmpty',
      before: roster([]),
      event: spawned(a),
      after: roster([a]),
    },
    {
      case: 'SpawnAppendsInOrder',
      before: roster([a]),
      event: spawned({ ...b, toolCalls: 0 }),
      after: roster([a, { ...b, toolCalls: 0 }]),
    },
    {
      case: 'SpawnOfListedId',
      before: roster([a]),
      event: spawned({ ...a, startedAt: 9000 }),
      same: true,
    },
    {
      case: 'ToolStartedCountsOnlyItsAgent',
      before: roster([a, b]),
      event: toolStarted(b.agentId),
      after: roster([a, { ...b, toolCalls: 4 }]),
    },
    {
      case: 'ToolStartedOnMain',
      before: roster([a]),
      event: toolStarted(MAIN_AGENT_ID),
      same: true,
    },
    {
      case: 'ToolStartedOnUnlistedId',
      before: roster([a]),
      event: toolStarted('toolu_gone'),
      same: true,
    },
    {
      case: 'FinishedRemovesItsAgent',
      before: roster([a, b]),
      event: finished(a.agentId),
      after: roster([b]),
    },
    {
      case: 'FinishedKeepsItsTask',
      before: roster([a, b], [mainTask, aTask]),
      event: finished(a.agentId),
      after: roster([b], [mainTask, aTask]),
    },
    {
      case: 'TaskStartedAppendsInOrder',
      before: roster([a], [mainTask]),
      event: taskStarted(aTask),
      after: roster([a], [mainTask, aTask]),
    },
    {
      case: 'TaskStartedOfListedId',
      before: roster([a], [mainTask]),
      event: taskStarted({ ...mainTask, startedAt: 9000 }),
      same: true,
    },
    {
      case: 'TaskFinishedRemovesItsTask',
      before: roster([a], [mainTask, aTask]),
      event: taskFinished(mainTask.taskId),
      after: roster([a], [aTask]),
    },
    {
      case: 'TaskFinishedOnUnlistedId',
      before: roster([a], [mainTask]),
      event: taskFinished('task_gone'),
      same: true,
    },
    {
      case: 'FinishedOnUnlistedId',
      before: roster([a, b]),
      event: finished('toolu_gone'),
      same: true,
    },
    {
      case: 'SessionEndedFinishesEveryAgentAndTask',
      before: roster([a, b], [mainTask, aTask]),
      event: { type: 'sessionEnded', at: 6000 },
      after: roster([]),
    },
    {
      case: 'SessionEndedFinishesTasksWithNoAgent',
      before: roster([], [mainTask]),
      event: { type: 'sessionEnded', at: 6000 },
      after: roster([]),
    },
    {
      case: 'SessionEndedWhileEmpty',
      before: roster([]),
      event: { type: 'sessionEnded', at: 6000 },
      same: true,
    },
    {
      case: 'Usage',
      before: roster([a]),
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
      before: roster([a]),
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
      before: roster([a]),
      event: { type: 'userMessage', at: 7000 },
      same: true,
    },
    {
      case: 'SessionStarted',
      before: roster([a]),
      event: { type: 'sessionStarted', at: 7000 },
      same: true,
    },
    {
      case: 'ToolFinished',
      before: roster([a]),
      event: {
        type: 'toolFinished',
        at: 7000,
        agentId: a.agentId,
        toolUseId: 'toolu_tool',
        ok: true,
      },
      same: true,
    },
    {
      case: 'SkillStarted',
      before: roster([a]),
      event: {
        type: 'skillStarted',
        at: 7000,
        agentId: a.agentId,
        skill: 'wigley:make',
        args: '/p/plan-x',
      },
      same: true,
    },
    {
      case: 'FileWritten',
      before: roster([a]),
      event: {
        type: 'fileWritten',
        at: 7000,
        agentId: a.agentId,
        path: '/p/plan-x/plan.md',
      },
      same: true,
    },
    {
      case: 'TurnStarted',
      before: roster([a]),
      event: { type: 'turnStarted', at: 7000 },
      same: true,
    },
    {
      case: 'TurnEnded',
      before: roster([a]),
      event: { type: 'turnEnded', at: 7000 },
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
