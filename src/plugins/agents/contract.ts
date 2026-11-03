// The agents plugin's records and its channel between its main and page parts.

import type { Disposable } from '../../contracts/disposable';
import type { ChannelShape } from '../../contracts/plugin';

// Whether a roster item is still running, or how it ended.
export type RosterOutcome = 'running' | 'done' | 'failed';

// One tool call a subagent started, `summary` naming what it acted on.
export interface RosterTool {
  toolUseId: string;
  tool: string;
  summary: string;
  outcome: RosterOutcome;
}

// A subagent of a session, running, or failed since the user's last message. `startedAt` is its spawn's `at`, epoch
// milliseconds. `model` is the model of its latest `agentReplied` (a reply or its launch receipt), else the spawn's;
// `spendUsd` is its estimated spend so far from its latest `agentReplied` (cumulative), null before its first reply or
// once any reply's model has no list price.
export interface RosterAgent {
  agentId: string;
  agentType: string;
  name: string;
  description: string;
  startedAt: number;
  model: string | null;
  effort: string | null;
  spendUsd: number | null;
  // Its tool calls in start order, every one kept: each tool start and end sends the whole roster, so a subagent with
  // hundreds of calls sends hundreds of small objects per change, a cost accepted so the box can list every call.
  tools: RosterTool[];
  outcome: RosterOutcome;
}

// A task of a session, running, or failed since the user's last message: a background shell or another long-running
// job an agent started. `agentId` is the agent that started it, `main` or a subagent's id; `command` is null when the
// harness named none; `startedAt` is its start's `at`, epoch milliseconds.
export interface RosterTask {
  taskId: string;
  agentId: string;
  description: string;
  command: string | null;
  startedAt: number;
  outcome: RosterOutcome;
}

// A session's subagents and tasks, each list in start order.
export interface Roster {
  agents: RosterAgent[];
  tasks: RosterTask[];
}

// What agents' page part exports to the views that draw the rosters. `roster` is a session's latest roster, both lists
// empty for a session with none; `onRosterChanged` calls `listener` with a session's id each time its roster changes,
// the first `rosters` read included. A removed session's roster is dropped without a call: views hear
// `sessions.sessionRemoved`.
export interface AgentsPageExports {
  roster(sessionId: string): Roster;
  onRosterChanged(listener: (sessionId: string) => void): Disposable;
}

// Rosters are keyed by the app's sessionId (the session row's id). `rosters` returns every session's roster that
// lists any item, finished ones included; `rosterChanged` carries a session's whole roster after each change, both
// lists empty once a message drops its last finished item or the row ends. `openPreview` opens agents' sample
// session, or ends it while it is open.
export interface AgentsChannel extends ChannelShape {
  invoke: { rosters(): Record<string, Roster>; openPreview(): void };
  messages: { rosterChanged: { sessionId: string; roster: Roster } };
}
