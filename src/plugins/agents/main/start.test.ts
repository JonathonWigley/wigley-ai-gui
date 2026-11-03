import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID, type AgentEvent } from '../../../contracts/agent';
import { createMemoryFiles } from '../../../shared/memory-files';
import { CHAT_PREVIEW_HOST_ID } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import type { Roster, RosterAgent, RosterTask } from '../contract';
import { agentsMainPart } from './start';

const PREVIEW_ROW = 'preview-row';

const spawned: AgentEvent = {
  type: 'agentSpawned',
  at: 1_000,
  agentId: 'toolu_a',
  parentAgentId: MAIN_AGENT_ID,
  agentType: 'Explore',
  description: 'Find adapters',
  name: 'Explore',
  model: null,
  effort: null,
};
const finished: AgentEvent = {
  type: 'agentFinished',
  at: 2_000,
  agentId: 'toolu_a',
  outcome: 'done',
};
const userMessage: AgentEvent = { type: 'userMessage', at: 3_000 };
const sessionEnded: AgentEvent = { type: 'sessionEnded', at: 4_000 };
const spawnedB: AgentEvent = {
  type: 'agentSpawned',
  at: 5_000,
  agentId: 'toolu_b',
  parentAgentId: MAIN_AGENT_ID,
  agentType: 'general-purpose',
  description: 'Write the reducer',
  name: 'general-purpose',
  model: null,
  effort: null,
};

const runningA: RosterAgent = {
  agentId: 'toolu_a',
  agentType: 'Explore',
  name: 'Explore',
  description: 'Find adapters',
  startedAt: 1_000,
  model: null,
  effort: null,
  spendUsd: null,
  tools: [],
  outcome: 'running',
};
const runningB: RosterAgent = {
  agentId: 'toolu_b',
  agentType: 'general-purpose',
  name: 'general-purpose',
  description: 'Write the reducer',
  startedAt: 5_000,
  model: null,
  effort: null,
  spendUsd: null,
  tools: [],
  outcome: 'running',
};
const doneA: RosterAgent = { ...runningA, outcome: 'done' };
const failedA: RosterAgent = { ...runningA, outcome: 'failed' };

const taskStartedA: AgentEvent = {
  type: 'taskStarted',
  at: 1_500,
  taskId: 'task_a',
  agentId: 'toolu_a',
  description: 'npm test --watch',
  command: null,
};
const taskStartedMain: AgentEvent = {
  type: 'taskStarted',
  at: 6_000,
  taskId: 'task_main',
  agentId: MAIN_AGENT_ID,
  description: 'npm run build',
  command: null,
};
const runningTaskA: RosterTask = {
  taskId: 'task_a',
  agentId: 'toolu_a',
  description: 'npm test --watch',
  command: null,
  startedAt: 1_500,
  outcome: 'running',
};
const runningTaskMain: RosterTask = {
  taskId: 'task_main',
  agentId: MAIN_AGENT_ID,
  description: 'npm run build',
  command: null,
  startedAt: 6_000,
  outcome: 'running',
};

// A roster holding these agents and tasks.
function roster(agents: RosterAgent[], tasks: RosterTask[] = []): Roster {
  return { agents, tasks };
}

// Row s1's process after a clear, beside its first process `h1`.
const CLEARED_HOST = 'h2';

// Agents' main part started over a fake `MainApi` whose plugin data is a
// memory `Files`; `emit` calls the listeners of a qualified event, `sent`
// records every `rosterChanged` and `invoke` calls a handled channel method.
// Sessions' `open` hands back a row `PREVIEW_ROW`, so `openPreview` opens the
// preview there.
function startAgentsPart() {
  const handlers = new Map<string, () => unknown>();
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const sent: { sessionId: string; roster: Roster }[] = [];
  const data = createMemoryFiles();
  const sessions: Pick<SessionsMainExports, 'open' | 'activate'> = {
    open: (info) => ({
      session: { id: PREVIEW_ROW, info },
      end: () => undefined,
      setHostSessionId: () => undefined,
    }),
    activate: () => undefined,
  };
  const api = {
    channel: {
      handle: (name: string, handler: () => unknown) =>
        handlers.set(name, handler),
      send: (name: string, message: { sessionId: string; roster: Roster }) => {
        if (name === 'rosterChanged') {
          sent.push(message);
        }
      },
    },
    events: {
      emit: () => undefined,
      on: (event: string, listener: (data: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    data,
    services: {
      log: () => undefined,
      clock: { now: () => 50_000 },
    },
    dependency: (pluginId: string) => (pluginId === 'sessions' ? sessions : {}),
  } as unknown as Parameters<typeof agentsMainPart.start>[0];
  agentsMainPart.start(api);
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(payload);
    }
  };
  const agentEvent = (event: AgentEvent, hostSessionId = 'h1') =>
    emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: null,
      hostSessionId,
      event,
    });
  const invoke = (name: string) => handlers.get(name)?.();
  return { sent, data, emit, agentEvent, invoke };
}

const settled = () => new Promise((settle) => setImmediate(settle));

// A step: a sessions event on s1, an agent event from host `h1`, or an agent
// event from the host it names.
type Step = string | AgentEvent | { host: string; event: AgentEvent };

describe('agentsMainPart', () => {
  it.each<{
    name: string;
    steps: Step[];
    sent: { sessionId: string; roster: Roster }[];
    rosters: Record<string, Roster>;
  }>([
    {
      name: 'an event that leaves the roster as it was sends nothing',
      steps: [spawned, userMessage],
      sent: [{ sessionId: 's1', roster: roster([runningA]) }],
      rosters: { s1: roster([runningA]) },
    },
    {
      name: 'a finished agent stays listed until the next message',
      steps: [spawned, finished, userMessage],
      sent: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: roster([doneA]) },
        { sessionId: 's1', roster: roster([]) },
      ],
      rosters: {},
    },
    {
      name: 'a closed then ended session sends an empty roster once',
      steps: [spawned, 'sessions.closed', 'sessions.ended'],
      sent: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: roster([]) },
      ],
      rosters: {},
    },
    {
      name: 'an ended session with no roster sends nothing',
      steps: ['sessions.ended'],
      sent: [],
      rosters: {},
    },
    {
      name: "a cleared row's old process ending keeps the new process's subagent",
      steps: [{ host: CLEARED_HOST, event: spawned }, sessionEnded],
      sent: [{ sessionId: 's1', roster: roster([runningA]) }],
      rosters: { s1: roster([runningA]) },
    },
    {
      name: "a message drops a cleared host's finished items",
      steps: [
        spawned,
        { host: CLEARED_HOST, event: spawnedB },
        sessionEnded,
        { host: CLEARED_HOST, event: userMessage },
      ],
      sent: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: roster([runningA, runningB]) },
        { sessionId: 's1', roster: roster([failedA, runningB]) },
        { sessionId: 's1', roster: roster([runningB]) },
      ],
      rosters: { s1: roster([runningB]) },
    },
    {
      name: "a row's old process ending fails only its own subagents",
      steps: [spawned, { host: CLEARED_HOST, event: spawnedB }, sessionEnded],
      sent: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: roster([runningA, runningB]) },
        { sessionId: 's1', roster: roster([failedA, runningB]) },
      ],
      rosters: { s1: roster([failedA, runningB]) },
    },
    {
      name: 'a started task sends a roster listing it',
      steps: [taskStartedMain],
      sent: [{ sessionId: 's1', roster: roster([], [runningTaskMain]) }],
      rosters: { s1: roster([], [runningTaskMain]) },
    },
    {
      name: "two hosts' tasks under one row are both sent",
      steps: [taskStartedA, { host: CLEARED_HOST, event: taskStartedMain }],
      sent: [
        { sessionId: 's1', roster: roster([], [runningTaskA]) },
        {
          sessionId: 's1',
          roster: roster([], [runningTaskA, runningTaskMain]),
        },
      ],
      rosters: { s1: roster([], [runningTaskA, runningTaskMain]) },
    },
    {
      name: "a host's only agent finishing keeps the host's running task",
      steps: [spawned, taskStartedA, finished],
      sent: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: roster([runningA], [runningTaskA]) },
        { sessionId: 's1', roster: roster([doneA], [runningTaskA]) },
      ],
      rosters: { s1: roster([doneA], [runningTaskA]) },
    },
  ])('$name', ({ steps, sent, rosters }) => {
    const agents = startAgentsPart();

    for (const step of steps) {
      if (typeof step === 'string') {
        agents.emit(step, { sessionId: 's1' });
      } else if ('host' in step) {
        agents.agentEvent(step.event, step.host);
      } else {
        agents.agentEvent(step);
      }
    }

    expect(agents.sent).toEqual(sent);
    expect(agents.invoke('rosters')).toEqual(rosters);
  });

  it('logs each event under its host session id', async () => {
    const agents = startAgentsPart();

    agents.agentEvent(spawned);
    agents.agentEvent(userMessage);
    await settled();

    expect(await agents.data.read('logs/h1.jsonl')).toBe(
      JSON.stringify(spawned) + '\n' + JSON.stringify(userMessage) + '\n',
    );
  });

  it('previewEvents_NoLogWritten', async () => {
    const agents = startAgentsPart();

    agents.agentEvent(spawnedB, CHAT_PREVIEW_HOST_ID);
    agents.agentEvent(spawned);
    await settled();

    expect(agents.invoke('rosters')).toEqual({
      s1: roster([runningB, runningA]),
    });
    await expect(
      agents.data.read(`logs/${CHAT_PREVIEW_HOST_ID}.jsonl`),
    ).rejects.toThrow();
    expect(await agents.data.read('logs/h1.jsonl')).toBe(
      JSON.stringify(spawned) + '\n',
    );
  });

  it('rosters copies each live list and merges the preview roster', () => {
    const agents = startAgentsPart();
    agents.agentEvent(spawned);
    agents.agentEvent(taskStartedA);
    agents.invoke('openPreview');

    const first = agents.invoke('rosters') as Record<string, Roster>;
    first.s1.agents.pop();
    first.s1.tasks.pop();
    first[PREVIEW_ROW].agents.pop();
    first[PREVIEW_ROW].tasks.pop();
    const second = agents.invoke('rosters') as Record<string, Roster>;

    expect(Object.keys(second)).toEqual(['s1', PREVIEW_ROW]);
    expect(second.s1).toEqual(roster([runningA], [runningTaskA]));
    expect(second[PREVIEW_ROW].agents).toHaveLength(
      first[PREVIEW_ROW].agents.length + 1,
    );
    expect(second[PREVIEW_ROW].tasks).toHaveLength(
      first[PREVIEW_ROW].tasks.length + 1,
    );
  });
});
