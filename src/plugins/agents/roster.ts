import { MAIN_AGENT_ID, type AgentEvent } from '../../contracts/agent';
import type {
  Roster,
  RosterAgent,
  RosterOutcome,
  RosterTask,
  RosterTool,
} from './contract';

// Folds one agent event into one process's roster, each list kept in start order; an item never moves. Returns
// `roster` itself when the event changes nothing. An agent or task that ends done leaves at once; one that fails stays,
// its outcome set, until a `userMessage` drops it. A task outlives the subagent that started it. `sessionEnded` fails every running item, since a process that
// exits mid-run sends no end for them.
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
                tools: [],
                outcome: 'running',
              },
            ],
          }
        : roster;
    case 'agentReplied':
      return updateAgent(roster, event.agentId, (agent) =>
        agent.model === event.model && agent.spendUsd === event.spendUsd
          ? agent
          : { ...agent, model: event.model, spendUsd: event.spendUsd },
      );
    case 'toolStarted':
      if (event.agentId === MAIN_AGENT_ID) {
        return roster;
      }
      return updateAgent(roster, event.agentId, (agent) =>
        agent.outcome !== 'running' ||
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
      const endsDone =
        event.outcome === 'done' &&
        index !== -1 &&
        isRunning(roster.agents[index]);
      if (endsDone) {
        return {
          ...roster,
          agents: roster.agents.filter((_, i) => i !== index),
        };
      }
      return updateAgent(roster, event.agentId, (agent) =>
        agent.outcome === 'running'
          ? {
              ...agent,
              outcome: event.outcome,
              tools: agent.tools.map(failIfRunning),
            }
          : agent,
      );
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
                description: event.description,
                command: event.command,
                startedAt: event.at,
                outcome: 'running',
              },
            ],
          }
        : roster;
    case 'taskFinished': {
      const index = indexOfTask(roster.tasks, event.taskId);
      if (index === -1 || roster.tasks[index].outcome !== 'running') {
        return roster;
      }
      return {
        ...roster,
        tasks:
          event.outcome === 'done'
            ? roster.tasks.filter((_, i) => i !== index)
            : roster.tasks.map((task, i) =>
                i === index ? { ...task, outcome: event.outcome } : task,
              ),
      };
    }
    case 'sessionEnded':
      return failEveryRunningItem(roster);
    case 'userMessage':
      return dropFinishedItems(roster);
    case 'agentLaunched':
    case 'sessionStarted':
    case 'usage':
    case 'compacted':
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

function isRunning(item: { outcome: RosterOutcome }): boolean {
  return item.outcome === 'running';
}

function failIfRunning<Item extends { outcome: RosterOutcome }>(
  item: Item,
): Item {
  return isRunning(item) ? { ...item, outcome: 'failed' } : item;
}

// Every running agent, tool and task failed; `roster` itself when nothing runs.
function failEveryRunningItem(roster: Roster): Roster {
  const anyRunning =
    roster.tasks.some(isRunning) ||
    roster.agents.some(
      (agent) => isRunning(agent) || agent.tools.some(isRunning),
    );
  if (!anyRunning) {
    return roster;
  }
  return {
    agents: roster.agents.map((agent) => ({
      ...failIfRunning(agent),
      tools: agent.tools.map(failIfRunning),
    })),
    tasks: roster.tasks.map(failIfRunning),
  };
}

// Only the running agents, each with all its tools, and the running tasks, whatever agent owns them; `roster` itself
// when nothing has finished.
function dropFinishedItems(roster: Roster): Roster {
  const anyFinished =
    !roster.agents.every(isRunning) || !roster.tasks.every(isRunning);
  if (!anyFinished) {
    return roster;
  }
  return {
    agents: roster.agents.filter(isRunning),
    tasks: roster.tasks.filter(isRunning),
  };
}
