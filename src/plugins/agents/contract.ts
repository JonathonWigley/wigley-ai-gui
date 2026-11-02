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

// Rosters are keyed by the app's sessionId (the session row's id), each listing its running subagents in spawn order.
// `rosters` returns every session's roster that lists one; `rosterChanged` carries a session's whole roster after
// each change, `running` empty once its last subagent finishes.
export interface AgentsChannel extends ChannelShape {
  invoke: { rosters(): Record<string, RunningAgent[]> };
  messages: { rosterChanged: { sessionId: string; running: RunningAgent[] } };
}
