import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID, type AgentEvent } from '../../contracts/agent';
import type {
  Roster,
  RosterAgent,
  RosterOutcome,
  RosterSkill,
  RosterTask,
  RosterTool,
} from './contract';
import { foldAgentEvent } from './roster';

const a: RosterAgent = {
  agentId: 'toolu_a',
  agentType: 'Explore',
  name: 'kind-fixer',
  description: 'Find adapters',
  startedAt: 1000,
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  spendUsd: null,
  isBackground: false,
  contextTokens: null,
  contextWindow: null,
  tools: [],
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
  isBackground: true,
  contextTokens: 84_000,
  contextWindow: 200_000,
  tools: [
    {
      toolUseId: 'toolu_b1',
      tool: 'Grep',
      summary: 'reducer',
      outcome: 'done',
    },
  ],
};

// A task the main agent started and one subagent `a` started.
const mainTask: RosterTask = {
  taskId: 'task_main',
  agentId: MAIN_AGENT_ID,
  ownerName: 'main',
  description: 'npm run build',
  command: 'npm run build -- --watch',
  startedAt: 1500,
};
const aTask: RosterTask = {
  taskId: 'task_a',
  agentId: a.agentId,
  ownerName: 'kind-fixer',
  description: 'Watch the tests',
  command: null,
  startedAt: 3000,
};

// A skill the main agent started and one subagent `a` started, the same skill.
const mainSkill: RosterSkill = {
  skill: 'foo',
  agentId: MAIN_AGENT_ID,
  ownerName: 'main',
};
const aSkill: RosterSkill = {
  skill: 'foo',
  agentId: a.agentId,
  ownerName: 'kind-fixer',
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

// A roster holding these agents, tasks and skills.
function roster(
  agents: RosterAgent[],
  tasks: RosterTask[] = [],
  skills: RosterSkill[] = [],
): Roster {
  return { agents, tasks, skills };
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
  contextTokens: number | null = null,
  contextWindow: number | null = null,
): AgentEvent {
  return {
    type: 'agentReplied',
    at: 3500,
    agentId,
    model,
    spendUsd,
    contextTokens,
    contextWindow,
  };
}

function launched(agentId: string): AgentEvent {
  return { type: 'agentLaunched', at: 3600, agentId };
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

function skillStarted(agentId: string): AgentEvent {
  return {
    type: 'skillStarted',
    at: 7000,
    agentId,
    skill: 'foo',
    args: '/p/plan-x',
  };
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
      after: roster([
        a,
        {
          ...b,
          spendUsd: null,
          isBackground: false,
          contextTokens: null,
          contextWindow: null,
          tools: [],
        },
      ]),
    },
    {
      case: 'SpawnOfListedId',
      before: roster([a]),
      event: spawned({ ...a, startedAt: 9000 }),
      same: true,
    },
    {
      case: 'RepliedSetsModelSpendAndContext',
      before: roster([a, b]),
      event: replied(a.agentId, 'claude-haiku-5-5', 0.0019, 84_000, 200_000),
      after: roster([
        {
          ...a,
          model: 'claude-haiku-5-5',
          spendUsd: 0.0019,
          contextTokens: 84_000,
          contextWindow: 200_000,
        },
        b,
      ]),
    },
    {
      case: 'RepliedReplacesSpend',
      before: roster([{ ...a, model: 'claude-haiku-5-5', spendUsd: 0.0019 }]),
      event: replied(a.agentId, 'claude-haiku-5-5', 0.0042),
      after: roster([{ ...a, model: 'claude-haiku-5-5', spendUsd: 0.0042 }]),
    },
    {
      case: 'RepliedReplacesOnlyContextTokens',
      before: roster([{ ...b, model: 'claude-opus-5-5' }]),
      event: replied(b.agentId, 'claude-opus-5-5', 0.0031, 90_000, 200_000),
      after: roster([
        { ...b, model: 'claude-opus-5-5', contextTokens: 90_000 },
      ]),
    },
    {
      case: 'RepliedReplacesOnlyContextWindow',
      before: roster([{ ...b, model: 'claude-opus-5-5' }]),
      event: replied(b.agentId, 'claude-opus-5-5', 0.0031, 84_000, 1_000_000),
      after: roster([
        { ...b, model: 'claude-opus-5-5', contextWindow: 1_000_000 },
      ]),
    },
    {
      case: 'RepliedSameValues',
      before: roster([{ ...b, model: 'claude-opus-5-5' }]),
      event: replied(b.agentId, 'claude-opus-5-5', 0.0031, 84_000, 200_000),
      same: true,
    },
    {
      case: 'RepliedOnUnlistedId',
      before: roster([a]),
      event: replied('toolu_gone', 'claude-haiku-5-5', 0.0042),
      same: true,
    },
    {
      case: 'LaunchedMarksBackground',
      before: roster([a, b]),
      event: launched(a.agentId),
      after: roster([{ ...a, isBackground: true }, b]),
    },
    {
      case: 'LaunchedAlreadyBackground',
      before: roster([b]),
      event: launched(b.agentId),
      same: true,
    },
    {
      case: 'LaunchedOnUnlistedId',
      before: roster([a]),
      event: launched('toolu_gone'),
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
      case: 'FinishedFailedDropsAgent',
      before: roster([a, b]),
      event: finished(a.agentId, 'failed'),
      after: roster([b]),
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
      case: 'FinishedKeepsItsSkillAndOwnerName',
      before: roster([a, b], [], [aSkill]),
      event: finished(a.agentId),
      after: roster([b], [], [aSkill]),
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
      case: 'TaskStartedNamesItsListedOwner',
      before: roster([a, b]),
      event: taskStarted(aTask),
      after: roster([a, b], [aTask]),
    },
    {
      case: 'TaskStartedOfUnlistedOwner',
      before: roster([a]),
      event: taskStarted({ ...aTask, agentId: 'toolu_gone' }),
      after: roster(
        [a],
        [{ ...aTask, agentId: 'toolu_gone', ownerName: 'subagent' }],
      ),
    },
    {
      case: 'TaskStartedOfListedId',
      before: roster([a], [mainTask]),
      event: taskStarted({ ...mainTask, startedAt: 9000 }),
      same: true,
    },
    {
      case: 'TaskFinishedFailedDropsTask',
      before: roster([a], [mainTask, aTask]),
      event: taskFinished(mainTask.taskId, 'failed'),
      after: roster([a], [aTask]),
    },
    {
      case: 'TaskFinishedDoneDropsTask',
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
      case: 'SessionEndedEmptiesAgentsAndTasks',
      before: roster([{ ...a, tools: [runningTool] }, b], [mainTask, aTask]),
      event: sessionEnded,
      after: roster([]),
    },
    {
      case: 'SessionEndedKeepsSkills',
      before: roster([a], [mainTask], [mainSkill, aSkill]),
      event: sessionEnded,
      after: roster([], [], [mainSkill, aSkill]),
    },
    {
      case: 'SessionEndedWithOnlySkills',
      before: roster([], [], [mainSkill]),
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
      case: 'UserMessage',
      before: roster([a, b], [mainTask]),
      event: userMessage,
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
      case: 'CompactionStarted',
      before: roster([a], [], [mainSkill]),
      event: { type: 'compactionStarted', at: 7000, trigger: 'app' },
      same: true,
    },
    {
      case: 'CompactionEnded',
      before: roster([a], [], [mainSkill]),
      event: {
        type: 'compactionEnded',
        at: 7000,
        trigger: 'harness',
        outcome: 'done',
        beforeTokens: 150_000,
        durationMs: 9000,
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
      case: 'SkillStartedByMain',
      before: roster([a]),
      event: skillStarted(MAIN_AGENT_ID),
      after: roster([a], [], [mainSkill]),
    },
    {
      case: 'SkillStartedOfListedRow',
      before: roster([a], [], [mainSkill]),
      event: skillStarted(MAIN_AGENT_ID),
      same: true,
    },
    {
      case: 'SkillStartedBySecondAgentAppendsItsRow',
      before: roster([a], [], [mainSkill]),
      event: skillStarted(a.agentId),
      after: roster([a], [], [mainSkill, aSkill]),
    },
    {
      case: 'SkillStartedOfUnlistedOwner',
      before: roster([a]),
      event: skillStarted('toolu_gone'),
      after: roster(
        [a],
        [],
        [{ skill: 'foo', agentId: 'toolu_gone', ownerName: 'subagent' }],
      ),
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
