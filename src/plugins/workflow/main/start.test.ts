import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../contracts/agent';
import type { Files } from '../../../contracts/files';
import type { QualifiedEvents } from '../../../contracts/plugin';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { ChatMainEvents, ChatMainExports } from '../../chat/contract';
import type {
  AgentSession,
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import type { SessionFlow } from '../contract';
import { newFlow } from '../flow';
import { readPlanProgress } from '../plan-reader';
import { FLOWS_FILE } from './flow-store';
import { workflowMainPart } from './start';

const START = 1_000_000;
const PLAN_DIR = '/r/docs/features/x/plan-a';
const PLAN_FILE = `${PLAN_DIR}/plan.md`;
const PLAN =
  '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [ ] two\n- [ ] three\n';
const PLAN_TICKED =
  '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [x] two\n- [ ] three\n';

// The events workflow's main part hears.
type WorkflowHeard = QualifiedEvents<'chat', ChatMainEvents> &
  QualifiedEvents<'sessions', SessionsMainEvents>;

interface WorkflowTestSettings {
  layout: string;
  autoClearAndMake: boolean;
  autoStartSeconds: number;
}

const settled = () => new Promise((settle) => setImmediate(settle));

// Timers and a clock the test moves by hand: `advance` moves the clock and
// runs each timer that came due, in due order.
function handTime() {
  let now = START;
  let nextHandle = 1;
  const pending = new Map<number, { run: () => void; dueAt: number }>();
  return {
    clock: { now: () => now },
    timers: {
      set: (run: () => void, ms: number) => {
        const handle = nextHandle++;
        pending.set(handle, { run, dueAt: now + ms });
        return handle;
      },
      clear: (handle: number) => {
        pending.delete(handle);
      },
    },
    advance(ms: number) {
      now += ms;
      const due = [...pending]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort(([, a], [, b]) => a.dueAt - b.dueAt);
      for (const [handle, { run }] of due) {
        pending.delete(handle);
        run();
      }
    },
  };
}

function session(id: string, hostSessionId: string): AgentSession {
  return {
    id,
    info: {
      sessionId: hostSessionId,
      projectDir: '/r',
      deadlineSeconds: null,
      harness: null,
    },
  };
}

// Workflow's main part started over a fake `MainApi`: memory files for its
// data and for the project (`project`), hand-moved time, and a chat fake that
// records each `clear` and `send`. `silentWatch` gives the project files a
// watch that reports nothing, as an OS watcher that misses a delete;
// `sessionLabel` is the side-bar label sessions gives s1 (none by default);
// `data` is workflow's data folder as the last run left it.
function startWorkflowPart(
  settings: WorkflowTestSettings,
  options: {
    silentWatch?: boolean;
    sessionLabel?: string;
    data?: MemoryFiles;
  } = {},
) {
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const sent: SessionFlow[][] = [];
  const logs: [string, string][] = [];
  const chatCalls: unknown[][] = [];
  let settingsListener: (next: WorkflowTestSettings) => void = () => undefined;
  const data = options.data ?? createMemoryFiles();
  const project = createMemoryFiles();
  const projectFiles: Files =
    options.silentWatch === true
      ? { ...project, watch: () => ({ close: () => undefined }) }
      : project;
  const time = handTime();
  const chat: Pick<ChatMainExports, 'send' | 'clear' | 'launch' | 'profileOf'> =
    {
      send: async (sessionId, message) => {
        chatCalls.push(['send', sessionId, message.text]);
      },
      clear: async (sessionId) => {
        chatCalls.push(['clear', sessionId]);
      },
      launch: async () => 's2',
      profileOf: () => 'personal',
    };
  const sessions: Pick<SessionsMainExports, 'label'> = {
    label: (sessionId) =>
      sessionId === 's1' ? (options.sessionLabel ?? null) : null,
  };
  const dependencies: Record<string, unknown> = { chat, sessions };
  const api = {
    channel: {
      handle: (name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
      send: (name: string, flows: SessionFlow[]) => {
        if (name === 'flows') {
          sent.push(flows);
        }
      },
    },
    events: {
      emit: () => undefined,
      on: (event: string, listener: (data: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    settings: () => settings,
    onSettingsChanged: (listener: (next: WorkflowTestSettings) => void) => {
      settingsListener = listener;
      return { dispose: () => undefined };
    },
    services: {
      files: projectFiles,
      log: (source: string, line: string) => logs.push([source, line]),
      clock: time.clock,
      timers: time.timers,
      paths: posixPaths,
      selfTest: null,
    },
    dependency: (pluginId: string) => dependencies[pluginId] ?? {},
    data,
    drive: null,
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof workflowMainPart.start>[0];
  workflowMainPart.start(api);

  const emit = async <Name extends keyof WorkflowHeard & string>(
    event: Name,
    payload: WorkflowHeard[Name],
  ) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(payload);
    }
    await settled();
  };
  const agentEvent = (
    event: AgentEvent,
    hostSessionId = 'h1',
    replayed = false,
  ) =>
    emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude',
      hostSessionId,
      event,
      replayed,
    });
  // A re-attach's replay: every event in one synchronous run, as the harness
  // fires them, with no settling between events.
  const replayBurst = async (replayedEvents: AgentEvent[]) => {
    for (const event of replayedEvents) {
      for (const listener of listeners.get('chat.agentEvent') ?? []) {
        listener({
          sessionId: 's1',
          profileDir: '~/.claude',
          hostSessionId: 'h1',
          event,
          replayed: true,
        });
      }
    }
    await settled();
  };
  const openS1 = async () => {
    await emit('sessions.connected', session('s1', 'h1'));
    await emit('chat.sessionOpened', { sessionId: 's1', profileDir: '~/.c' });
  };
  const lastFlow = () => sent.at(-1)?.find((flow) => flow.sessionId === 's1');
  const changeSettings = async (next: WorkflowTestSettings) => {
    settingsListener(next);
    await settled();
  };
  return {
    data,
    project,
    time,
    sent,
    logs,
    chatCalls,
    emit,
    agentEvent,
    replayBurst,
    openS1,
    lastFlow,
    changeSettings,
    runAction: (command: string) =>
      handlers.get('runAction')?.({ sessionId: 's1', command }),
  };
}

const SETTINGS: WorkflowTestSettings = {
  layout: 'default',
  autoClearAndMake: false,
  autoStartSeconds: 10,
};

function skill(name: string, args: string): AgentEvent {
  return { type: 'skillStarted', at: 1, agentId: 'main', skill: name, args };
}

// A wigley:feature turn's events, in log order, each stamped `at`.
function featureTurnEvents(at: number): AgentEvent[] {
  return [
    { ...skill('wigley:feature', ''), at },
    { type: 'turnStarted', at },
    { type: 'fileWritten', at, agentId: 'main', path: PLAN_FILE },
    { type: 'turnEnded', at },
  ];
}

const SUBAGENT_SPAWNED: AgentEvent = {
  type: 'agentSpawned',
  at: START - 5_000,
  agentId: 'a1',
  parentAgentId: 'main',
  agentType: 'worker',
  description: 'd',
  name: 'worker',
  model: null,
  effort: null,
};

const SAVED_AT = START - 1_000;
const BEFORE_SAVE = START - 5_000;
const AFTER_SAVE = START - 500;

// Workflow's data folder holding `flow` as s1's saved flow under h1.
async function savedFlowData(flow: Partial<SessionFlow>): Promise<MemoryFiles> {
  const data = createMemoryFiles();
  await data.write(
    FLOWS_FILE,
    JSON.stringify({
      flows: [
        {
          hostSessionId: 'h1',
          savedAt: SAVED_AT,
          flow: { ...newFlow('s-old', '/r'), hasLeftIdle: true, ...flow },
        },
      ],
    }),
  );
  return data;
}

// Opens s1 and runs a wigley:feature turn that writes the plan and ends, its
// events flagged `replayed` as given.
async function runFeatureTurn(
  workflow: ReturnType<typeof startWorkflowPart>,
  replayed = false,
): Promise<void> {
  await workflow.openS1();
  await workflow.agentEvent(skill('wigley:feature', ''), 'h1', replayed);
  await workflow.agentEvent({ type: 'turnStarted', at: 1 }, 'h1', replayed);
  await workflow.project.write(PLAN_FILE, PLAN);
  await workflow.agentEvent(
    {
      type: 'fileWritten',
      at: 1,
      agentId: 'main',
      path: PLAN_FILE,
    },
    'h1',
    replayed,
  );
  await workflow.agentEvent({ type: 'turnEnded', at: 1 }, 'h1', replayed);
}

describe('workflowMainPart', () => {
  it.each([
    { name: 'its side-bar label', sessionLabel: 'r 2', ranIn: 'r 2' },
    { name: 'its folder with no label', sessionLabel: undefined, ranIn: 'r' },
  ])(
    'featureTurnWritingAPlan_ReachesPlanReady_AndAutoStartsClearAndMake_LoggingTheSessionBy_$name',
    async ({ sessionLabel, ranIn }) => {
      const workflow = startWorkflowPart(
        { ...SETTINGS, autoClearAndMake: true },
        { sessionLabel },
      );

      await runFeatureTurn(workflow);

      const ready = workflow.lastFlow();
      expect(ready).toMatchObject({
        stage: 'planReady',
        planDir: PLAN_DIR,
        progress: readPlanProgress(PLAN),
        countdownEndsAt: START + 10_000,
      });
      await settled();
      const saved = JSON.parse(await workflow.data.read(FLOWS_FILE)) as {
        flows: { hostSessionId: string; flow: SessionFlow; savedAt: number }[];
      };
      expect(saved.flows).toEqual([
        { hostSessionId: 'h1', flow: ready, savedAt: START },
      ]);

      workflow.time.advance(9_999);
      expect(workflow.chatCalls).toEqual([]);
      workflow.time.advance(1);
      await settled();
      expect(workflow.chatCalls).toEqual([
        ['clear', 's1'],
        ['send', 's1', `/wigley:make ${PLAN_DIR}`],
      ]);
      expect(workflow.logs).toContainEqual([
        'workflow',
        `ran clearAndMake in ${ranIn}`,
      ]);
    },
  );

  it('replayedFeatureTurn_ReachesPlanReady_StartsNoCountdown', async () => {
    const workflow = startWorkflowPart({ ...SETTINGS, autoClearAndMake: true });

    await runFeatureTurn(workflow, true);

    expect(workflow.lastFlow()).toMatchObject({
      stage: 'planReady',
      planDir: PLAN_DIR,
      countdownEndsAt: null,
    });
    workflow.time.advance(10_000);
    await settled();
    expect(workflow.chatCalls).toEqual([]);
  });

  it('replayBurstOfAFeatureTurn_ItsPlanReadStartsNoCountdown', async () => {
    const workflow = startWorkflowPart({ ...SETTINGS, autoClearAndMake: true });
    await workflow.project.write(PLAN_FILE, PLAN);
    await workflow.openS1();

    await workflow.replayBurst(featureTurnEvents(1));
    await settled();

    expect(workflow.lastFlow()).toMatchObject({
      stage: 'planReady',
      planDir: PLAN_DIR,
      progress: readPlanProgress(PLAN),
      countdownEndsAt: null,
    });
    workflow.time.advance(10_000);
    await settled();
    expect(workflow.chatCalls).toEqual([]);
  });

  it.each<{
    name: string;
    saved: Partial<SessionFlow>;
    actionFirst?: string;
    replay: AgentEvent[];
    expected: Partial<SessionFlow>;
  }>([
    {
      name: 'a planReady the user cancelled, an older feature turn',
      saved: {
        stage: 'planReady',
        planDir: PLAN_DIR,
        progress: readPlanProgress(PLAN),
      },
      replay: featureTurnEvents(BEFORE_SAVE),
      expected: {
        stage: 'planReady',
        planDir: PLAN_DIR,
        progress: readPlanProgress(PLAN),
      },
    },
    {
      name: 'an idle from a dismissed run, an older make',
      saved: { stage: 'idle' },
      replay: [
        { ...skill('wigley:make', PLAN_DIR), at: BEFORE_SAVE },
        {
          type: 'fileWritten',
          at: BEFORE_SAVE,
          agentId: 'main',
          path: PLAN_FILE,
        },
      ],
      expected: { stage: 'idle', planDir: null, progress: null },
    },
    {
      name: 'older events still running, which only the row state takes',
      saved: { stage: 'idle' },
      replay: [
        { ...skill('wigley:feature', ''), at: BEFORE_SAVE },
        { type: 'turnStarted', at: BEFORE_SAVE },
        SUBAGENT_SPAWNED,
      ],
      expected: {
        stage: 'idle',
        turnRunning: true,
        runningSubagents: ['a1'],
      },
    },
    {
      name: 'an older turn start, then a turn from after the save',
      saved: { stage: 'idle' },
      replay: [
        { type: 'turnStarted', at: BEFORE_SAVE },
        { type: 'turnEnded', at: BEFORE_SAVE },
        ...featureTurnEvents(AFTER_SAVE),
      ],
      expected: {
        stage: 'planReady',
        planDir: PLAN_DIR,
        progress: readPlanProgress(PLAN),
      },
    },
    {
      name: 'a feature flow the open arms before the replay says it runs',
      saved: { stage: 'feature', planDir: PLAN_DIR },
      replay: [{ type: 'turnStarted', at: BEFORE_SAVE }],
      expected: { stage: 'planReady', turnRunning: true },
    },
    {
      name: 'a countdown the user cancelled before the replay, a newer make',
      saved: { stage: 'feature', planDir: PLAN_DIR },
      actionFirst: 'cancelCountdown',
      replay: [{ ...skill('wigley:make', PLAN_DIR), at: AFTER_SAVE }],
      expected: { stage: 'make', planDir: PLAN_DIR },
    },
    {
      name: 'a make whose plan moved on, the read not hiding a later review',
      saved: {
        stage: 'make',
        planDir: PLAN_DIR,
        progress: readPlanProgress(PLAN_TICKED),
      },
      replay: [{ ...skill('wigley:review', ''), at: AFTER_SAVE }],
      expected: { stage: 'review', progress: readPlanProgress(PLAN) },
    },
  ])(
    'replayOverASavedFlow_FoldsOnlyPastItsSave_StartsNoCountdown ($name)',
    async ({ saved, actionFirst, replay, expected }) => {
      const data = await savedFlowData(saved);
      const workflow = startWorkflowPart(
        { ...SETTINGS, autoClearAndMake: true },
        { data },
      );
      await workflow.project.write(PLAN_FILE, PLAN);
      await workflow.openS1();
      await settled();
      if (actionFirst !== undefined) {
        await workflow.runAction(actionFirst);
      }

      await workflow.replayBurst(replay);
      await settled();

      expect(workflow.lastFlow()).toMatchObject({
        ...expected,
        countdownEndsAt: null,
      });
      workflow.time.advance(10_000);
      await settled();
      expect(workflow.chatCalls).toEqual([]);
    },
  );

  it.each<{ name: string; live: AgentEvent[] }>([
    {
      name: 'a live turn that starts and ends',
      live: [
        { type: 'turnStarted', at: START },
        { type: 'turnEnded', at: START },
      ],
    },
    {
      name: 'the replayed turn ending live',
      live: [{ type: 'turnEnded', at: START }],
    },
  ])(
    'afterAReplay_ALiveTurnEnd_StartsTheCountdown ($name)',
    async ({ live }) => {
      const workflow = startWorkflowPart({
        ...SETTINGS,
        autoClearAndMake: true,
      });
      await workflow.project.write(PLAN_FILE, PLAN);
      await workflow.openS1();
      await workflow.replayBurst([
        { type: 'turnStarted', at: 1 },
        { type: 'turnEnded', at: 1 },
        ...featureTurnEvents(2).slice(0, 3),
      ]);
      await settled();

      for (const event of live) {
        await workflow.agentEvent(event);
      }

      expect(workflow.lastFlow()).toMatchObject({
        stage: 'planReady',
        countdownEndsAt: START + 10_000,
      });
    },
  );

  it.each([
    {
      name: 'a subagent started',
      act: (workflow: ReturnType<typeof startWorkflowPart>) =>
        workflow.agentEvent({
          type: 'agentSpawned',
          at: 1,
          agentId: 'a1',
          parentAgentId: 'main',
          agentType: 'worker',
          description: 'd',
          name: 'worker',
          model: null,
          effort: null,
        }),
    },
    {
      name: 'autoClearAndMake turned off',
      act: (workflow: ReturnType<typeof startWorkflowPart>) =>
        workflow.changeSettings(SETTINGS),
    },
  ])('countdownAfter_RunsNothing ($name)', async ({ act }) => {
    const workflow = startWorkflowPart({ ...SETTINGS, autoClearAndMake: true });
    await runFeatureTurn(workflow);

    await act(workflow);
    workflow.time.advance(10_000);
    await settled();

    expect(workflow.chatCalls).toEqual([]);
    expect(workflow.lastFlow()?.countdownEndsAt).toBeNull();
  });

  it('turnEndedChangingNoField_StillChecksThePlan', async () => {
    const workflow = startWorkflowPart(SETTINGS, { silentWatch: true });
    await workflow.project.write(PLAN_FILE, PLAN);
    await workflow.openS1();
    await workflow.agentEvent(skill('wigley:make', PLAN_DIR));
    expect(workflow.lastFlow()).toMatchObject({
      stage: 'make',
      turnRunning: false,
    });

    workflow.project.remove(PLAN_DIR);
    await workflow.agentEvent({ type: 'turnEnded', at: 1 });

    expect(workflow.lastFlow()?.stage).toBe('closed');
  });

  it('planFileWrittenAfterPlanGone_ReadsThePlanAgain', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.project.write(PLAN_FILE, PLAN);
    await workflow.openS1();
    await workflow.agentEvent(skill('wigley:make', PLAN_DIR));
    workflow.project.remove(PLAN_DIR);
    await settled();
    expect(workflow.lastFlow()?.stage).toBe('closed');

    await workflow.project.write(PLAN_FILE, PLAN_TICKED);
    await workflow.agentEvent({
      type: 'fileWritten',
      at: 1,
      agentId: 'main',
      path: PLAN_FILE,
    });

    expect(workflow.lastFlow()?.progress).toEqual(
      readPlanProgress(PLAN_TICKED),
    );
  });

  it('sessionEnded_EndsTheTurnOnlyFromTheCurrentHost', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.openS1();
    await workflow.agentEvent({ type: 'turnStarted', at: 1 });
    await workflow.agentEvent({
      type: 'agentSpawned',
      at: 1,
      agentId: 'a1',
      parentAgentId: 'main',
      agentType: 'worker',
      description: 'd',
      name: 'worker',
      model: null,
      effort: null,
    });

    await workflow.agentEvent({ type: 'sessionEnded', at: 1 });
    expect(workflow.lastFlow()).toMatchObject({
      turnRunning: false,
      runningSubagents: [],
    });

    await workflow.emit('sessions.hostSessionChanged', session('s1', 'h2'));
    await workflow.agentEvent({ type: 'turnStarted', at: 1 }, 'h2');
    const sentBefore = workflow.sent.length;
    await workflow.agentEvent({ type: 'sessionEnded', at: 1 }, 'h1');
    expect(workflow.sent).toHaveLength(sentBefore);
    expect(workflow.lastFlow()?.turnRunning).toBe(true);
  });

  it.each([
    { seconds: 3, line: 'settings: autoClearAndMake on, autoStartSeconds 3' },
    { seconds: 0, line: 'settings: autoClearAndMake on, autoStartSeconds 1' },
  ])(
    'settingsChange_LogsTheValuesInUse ($seconds)',
    async ({ seconds, line }) => {
      const workflow = startWorkflowPart(SETTINGS);
      await settled();

      await workflow.changeSettings({
        ...SETTINGS,
        autoClearAndMake: true,
        autoStartSeconds: seconds,
      });

      expect(workflow.logs).toEqual([['workflow', line]]);
    },
  );
});
