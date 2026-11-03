import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID, type AgentEvent } from '../../contracts/agent';
import type {
  Roster,
  RosterAgent,
  RosterOutcome,
  RosterTask,
  RosterTool,
} from './contract';
import { foldAgentEvent } from './roster';

const a: RosterAgent = {
  agentId: 'toolu_a',
  agentType: 'Explore',
  name: 'find-adapters',
  description: 'Find adapters',
  startedAt: 1000,
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  spendUsd: null,
  tools: [],
  outcome: 'running',
};
const b: RosterAgent = {
  agentId: 'toolu_b',
  agentType: 'general-purpose',
  name: 'general-purpose',
  description: 'Write the reducer',
  startedAt: 2500,
  model: null,
  effort: null,
  spendUsd: 0.0031,
  tools: [
    {
      toolUseId: 'toolu_b1',
      tool: 'Grep',
      summary: 'reducer',
      outcome: 'done',
    },
  ],
  outcome: 'running',
};

// A task the main agent started and one subagent `a` started.
const mainTask: RosterTask = {
  taskId: 'task_main',
  agentId: MAIN_AGENT_ID,
  description: 'npm run build',
  command: 'npm run build -- --watch',
  startedAt: 1500,
  outcome: 'running',
};
const aTask: RosterTask = {
  taskId: 'task_a',
  agentId: a.agentId,
  description: 'Watch the tests',
  command: null,
  startedAt: 3000,
  outcome: 'running',
};

// The tool call every `toolStarted` / `toolFinished` here names, still running.
const runningTool: RosterTool = {
  toolUseId: 'toolu_tool',
  tool: 'Read',
  summary: 'src/main/files/node-files.ts',
  outcome: 'running',
};

function toolWith(outcome: RosterOutcome): RosterTool {
  return { ...runningTool, outcome };
}

// A roster holding these agents and tasks.
function roster(agents: RosterAgent[], tasks: RosterTask[] = []): Roster {
  return { agents, tasks };
}

function spawned(agent: RosterAgent): AgentEvent {
  return {
    type: 'agentSpawned',
    at: agent.startedAt,
    agentId: agent.agentId,
    parentAgentId: MAIN_AGENT_ID,
    agentType: agent.agentType,
    description: agent.description,
    name: agent.name,
    model: agent.model,
    effort: agent.effort,
  };
}

function replied(
  agentId: string,
  model: string,
  spendUsd: number | null,
): AgentEvent {
  return { type: 'agentReplied', at: 3500, agentId, model, spendUsd };
}

function toolStarted(agentId: string): AgentEvent {
  return {
    type: 'toolStarted',
    at: 4000,
    agentId,
    toolUseId: runningTool.toolUseId,
    tool: runningTool.tool,
    summary: runningTool.summary,
  };
}

function toolFinished(agentId: string, ok: boolean): AgentEvent {
  return {
    type: 'toolFinished',
    at: 4500,
    agentId,
    toolUseId: runningTool.toolUseId,
    ok,
  };
}

function finished(
  agentId: string,
  outcome: 'done' | 'failed' = 'done',
): AgentEvent {
  return { type: 'agentFinished', at: 5000, agentId, outcome };
}

function taskStarted(task: RosterTask): AgentEvent {
  return {
    type: 'taskStarted',
    at: task.startedAt,
    taskId: task.taskId,
    agentId: task.agentId,
    description: task.description,
    command: task.command,
  };
}

function taskFinished(
  taskId: string,
  outcome: 'done' | 'failed' = 'done',
): AgentEvent {
  return { type: 'taskFinished', at: 5500, taskId, outcome };
}

const sessionEnded: AgentEvent = { type: 'sessionEnded', at: 6000 };
const userMessage: AgentEvent = { type: 'userMessage', at: 7000 };

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
      event: spawned(b),
      after: roster([a, { ...b, spendUsd: null, tools: [] }]),
    },
    {
      case: 'SpawnOfListedId',
      before: roster([a]),
      event: spawned({ ...a, startedAt: 9000 }),
      same: true,
    },
    {
      case: 'SpawnOfListedFinishedId',
      before: roster([{ ...a, outcome: 'done' }]),
      event: spawned(a),
      same: true,
    },
    {
      case: 'RepliedSetsModelAndSpend',
      before: roster([a, b]),
      event: replied(a.agentId, 'claude-haiku-5-5', 0.0019),
      after: roster([{ ...a, model: 'claude-haiku-5-5', spendUsd: 0.0019 }, b]),
    },
    {
      case: 'RepliedReplacesSpend',
      before: roster([{ ...a, model: 'claude-haiku-5-5', spendUsd: 0.0019 }]),
      event: replied(a.agentId, 'claude-haiku-5-5', 0.0042),
      after: roster([{ ...a, model: 'claude-haiku-5-5', spendUsd: 0.0042 }]),
    },
    {
      case: 'RepliedOnFinishedAgent',
      before: roster([{ ...a, outcome: 'done' }]),
      event: replied(a.agentId, 'claude-haiku-5-5', 0.0042),
      after: roster([
        {
          ...a,
          model: 'claude-haiku-5-5',
          spendUsd: 0.0042,
          outcome: 'done',
        },
      ]),
    },
    {
      case: 'RepliedSameValues',
      before: roster([{ ...b, model: 'claude-opus-5-5' }]),
      event: replied(b.agentId, 'claude-opus-5-5', 0.0031),
      same: true,
    },
    {
      case: 'RepliedOnUnlistedId',
      before: roster([a]),
      event: replied('toolu_gone', 'claude-haiku-5-5', 0.0042),
      same: true,
    },
    {
      case: 'ToolStartedAppendsToItsAgent',
      before: roster([a, b]),
      event: toolStarted(b.agentId),
      after: roster([a, { ...b, tools: [...b.tools, runningTool] }]),
    },
    {
      case: 'ToolStartedOnMain',
      before: roster([a]),
      event: toolStarted(MAIN_AGENT_ID),
      same: true,
    },
    {
      case: 'ToolStartedOnFinishedAgent',
      before: roster([{ ...a, outcome: 'done' }]),
      event: toolStarted(a.agentId),
      same: true,
    },
    {
      case: 'ToolStartedOnUnlistedId',
      before: roster([a]),
      event: toolStarted('toolu_gone'),
      same: true,
    },
    {
      case: 'ToolStartedOfListedToolId',
      before: roster([{ ...a, tools: [toolWith('done')] }]),
      event: toolStarted(a.agentId),
      same: true,
    },
    {
      case: 'ToolFinishedOkIsDone',
      before: roster([{ ...a, tools: [runningTool] }, b]),
      event: toolFinished(a.agentId, true),
      after: roster([{ ...a, tools: [toolWith('done')] }, b]),
    },
    {
      case: 'ToolFinishedErrorIsFailed',
      before: roster([{ ...a, tools: [runningTool] }]),
      event: toolFinished(a.agentId, false),
      after: roster([{ ...a, tools: [toolWith('failed')] }]),
    },
    {
      case: 'ToolFinishedOfFinishedTool',
      before: roster([{ ...a, tools: [toolWith('failed')] }]),
      event: toolFinished(a.agentId, true),
      same: true,
    },
    {
      case: 'ToolFinishedOnUnlistedTool',
      before: roster([a]),
      event: toolFinished(a.agentId, true),
      same: true,
    },
    {
      case: 'FinishedMarksOutcome',
      before: roster([a, b]),
      event: finished(a.agentId, 'failed'),
      after: roster([{ ...a, outcome: 'failed' }, b]),
    },
    {
      case: 'FinishedFailsItsRunningTools',
      before: roster([{ ...b, tools: [...b.tools, runningTool] }]),
      event: finished(b.agentId, 'failed'),
      after: roster([
        { ...b, tools: [...b.tools, toolWith('failed')], outcome: 'failed' },
      ]),
    },
    {
      case: 'FinishedDoneDropsAgent',
      before: roster([a, b]),
      event: finished(a.agentId),
      after: roster([b]),
    },
    {
      case: 'FinishedDoneKeepsItsTask',
      before: roster([a, b], [mainTask, aTask]),
      event: finished(a.agentId),
      after: roster([b], [mainTask, aTask]),
    },
    {
      case: 'FinishedOfFinishedAgent',
      before: roster([{ ...a, outcome: 'done' }]),
      event: finished(a.agentId, 'failed'),
      same: true,
    },
    {
      case: 'FinishedOnUnlistedId',
      before: roster([a, b]),
      event: finished('toolu_gone'),
      same: true,
    },
    {
      case: 'TaskStartedCarriesCommand',
      before: roster([a], [aTask]),
      event: taskStarted(mainTask),
      after: roster([a], [aTask, mainTask]),
    },
    {
      case: 'TaskStartedOfListedId',
      before: roster([a], [mainTask]),
      event: taskStarted({ ...mainTask, startedAt: 9000 }),
      same: true,
    },
    {
      case: 'TaskFinishedMarksOutcome',
      before: roster([a], [mainTask, aTask]),
      event: taskFinished(mainTask.taskId, 'failed'),
      after: roster([a], [{ ...mainTask, outcome: 'failed' }, aTask]),
    },
    {
      case: 'TaskFinishedDoneDropsTask',
      before: roster([a], [mainTask, aTask]),
      event: taskFinished(mainTask.taskId),
      after: roster([a], [aTask]),
    },
    {
      case: 'TaskFinishedOfFinishedTask',
      before: roster([a], [{ ...mainTask, outcome: 'done' }]),
      event: taskFinished(mainTask.taskId, 'failed'),
      same: true,
    },
    {
      case: 'TaskFinishedOnUnlistedId',
      before: roster([a], [mainTask]),
      event: taskFinished('task_gone'),
      same: true,
    },
    {
      case: 'SessionEndedFailsEveryRunningItem',
      before: roster([{ ...a, tools: [runningTool] }, b], [mainTask, aTask]),
      event: sessionEnded,
      after: roster(
        [
          { ...a, tools: [toolWith('failed')], outcome: 'failed' },
          { ...b, outcome: 'failed' },
        ],
        [
          { ...mainTask, outcome: 'failed' },
          { ...aTask, outcome: 'failed' },
        ],
      ),
    },
    {
      case: 'SessionEndedKeepsFinishedOutcomes',
      before: roster(
        [{ ...a, tools: [toolWith('done')], outcome: 'done' }, b],
        [{ ...mainTask, outcome: 'done' }],
      ),
      event: sessionEnded,
      after: roster(
        [
          { ...a, tools: [toolWith('done')], outcome: 'done' },
          { ...b, outcome: 'failed' },
        ],
        [{ ...mainTask, outcome: 'done' }],
      ),
    },
    {
      case: 'SessionEndedNothingRunning',
      before: roster(
        [{ ...b, outcome: 'done' }],
        [{ ...mainTask, outcome: 'failed' }],
      ),
      event: sessionEnded,
      same: true,
    },
    {
      case: 'SessionEndedWhileEmpty',
      before: roster([]),
      event: sessionEnded,
      same: true,
    },
    {
      case: 'UserMessageDropsFinishedAgentsAndTasks',
      before: roster(
        [
          { ...a, outcome: 'done' },
          b,
          { ...b, agentId: 'toolu_c', outcome: 'failed' },
        ],
        [{ ...mainTask, outcome: 'failed' }, aTask],
      ),
      event: userMessage,
      after: roster([b], [aTask]),
    },
    {
      case: 'UserMessageKeepsRunningAgentsFinishedTools',
      before: roster([
        { ...b, tools: [...b.tools, toolWith('failed'), runningTool] },
      ]),
      event: userMessage,
      same: true,
    },
    {
      case: 'UserMessageKeepsRunningTaskOfFinishedAgent',
      before: roster([{ ...a, outcome: 'done' }, b], [aTask]),
      event: userMessage,
      after: roster([b], [aTask]),
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
      case: 'SessionStarted',
      before: roster([a]),
      event: { type: 'sessionStarted', at: 7000 },
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
    {
      case: 'UserMessageNothingFinished',
      before: roster([a, b], [mainTask]),
      event: userMessage,
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
