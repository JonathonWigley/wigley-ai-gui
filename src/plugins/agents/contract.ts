// The agents plugin's records and its channel between its main and page parts.

import type { ChannelShape } from '../../contracts/plugin';

// A subagent still working in a session. `startedAt` is its spawn's `at`, epoch milliseconds; `toolCalls` counts
// the tool calls it started.
export interface RunningAgent {
  agentId: string;
  agentType: string;
  description: string;
  startedAt: number;
  toolCalls: number;
}

// A task still running in a session: a background shell or another long-running job an agent started. `agentId` is
// the agent that started it, `main` or a subagent's id; `startedAt` is its start's `at`, epoch milliseconds.
export interface RunningTask {
  taskId: string;
  agentId: string;
  description: string;
  startedAt: number;
}

// A session's running subagents and running tasks, each list in start order.
export interface Roster {
  agents: RunningAgent[];
  tasks: RunningTask[];
}

// Rosters are keyed by the app's sessionId (the session row's id). `rosters` returns every session's roster that
// lists a subagent or a task; `rosterChanged` carries a session's whole roster after each change, both lists empty
// once its last subagent and task finish. `openPreview` opens the layout preview's sample session, or ends it while
// it is open.
export interface AgentsChannel extends ChannelShape {
  invoke: { rosters(): Record<string, Roster>; openPreview(): void };
  messages: { rosterChanged: { sessionId: string; roster: Roster } };
}
