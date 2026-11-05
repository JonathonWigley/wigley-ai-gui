import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../contracts/agent';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { QualifiedEvents } from '../../../contracts/plugin';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  fakeDependency,
  noCounts,
  startMainPart,
  type MainPartHarness,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { createSlotStore } from '../../../shared/state/slot-store';
import type { ChatMainEvents, ChatMainExports } from '../../chat/contract';
import {
  type AgentSession,
  type SessionsMainEvents,
  type SessionsMainExports,
  sessionsMainKey,
  type ToolCallContext,
  type ToolDefinition,
  type ToolSession,
} from '../../sessions/contract';
import {
  type MainStage,
  type SessionFlow,
  workflowFlowsSlot,
  type WorkflowMainExports,
} from '../contract';
import { newFlow } from '../flow';
import type { workflowManifest } from '../manifest';
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

const FLOWS_PATH = `/data/workflow/${FLOWS_FILE}`;

const settled = () => new Promise((settle) => setImmediate(settle));

// Project files whose reads, from `holdReads` on, wait for `release`.
function holdableReads() {
  const memory = createMemoryFiles();
  let held: PromiseWithResolvers<void> | null = null;
  const files: Files = {
    ...memory,
    read: async (path) => {
      await held?.promise;
      return memory.read(path);
    },
  };
  return {
    files,
    holdReads: () => {
      held = Promise.withResolvers<void>();
    },
    release: () => held?.resolve(),
  };
}

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
// records each `clear` and `send`, and a real store for its slot: `sent` holds
// each flow the slot's notices carry. `silentWatch` gives the project files a
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
  const sent: SessionFlow[] = [];
  const store = createSlotStore(() => undefined);
  const slot = store.read(workflowFlowsSlot, 'test');
  slot.on((_sessionId, flow) => {
    if (flow !== undefined) {
      sent.push(flow);
    }
  });
  const logs: string[] = [];
  const chatCalls: unknown[][] = [];
  let settingsListener: (next: WorkflowTestSettings) => void = () => undefined;
  const data = options.data ?? createMemoryFiles();
  const project = createMemoryFiles();
  const projectFiles: Files =
    options.silentWatch === true
      ? { ...project, watch: () => ({ dispose: () => undefined }) }
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
  const stepTools: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
  }[] = [];
  const sessions: Pick<SessionsMainExports, 'label' | 'contributeTools'> = {
    label: (sessionId) =>
      sessionId === 's1' ? (options.sessionLabel ?? null) : null,
    contributeTools: (tools, start) => {
      const contribution = { tools, start };
      stepTools.push(contribution);
      return {
        dispose: () => {
          stepTools.splice(stepTools.indexOf(contribution), 1);
        },
      };
    },
  };
  const dependencies: Record<string, unknown> = { chat, sessions };
  const api = {
    channel: {
      handle: (name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
    },
    state: { publish: () => store.publish(workflowFlowsSlot) },
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
      log: (line: string) => logs.push(line),
      clock: time.clock,
      timers: time.timers,
      paths: posixPaths,
      selfTest: null,
    },
    dependency: (key: { id: string }) => dependencies[key.id] ?? {},
    data,
    drive: null,
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof workflowMainPart.start>[0];
  const part = workflowMainPart.start(api);

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
    await emit('sessions.connected', {
      ...session('s1', 'h1'),
      owned: true,
    });
    await emit('chat.sessionOpened', {
      sessionId: 's1',
      profileDir: '~/.c',
      hostSessionId: 'h1',
      projectDir: '/p',
      profile: 'personal',
      origin: 'new',
    });
  };
  const lastFlow = () => slot.get('s1');
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
    stepTools,
    addStage(stage: MainStage) {
      const exported = part.exports?.(
        createRegistrations(),
      ) as WorkflowMainExports;
      return exported.addStage(stage);
    },
    // A `set_workflow_step` call from session `id`.
    callStepTool: async (id: string, step: string) => {
      const pending = stepTools[0]
        .start(session(id, 'h1'))
        .call('set_workflow_step', { step }, NO_CALL_CONTEXT);
      await settled();
      return pending;
    },
  };
}

// Sessions for the harness's parts: every contribution taken and disposable.
const FAKE_SESSIONS = fakeDependency(
  sessionsMainKey,
  (consumer) =>
    ({
      contributeTools: () => consumer.track({ dispose: () => undefined }),
    }) as unknown as SessionsMainExports,
);

const NO_CALL_CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

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
          flow: { ...newFlow('s-old', '/r'), ...flow },
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

// Runs a wigley:feature turn that writes the plan into `project`, over the part
// harness, so the flow holds a plan watch and a running countdown.
async function reachPlanReady(
  harness: MainPartHarness<typeof workflowManifest>,
  project: Files = harness.files,
): Promise<void> {
  const agentEvent = async (event: AgentEvent) => {
    harness.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude',
      hostSessionId: 'h1',
      event,
    });
    await settled();
  };
  harness.emit('sessions.connected', { ...session('s1', 'h1'), owned: true });
  harness.emit('chat.sessionOpened', {
    sessionId: 's1',
    profileDir: '~/.c',
    hostSessionId: 'h1',
    projectDir: '/p',
    profile: 'personal',
    origin: 'new',
  });
  await settled();
  await agentEvent(skill('wigley:feature', ''));
  await agentEvent({ type: 'turnStarted', at: 1 });
  await project.write(PLAN_FILE, PLAN);
  await agentEvent({
    type: 'fileWritten',
    at: 1,
    agentId: 'main',
    path: PLAN_FILE,
  });
  await agentEvent({ type: 'turnEnded', at: 1 });
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
      expect(workflow.logs).toContainEqual(`ran clearAndMake in ${ranIn}`);
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
      name: 'an explore flow the open arms before the replay says it runs',
      saved: { stage: 'explore', planDir: PLAN_DIR },
      replay: [{ type: 'turnStarted', at: BEFORE_SAVE }],
      expected: { stage: 'planReady', turnRunning: true },
    },
    {
      name: 'a countdown the user cancelled before the replay, a newer make',
      saved: { stage: 'explore', planDir: PLAN_DIR },
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

  it('oneFlowChange_NotifiesOneKey', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.openS1();
    for (const id of ['s2', 's3']) {
      await workflow.emit('sessions.connected', {
        ...session(id, `h-${id}`),
        owned: true,
      });
      await workflow.emit('chat.sessionOpened', {
        sessionId: id,
        profileDir: '~/.c',
        hostSessionId: `h-${id}`,
        projectDir: '/p',
        profile: 'personal',
        origin: 'new',
      });
    }
    workflow.sent.length = 0;

    await workflow.agentEvent({ type: 'turnStarted', at: 1 });

    expect(workflow.sent.map(({ sessionId }) => sessionId)).toEqual(['s1']);
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

  it('stepTool_ReportFromAFeatureRun_MovesTheFlowAndStampsTheSave', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.openS1();
    await workflow.agentEvent(skill('wigley:feature', ''));
    workflow.time.advance(5);

    const result = await workflow.callStepTool('s1', 'cold_read');

    expect(workflow.lastFlow()?.stage).toBe('coldRead');
    expect(result.content[0].text).toContain('cold_read');
    await settled();
    const saved = JSON.parse(await workflow.data.read(FLOWS_FILE)) as {
      flows: { flow: SessionFlow; savedAt: number }[];
    };
    expect(saved.flows[0]).toMatchObject({
      flow: { stage: 'coldRead' },
      savedAt: START + 5,
    });
  });

  it.each([
    { name: 'an idle flow', session: 's1', opens: true },
    { name: 'a session with no flow', session: 's-terminal', opens: true },
    { name: 'a connected session not yet opened', session: 's1', opens: false },
  ])('stepTool_ReportIsIgnored ($name)', async ({ session: id, opens }) => {
    const workflow = startWorkflowPart(SETTINGS);
    if (opens) {
      await workflow.openS1();
    }
    await settled();
    const sentBefore = workflow.sent.length;

    const result = await workflow.callStepTool(id, 'interview');

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Ignored');
    expect(workflow.sent).toHaveLength(sentBefore);
  });

  it('stepTool_StageAddedByAPlugin_JoinsTheToolUntilDisposed', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    const stepsOffered = () =>
      (
        workflow.stepTools[0].tools[0].inputSchema as {
          properties: { step: { enum: string[] } };
        }
      ).properties.step.enum;
    expect(workflow.stepTools).toHaveLength(1);
    expect(stepsOffered()).not.toContain('extra');

    const added = workflow.addStage({
      id: 'extra',
      order: 23,
      reportedAs: 'extra',
      enter: (_flow, signal) =>
        signal.type === 'stepReported' && signal.step === 'extra'
          ? 'extra'
          : null,
    });

    expect(workflow.stepTools).toHaveLength(1);
    expect(stepsOffered()).toContain('extra');
    await workflow.openS1();
    await workflow.callStepTool('s1', 'extra');
    expect(workflow.lastFlow()?.stage).toBe('extra');

    added.dispose();
    expect(stepsOffered()).not.toContain('extra');
  });

  it('savedFlowInAStageNoLongerRegistered_OpensAndFoldsWithoutThrowing', async () => {
    const data = await savedFlowData({ stage: 'feature', planDir: PLAN_DIR });
    const workflow = startWorkflowPart(SETTINGS, { data });

    await workflow.openS1();
    await workflow.agentEvent({ type: 'turnEnded', at: AFTER_SAVE });
    expect(workflow.lastFlow()?.stage).toBe('feature');

    await workflow.agentEvent(skill('wigley:feature', ''));
    expect(workflow.lastFlow()?.stage).toBe('explore');
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

      expect(workflow.logs).toEqual([line]);
    },
  );

  it.each([
    {
      state: 'fresh start',
      replacesFiles: false,
      act: () => Promise.resolve(),
      liveTimers: 0,
    },
    {
      state: 'a plan watched and its countdown running',
      replacesFiles: false,
      act: (harness: MainPartHarness<typeof workflowManifest>) =>
        reachPlanReady(harness),
      liveTimers: 1,
    },
    {
      state: 'a plan read held open',
      replacesFiles: true,
      act: async (
        harness: MainPartHarness<typeof workflowManifest>,
        project: ReturnType<typeof holdableReads>,
      ) => {
        await reachPlanReady(harness, project.files);
        project.holdReads();
        await project.files.write(PLAN_FILE, PLAN_TICKED);
        await settled();
      },
      liveTimers: 1,
    },
  ])(
    'stop_LeavesNoLiveRegistration_AndWritesNothing ($state)',
    async ({ replacesFiles, act, liveTimers }) => {
      const project = holdableReads();
      const harness = startMainPart(workflowMainPart, {
        dependencies: [FAKE_SESSIONS],
        settings: { ...SETTINGS, autoClearAndMake: true },
        services: replacesFiles ? { files: project.files } : {},
      });
      await act(harness, project);
      expect(harness.counts().timers).toBe(liveTimers);
      expect(harness.counts().registrations).toBeGreaterThan(0);
      const savedAtStop = await readIfPresent(harness.files, FLOWS_PATH);

      await harness.stop();
      project.release();
      await settled();

      expect(harness.counts()).toEqual(noCounts);
      expect(await readIfPresent(harness.files, FLOWS_PATH)).toBe(savedAtStop);
    },
  );

  it('stopThenStart_StartsAgain', async () => {
    const harness = startMainPart(workflowMainPart, {
      dependencies: [FAKE_SESSIONS],
    });

    await harness.restart();
    await settled();

    expect([...harness.state.read(workflowFlowsSlot, 'test').all()]).toEqual(
      [],
    );
  });

  it('exports_ConsumerDisposed_FreesTheStageId', () => {
    const harness = startMainPart(workflowMainPart, {
      dependencies: [FAKE_SESSIONS],
    });
    const exportsFor = (consumer: ReturnType<typeof createRegistrations>) =>
      harness.started().exports?.(consumer) as WorkflowMainExports;
    const stage: MainStage = { id: 'extra', order: 70, enter: () => null };
    const consumerA = createRegistrations();
    exportsFor(consumerA).addStage(stage);

    consumerA.dispose();

    expect(() =>
      exportsFor(createRegistrations()).addStage(stage),
    ).not.toThrow();
  });
});
