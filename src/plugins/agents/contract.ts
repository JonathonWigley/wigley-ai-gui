// The agents plugin's records and its channel between its main and page parts.

import type { Disposable } from '../../contracts/disposable';
import type { ChannelShape, DependencyKey } from '../../contracts/plugin';

// Whether a subagent's tool call is still running, or how it ended.
export type RosterOutcome = 'running' | 'done' | 'failed';

// One tool call a subagent started, `summary` naming what it acted on.
export interface RosterTool {
  toolUseId: string;
  tool: string;
  summary: string;
  outcome: RosterOutcome;
}

// A running subagent of a session; it leaves the roster when it ends. `startedAt` is its spawn's `at`, epoch
// milliseconds. `model` is the model of its latest `agentReplied` (a reply or its launch receipt), else the spawn's;
// `spendUsd` is its estimated spend so far from its latest `agentReplied` (cumulative), null before its first reply or
// once any reply's model has no list price. `isBackground` is true once its launch receipt says it runs in the
// background. `contextTokens` and `contextWindow` are its latest `agentReplied`'s, null until one reports them.
export interface RosterAgent {
  agentId: string;
  agentType: string;
  name: string;
  description: string;
  startedAt: number;
  model: string | null;
  effort: string | null;
  spendUsd: number | null;
  isBackground: boolean;
  contextTokens: number | null;
  contextWindow: number | null;
  // Its tool calls in start order, every one kept: each tool start and end sends the whole roster, so a subagent with
  // hundreds of calls sends hundreds of small objects per change, a cost accepted so the box can list every call.
  tools: RosterTool[];
}

// A running task of a session, a background shell or another long-running job an agent started; it leaves the roster
// when it ends. `agentId` is the agent that started it, `main` or a subagent's id; `ownerName` names that agent as it
// was when the task started (`main`, the subagent's name, or `subagent` for one never listed), so it outlives the
// subagent; `command` is null when the harness named none; `startedAt` is its start's `at`, epoch milliseconds.
export interface RosterTask {
  taskId: string;
  agentId: string;
  ownerName: string;
  description: string;
  command: string | null;
  startedAt: number;
}

// A skill an agent started in a session, one row per `skill` and `agentId`. `agentId` is the agent that started it,
// `main` or a subagent's id; `ownerName` names that agent as a task's does, so it outlives the subagent.
export interface RosterSkill {
  skill: string;
  agentId: string;
  ownerName: string;
}

// A session's three lists, each in start order: its running subagents, its running tasks, and the skills its agents
// started, which stay through a compaction, an agent's end and a process's end until the session's row ends or the app
// restarts: rosters live in memory and a relaunch replays only the attached process's log, so skills of earlier
// processes do not return.
export interface Roster {
  agents: RosterAgent[];
  tasks: RosterTask[];
  skills: RosterSkill[];
}

// What agents' page part exports to the views that draw the rosters. `roster` is a session's latest roster, all three
// lists empty for a session with none; `onRosterChanged` calls `listener` with a session's id each time its roster
// changes, the first `rosters` read included. A removed session's roster is dropped without a call: views hear
// `sessions.sessionRemoved`.
export interface AgentsPageExports {
  roster(sessionId: string): Roster;
  onRosterChanged(listener: (sessionId: string) => void): Disposable;
}

export const agentsPageKey: DependencyKey<AgentsPageExports, 'page', 'agents'> =
  { id: 'agents', process: 'page' };

// Rosters are keyed by the app's sessionId (the session row's id). `rosters` returns every session's roster that
// lists any item; `rosterChanged` carries a session's whole roster after each change, its agents and tasks empty once
// each has ended, and all three lists empty once the row ends. `openPreview` opens agents' sample session, or ends it while it is open.
export interface AgentsChannel extends ChannelShape {
  invoke: { rosters(): Record<string, Roster>; openPreview(): void };
  messages: { rosterChanged: { sessionId: string; roster: Roster } };
}
