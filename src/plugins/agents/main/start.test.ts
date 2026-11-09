import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID, type AgentEvent } from '../../../contracts/agent';
import { createMemoryFiles } from '../../../shared/memory-files';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { CHAT_PREVIEW_HOST_ID } from '../../chat/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import {
  agentsRostersSlot,
  type Roster,
  type RosterAgent,
  type RosterSkill,
  type RosterTask,
} from '../contract';
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
const failed: AgentEvent = { ...finished, outcome: 'failed' };
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
  isBackground: false,
  contextTokens: null,
  contextWindow: null,
  autocompactLimit: null,
  tools: [],
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
  isBackground: false,
  contextTokens: null,
  contextWindow: null,
  autocompactLimit: null,
  tools: [],
};

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
  ownerName: 'subagent',
  description: 'npm test --watch',
  command: null,
  startedAt: 1_500,
};
const runningTaskMain: RosterTask = {
  taskId: 'task_main',
  agentId: MAIN_AGENT_ID,
  ownerName: 'main',
  description: 'npm run build',
  command: null,
  startedAt: 6_000,
};

// `task_a` when its owner `toolu_a` is listed as it starts.
const taskOfListedA: RosterTask = { ...runningTaskA, ownerName: 'Explore' };

const skillStartedFoo: AgentEvent = {
  type: 'skillStarted',
  at: 7_000,
  agentId: MAIN_AGENT_ID,
  skill: 'foo',
  args: '',
};
const fooByMain: RosterSkill = {
  skill: 'foo',
  agentId: MAIN_AGENT_ID,
  ownerName: 'main',
};

// A roster holding these agents, tasks and skills.
function roster(
  agents: RosterAgent[],
  tasks: RosterTask[] = [],
  skills: RosterSkill[] = [],
): Roster {
  return { agents, tasks, skills };
}

// Row s1's process after a clear, beside its first process `h1`.
const CLEARED_HOST = 'h2';

// One notice of the rosters slot: `roster` is undefined for a deleted key.
interface Notice {
  sessionId: string;
  roster: Roster | undefined;
}

// Agents' main part started over a fake `MainApi` whose plugin data is a
// memory `Files` and whose slots are a real store; `emit` calls the listeners of
// a qualified event, `notices` records every notice of the rosters slot,
// `rosters` reads the slot and `invoke` calls a handled channel method.
// Sessions' `open` hands back a row `PREVIEW_ROW`, so `openPreview` opens the
// preview there.
function startAgentsPart() {
  const handlers = new Map<string, () => unknown>();
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const notices: Notice[] = [];
  const store = createSlotStore(() => undefined);
  const reader = store.read(agentsRostersSlot, 'test');
  reader.on((sessionId, roster) => notices.push({ sessionId, roster }));
  const data = createMemoryFiles();
  const sessions: Pick<SessionsMainExports, 'open' | 'activate'> = {
    open: (info) => ({
      session: { id: PREVIEW_ROW, info },
      end: () => undefined,
      setHostSessionId: () => undefined,
      keep: () => undefined,
    }),
    activate: () => undefined,
  };
  const api = {
    channel: {
      handle: (name: string, handler: () => unknown) =>
        handlers.set(name, handler),
    },
    state: { publish: () => store.publish(agentsRostersSlot) },
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
    dependency: (key: { id: string }) =>
      key.id === 'sessions' ? sessions : {},
  } as unknown as Parameters<typeof agentsMainPart.start>[0];
  agentsMainPart.start(api);
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(payload);
    }
  };
  const agentEvent = (
    event: AgentEvent,
    hostSessionId = 'h1',
    replayed = false,
  ) =>
    emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: null,
      hostSessionId,
      event,
      replayed,
    });
  const invoke = (name: string) => handlers.get(name)?.();
  const rosters = () => Object.fromEntries(reader.all());
  return { notices, rosters, data, emit, agentEvent, invoke };
}

const settled = () => new Promise((settle) => setImmediate(settle));

// A step: a sessions event on s1, an agent event from host `h1`, or an agent
// event from the host it names.
type Step = string | AgentEvent | { host: string; event: AgentEvent };

describe('agentsMainPart', () => {
  it.each<{
    name: string;
    steps: Step[];
    notices: Notice[];
    rosters: Record<string, Roster>;
  }>([
    {
      name: 'an event that leaves the roster as it was writes nothing',
      steps: [spawned, userMessage],
      notices: [{ sessionId: 's1', roster: roster([runningA]) }],
      rosters: { s1: roster([runningA]) },
    },
    {
      name: 'a done agent leaves the roster at once',
      steps: [spawned, finished],
      notices: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: undefined },
      ],
      rosters: {},
    },
    {
      name: 'a failed agent leaves the roster at once',
      steps: [spawned, failed],
      notices: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: undefined },
      ],
      rosters: {},
    },
    {
      name: 'a closed then ended session deletes the key once',
      steps: [spawned, 'sessions.closed', 'sessions.ended'],
      notices: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: undefined },
      ],
      rosters: {},
    },
    {
      name: 'an ended session with no roster writes nothing',
      steps: ['sessions.ended'],
      notices: [],
      rosters: {},
    },
    {
      name: "a cleared row's old process ending keeps the new process's subagent",
      steps: [{ host: CLEARED_HOST, event: spawned }, sessionEnded],
      notices: [{ sessionId: 's1', roster: roster([runningA]) }],
      rosters: { s1: roster([runningA]) },
    },
    {
      name: "a row's old process ending removes only its own subagents",
      steps: [spawned, { host: CLEARED_HOST, event: spawnedB }, sessionEnded],
      notices: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: roster([runningA, runningB]) },
        { sessionId: 's1', roster: roster([runningB]) },
      ],
      rosters: { s1: roster([runningB]) },
    },
    {
      name: 'a started task writes a roster listing it',
      steps: [taskStartedMain],
      notices: [{ sessionId: 's1', roster: roster([], [runningTaskMain]) }],
      rosters: { s1: roster([], [runningTaskMain]) },
    },
    {
      name: "two hosts' tasks under one row are both written",
      steps: [taskStartedA, { host: CLEARED_HOST, event: taskStartedMain }],
      notices: [
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
      notices: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: roster([runningA], [taskOfListedA]) },
        { sessionId: 's1', roster: roster([], [taskOfListedA]) },
      ],
      rosters: { s1: roster([], [taskOfListedA]) },
    },
    {
      name: 'two hosts of one row with the same skill by main show one row',
      steps: [skillStartedFoo, { host: CLEARED_HOST, event: skillStartedFoo }],
      notices: [
        { sessionId: 's1', roster: roster([], [], [fooByMain]) },
        { sessionId: 's1', roster: roster([], [], [fooByMain]) },
      ],
      rosters: { s1: roster([], [], [fooByMain]) },
    },
    {
      name: 'a host with only skills left stays',
      steps: [spawned, skillStartedFoo, finished, userMessage],
      notices: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: roster([runningA], [], [fooByMain]) },
        { sessionId: 's1', roster: roster([], [], [fooByMain]) },
      ],
      rosters: { s1: roster([], [], [fooByMain]) },
    },
    {
      name: "a cleared host's skill stays through its end, until the row ends",
      steps: [spawned, skillStartedFoo, sessionEnded, 'sessions.ended'],
      notices: [
        { sessionId: 's1', roster: roster([runningA]) },
        { sessionId: 's1', roster: roster([runningA], [], [fooByMain]) },
        { sessionId: 's1', roster: roster([], [], [fooByMain]) },
        { sessionId: 's1', roster: undefined },
      ],
      rosters: {},
    },
  ])('$name', ({ steps, notices, rosters }) => {
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

    expect(agents.notices).toEqual(notices);
    expect(agents.rosters()).toEqual(rosters);
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

  it('agentLog_ContextBreakdown_NoLogWritten', async () => {
    const agents = startAgentsPart();

    agents.agentEvent({
      type: 'contextBreakdown',
      agentId: 'main',
      at: 0,
      totalTokens: 10,
      contextWindow: null,
      autocompactAt: null,
      deferredTokens: 0,
      sources: [],
    });
    await settled();

    expect(await agents.data.list('logs')).toEqual([]);
  });

  it.each([
    {
      given: 'the chat preview host',
      hostSessionId: CHAT_PREVIEW_HOST_ID,
      replayed: false,
    },
    { given: 'a replayed event', hostSessionId: 'h1', replayed: true },
  ])(
    'agentLog_UnloggedEvents_NoLogWritten ($given)',
    async ({ hostSessionId, replayed }) => {
      const agents = startAgentsPart();

      agents.agentEvent(spawned, hostSessionId, replayed);
      await settled();

      expect(await agents.data.list('logs')).toEqual([]);
      expect(agents.rosters()).toEqual({ s1: roster([runningA]) });
      expect(agents.notices).toEqual([
        { sessionId: 's1', roster: roster([runningA]) },
      ]);
    },
  );

  it("the slot holds the row's merged roster and the preview's", () => {
    const agents = startAgentsPart();
    agents.agentEvent(spawned);
    agents.agentEvent(taskStartedA);
    agents.agentEvent(skillStartedFoo);
    agents.agentEvent(spawnedB, CLEARED_HOST);
    agents.invoke('openPreview');

    const slot = agents.rosters();

    expect(Object.keys(slot)).toEqual(['s1', PREVIEW_ROW]);
    expect(slot.s1).toEqual(
      roster([runningA, runningB], [taskOfListedA], [fooByMain]),
    );
    expect(slot[PREVIEW_ROW].agents.map(({ agentId }) => agentId)).toEqual([
      'preview-agent-1',
      'preview-agent-2',
    ]);
  });
});

// Agents' main part on the harness, over sessions whose `open` hands out a row
// filed with `consumer.track`, as sessions' view does; `ended` counts its ends.
function startOnHarness() {
  const rows = { ended: 0 };
  const harness = startMainPart(agentsMainPart, {
    dependencies: [
      fakeDependency(
        sessionsMainKey,
        (consumer) =>
          ({
            open() {
              consumer.track({
                dispose() {
                  rows.ended += 1;
                },
              });
              return { session: { id: 'row-1' } };
            },
            activate() {},
          }) as unknown as SessionsMainExports,
      ),
    ],
  });
  return { harness, rows };
}

describe('agentsMainPart lifecycle', () => {
  it.each([
    { name: 'fresh start', opensPreview: false, ended: 0 },
    { name: 'preview open', opensPreview: true, ended: 1 },
  ])('stop_LeavesNoLiveRegistration $name', async ({ opensPreview, ended }) => {
    const { harness, rows } = startOnHarness();
    const slot = harness.state.read(agentsRostersSlot, 'test');
    if (opensPreview) {
      harness.invoke('openPreview');
    }
    expect(slot.get('row-1') !== undefined).toBe(opensPreview);
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
    expect(slot.get('row-1')).toBeUndefined();
    expect(rows.ended).toBe(ended);
  });

  it('stopThenStart_StartsAgainHoldingNoRosters', async () => {
    const { harness } = startOnHarness();
    const before = harness.counts();
    const slot = harness.state.read(agentsRostersSlot, 'test');
    harness.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: null,
      hostSessionId: 'h1',
      event: spawned,
      replayed: true,
    });
    expect(slot.get('s1')).toBeDefined();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
    expect([...slot.all()]).toEqual([]);
  });
});
