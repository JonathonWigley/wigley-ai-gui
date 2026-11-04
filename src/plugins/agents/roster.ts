import { MAIN_AGENT_ID, type AgentEvent } from '../../contracts/agent';
import type {
  Roster,
  RosterAgent,
  RosterOutcome,
  RosterTask,
  RosterTool,
} from './contract';

// Folds one agent event into one process's roster, which lists only running items, each list kept in start order; an
// item never moves. Returns `roster` itself when the event changes nothing. An agent or task leaves when it ends, done
// or failed. A task outlives the subagent that started it. `sessionEnded` empties the roster, since a process that
// exits mid-run sends no end for its items.
export function foldAgentEvent(roster: Roster, event: AgentEvent): Roster {
  switch (event.type) {
    case 'agentSpawned':
      return indexOfAgent(roster.agents, event.agentId) === -1
        ? {
            ...roster,
            agents: [
              ...roster.agents,
              {
                agentId: event.agentId,
                agentType: event.agentType,
                name: event.name,
                description: event.description,
                startedAt: event.at,
                model: event.model,
                effort: event.effort,
                spendUsd: null,
                isBackground: false,
                contextTokens: null,
                contextWindow: null,
                tools: [],
              },
            ],
          }
        : roster;
    case 'agentReplied':
      return updateAgent(roster, event.agentId, (agent) =>
        agent.model === event.model &&
        agent.spendUsd === event.spendUsd &&
        agent.contextTokens === event.contextTokens &&
        agent.contextWindow === event.contextWindow
          ? agent
          : {
              ...agent,
              model: event.model,
              spendUsd: event.spendUsd,
              contextTokens: event.contextTokens,
              contextWindow: event.contextWindow,
            },
      );
    case 'agentLaunched':
      return updateAgent(roster, event.agentId, (agent) =>
        agent.isBackground ? agent : { ...agent, isBackground: true },
      );
    case 'toolStarted':
      if (event.agentId === MAIN_AGENT_ID) {
        return roster;
      }
      return updateAgent(roster, event.agentId, (agent) =>
        indexOfTool(agent.tools, event.toolUseId) !== -1
          ? agent
          : {
              ...agent,
              tools: [
                ...agent.tools,
                {
                  toolUseId: event.toolUseId,
                  tool: event.tool,
                  summary: event.summary,
                  outcome: 'running',
                },
              ],
            },
      );
    case 'toolFinished':
      return updateAgent(roster, event.agentId, (agent) =>
        finishTool(agent, event.toolUseId, event.ok ? 'done' : 'failed'),
      );
    case 'agentFinished': {
      const index = indexOfAgent(roster.agents, event.agentId);
      if (index === -1) {
        return roster;
      }
      return {
        ...roster,
        agents: roster.agents.filter((_, i) => i !== index),
      };
    }
    case 'taskStarted':
      return indexOfTask(roster.tasks, event.taskId) === -1
        ? {
            ...roster,
            tasks: [
              ...roster.tasks,
              {
                taskId: event.taskId,
                agentId: event.agentId,
                ownerName: nameOfOwner(roster.agents, event.agentId),
                description: event.description,
                command: event.command,
                startedAt: event.at,
              },
            ],
          }
        : roster;
    case 'taskFinished': {
      const index = indexOfTask(roster.tasks, event.taskId);
      if (index === -1) {
        return roster;
      }
      return {
        ...roster,
        tasks: roster.tasks.filter((_, i) => i !== index),
      };
    }
    case 'sessionEnded': {
      const isEmpty = roster.agents.length === 0 && roster.tasks.length === 0;
      return isEmpty ? roster : { agents: [], tasks: [] };
    }
    case 'userMessage':
    case 'sessionStarted':
    case 'usage':
    case 'compactionStarted':
    case 'compactionEnded':
    case 'skillStarted':
    case 'fileWritten':
    case 'turnStarted':
    case 'turnEnded':
      return roster;
  }
  return event satisfies never;
}

function indexOfAgent(agents: readonly RosterAgent[], agentId: string): number {
  return agents.findIndex((agent) => agent.agentId === agentId);
}

function indexOfTask(tasks: readonly RosterTask[], taskId: string): number {
  return tasks.findIndex((task) => task.taskId === taskId);
}

// The name a task shows for the agent `agentId` that started it.
function nameOfOwner(agents: readonly RosterAgent[], agentId: string): string {
  if (agentId === MAIN_AGENT_ID) {
    return 'main';
  }
  return agents.find((agent) => agent.agentId === agentId)?.name ?? 'subagent';
}

function indexOfTool(tools: readonly RosterTool[], toolUseId: string): number {
  return tools.findIndex((tool) => tool.toolUseId === toolUseId);
}

// `roster` with its agent `agentId` replaced by `update`'s result; `roster` itself when no agent has that id or
// `update` returns the agent it was given.
function updateAgent(
  roster: Roster,
  agentId: string,
  update: (agent: RosterAgent) => RosterAgent,
): Roster {
  const index = indexOfAgent(roster.agents, agentId);
  if (index === -1) {
    return roster;
  }
  const updated = update(roster.agents[index]);
  if (updated === roster.agents[index]) {
    return roster;
  }
  return {
    ...roster,
    agents: roster.agents.map((agent, i) => (i === index ? updated : agent)),
  };
}

// `agent` with its tool `toolUseId` given `outcome`; `agent` itself unless that tool is listed and running.
function finishTool(
  agent: RosterAgent,
  toolUseId: string,
  outcome: RosterOutcome,
): RosterAgent {
  const index = indexOfTool(agent.tools, toolUseId);
  if (index === -1 || agent.tools[index].outcome !== 'running') {
    return agent;
  }
  return {
    ...agent,
    tools: agent.tools.map((tool, i) =>
      i === index ? { ...tool, outcome } : tool,
    ),
  };
}
