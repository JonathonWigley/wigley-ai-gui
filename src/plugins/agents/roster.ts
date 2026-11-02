import { MAIN_AGENT_ID, type AgentEvent } from '../../contracts/agent';
import type { RunningAgent } from './contract';

// Folds one agent event into a session's running subagents, kept in spawn order. Returns `running` itself when the
// event changes nothing. `sessionEnded` finishes every listed subagent, since a process that exits mid-subagent sends
// no `agentFinished`.
export function foldAgentEvent(
  running: readonly RunningAgent[],
  event: AgentEvent,
): readonly RunningAgent[] {
  switch (event.type) {
    case 'agentSpawned':
      return indexOfAgent(running, event.agentId) === -1
        ? [
            ...running,
            {
              agentId: event.agentId,
              agentType: event.agentType,
              description: event.description,
              startedAt: event.at,
              toolCalls: 0,
            },
          ]
        : running;
    case 'toolStarted':
      return countToolCall(running, event.agentId);
    case 'agentFinished':
      return indexOfAgent(running, event.agentId) === -1
        ? running
        : running.filter((agent) => agent.agentId !== event.agentId);
    case 'sessionEnded':
      return running.length === 0 ? running : [];
    case 'sessionStarted':
    case 'toolFinished':
    case 'usage':
    case 'compacted':
    case 'userMessage':
      return running;
  }
  return event satisfies never;
}

function indexOfAgent(
  running: readonly RunningAgent[],
  agentId: string,
): number {
  return running.findIndex((agent) => agent.agentId === agentId);
}

function countToolCall(
  running: readonly RunningAgent[],
  agentId: string,
): readonly RunningAgent[] {
  const index = agentId === MAIN_AGENT_ID ? -1 : indexOfAgent(running, agentId);
  if (index === -1) {
    return running;
  }
  return running.map((agent, i) =>
    i === index ? { ...agent, toolCalls: agent.toolCalls + 1 } : agent,
  );
}
