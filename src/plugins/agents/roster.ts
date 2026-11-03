import { MAIN_AGENT_ID, type AgentEvent } from '../../contracts/agent';
import type { Roster, RunningAgent, RunningTask } from './contract';

// Folds one agent event into one process's roster, each list kept in start order. Returns `roster` itself when the
// event changes nothing. A task outlives the subagent that started it: `agentFinished` drops only the agent.
// `sessionEnded` finishes every listed subagent and task, since a process that exits mid-run sends neither's end.
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
                description: event.description,
                startedAt: event.at,
                toolCalls: 0,
              },
            ],
          }
        : roster;
    case 'toolStarted':
      return countToolCall(roster, event.agentId);
    case 'agentFinished':
      return indexOfAgent(roster.agents, event.agentId) === -1
        ? roster
        : {
            ...roster,
            agents: roster.agents.filter(
              (agent) => agent.agentId !== event.agentId,
            ),
          };
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
                startedAt: event.at,
              },
            ],
          }
        : roster;
    case 'taskFinished':
      return indexOfTask(roster.tasks, event.taskId) === -1
        ? roster
        : {
            ...roster,
            tasks: roster.tasks.filter((task) => task.taskId !== event.taskId),
          };
    case 'sessionEnded':
      return roster.agents.length === 0 && roster.tasks.length === 0
        ? roster
        : { agents: [], tasks: [] };
    case 'sessionStarted':
    case 'toolFinished':
    case 'usage':
    case 'compacted':
    case 'userMessage':
    case 'skillStarted':
    case 'fileWritten':
    case 'turnStarted':
    case 'turnEnded':
      return roster;
  }
  return event satisfies never;
}

function indexOfAgent(
  agents: readonly RunningAgent[],
  agentId: string,
): number {
  return agents.findIndex((agent) => agent.agentId === agentId);
}

function indexOfTask(tasks: readonly RunningTask[], taskId: string): number {
  return tasks.findIndex((task) => task.taskId === taskId);
}

function countToolCall(roster: Roster, agentId: string): Roster {
  const index =
    agentId === MAIN_AGENT_ID ? -1 : indexOfAgent(roster.agents, agentId);
  if (index === -1) {
    return roster;
  }
  return {
    ...roster,
    agents: roster.agents.map((agent, i) =>
      i === index ? { ...agent, toolCalls: agent.toolCalls + 1 } : agent,
    ),
  };
}
