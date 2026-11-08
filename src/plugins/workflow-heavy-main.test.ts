import { describe, expect, it } from 'vitest';
import type { ActiveTime } from '../contracts/active-time';
import type { AgentEvent, UsageAgentEvent } from '../contracts/agent';
import { type Files, readIfPresent } from '../contracts/files';
import type { QualifiedEvents } from '../contracts/plugin';
import { createMemoryFiles, type MemoryFiles } from '../shared/memory-files';
import { posixPaths } from '../shared/paths/posix-paths';
import {
  noCounts,
  startMainPart,
  type MainPartHarness,
} from '../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../shared/registrations';
import { createSlotStore } from '../shared/state/slot-store';
import { type ChatMainEvents, type ChatMainExports } from './chat/contract';
import {
  type AgentSession,
  type SessionsMainEvents,
  type SessionsMainExports,
  type ToolCallContext,
  type ToolDefinition,
  type ToolSession,
} from './sessions/contract';
import {
  type MainWorkflow,
  type SessionFlow,
  startsSkill,
  workflowFlowsSlot,
  type WorkflowMainExports,
  type WorkflowSignal,
} from './workflow/contract';
import { newFlow } from './workflow/flow';
import {
  FAKE_CHAT,
  FAKE_SESSIONS,
  startEngineMainPart,
} from './workflow/main/engine-fakes.test-support';
import { FLOWS_FILE } from './workflow/main/flow-store';
import { RUNS_FILE, type RunLogLine } from './workflow/main/run-log';
import { workflowMainPart } from './workflow/main/start';
import { SET_WORKFLOW_STEP_TOOL } from './workflow/main/step-tool';
import {
  HEAVY_WORKFLOW_ID,
  heavySignal,
  type HeavyState,
  heavyStateOf,
} from './workflow-heavy/contract';
import { workflowHeavyMainPart } from './workflow-heavy/main/start';
import { readPlanProgress } from '../shared/plan-progress';

const START = 1_000_000;
const PLAN_DIR = '/r/docs/features/x/plan-a';
const PLAN_FILE = `${PLAN_DIR}/plan.md`;
const PLAN =
  '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [ ] two\n- [ ] three\n';
const PLAN_TICKED =
  '# Plan A — plan\n\n## Tasks\n\n- [x] one\n- [x] two\n- [ ] three\n';

// The events the engine's main part hears.
type WorkflowHeard = QualifiedEvents<'chat', ChatMainEvents> &
  QualifiedEvents<'sessions', SessionsMainEvents>;

interface HeavyTestSettings {
  layout: string;
  autoClearAndMake: boolean;
  autoStartSeconds: number;
}

const FLOWS_PATH = `/data/workflow/${FLOWS_FILE}`;

const settled = () => new Promise((settle) => setImmediate(settle));
// Git that finds every folder outside a clone, so each plan has one copy.
const NO_CLONE_GIT = { topLevel: async () => null };

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
    liveTimers: () => pending.size,
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

// The real engine's main part over a fake `MainApi`, handing its exports to the
// real Heavy part as the `workflow` dependency: memory files for the engine's data
// and for the project (`project`), hand-moved time, a real store for the engine's
// slot, and a chat fake that records each `clear` and `send`. `silentWatch` gives the project files a watch that reports
// nothing, as an OS watcher that misses a delete; `sessionLabel` is the side-bar
// label sessions gives s1 (none by default); `data` is the engine's data folder as
// the last run left it; `heavyLater` leaves Heavy unstarted until `startHeavy`, as a
// restarted part over flows already open. `logs` holds Heavy's lines alone.
function startWorkflowPart(
  settings: HeavyTestSettings,
  options: {
    silentWatch?: boolean;
    sessionLabel?: string;
    data?: MemoryFiles;
    heavyLater?: boolean;
  } = {},
) {
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const store = createSlotStore(() => undefined);
  const flows = store.read(workflowFlowsSlot, 'test');
  const logs: string[] = [];
  const chatCalls: unknown[][] = [];
  let settingsListener: (next: HeavyTestSettings) => void = () => undefined;
  const data = options.data ?? createMemoryFiles();
  const project = createMemoryFiles();
  const projectReads: string[] = [];
  const projectFiles: Files = {
    ...project,
    read: (path) => {
      projectReads.push(path);
      return project.read(path);
    },
    ...(options.silentWatch === true
      ? { watch: () => ({ dispose: () => undefined }) }
      : {}),
  };
  const time = handTime();
  let activeTime: ActiveTime | null = null;
  const chat: Pick<
    ChatMainExports,
    'send' | 'clear' | 'launch' | 'profileOf' | 'activeTime' | 'addInstructions'
  > = {
    activeTime: () => activeTime,
    send: async (sessionId, message) => {
      chatCalls.push(['send', sessionId, message.text]);
    },
    clear: async (sessionId) => {
      chatCalls.push(['clear', sessionId]);
    },
    launch: async () => 's2',
    profileOf: () => 'personal',
    addInstructions: () => ({ dispose: () => undefined }),
  };
  const contributions: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
  }[] = [];
  const sessions: Pick<SessionsMainExports, 'label' | 'contributeTools'> = {
    label: (sessionId) =>
      sessionId === 's1' ? (options.sessionLabel ?? null) : null,
    contributeTools: (tools, start) => {
      const contribution = { tools, start };
      contributions.push(contribution);
      return {
        dispose: () => {
          contributions.splice(contributions.indexOf(contribution), 1);
        },
      };
    },
  };
  const layouts = { register: () => ({ dispose: () => undefined }) };
  const engine = workflowMainPart.start({
    state: { publish: () => store.publish(workflowFlowsSlot) },
    events: {
      emit: () => undefined,
      on: (event: string, listener: (data: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    settings: () => ({}),
    onSettingsChanged: () => ({ dispose: () => undefined }),
    services: {
      files: projectFiles,
      log: () => undefined,
      clock: time.clock,
      timers: time.timers,
      paths: posixPaths,
      selfTest: null,
    },
    dependency: (key: { id: string }) =>
      ({ chat, sessions } as Record<string, unknown>)[key.id],
    data,
    drive: null,
    layouts,
  } as unknown as Parameters<typeof workflowMainPart.start>[0]);
  const exported = () =>
    engine.exports?.(createRegistrations()) as WorkflowMainExports;
  const startHeavy = () =>
    workflowHeavyMainPart.start({
      channel: {
        handle: (name: string, handler: (...args: unknown[]) => unknown) =>
          handlers.set(name, handler),
      },
      settings: () => settings,
      onSettingsChanged: (listener: (next: HeavyTestSettings) => void) => {
        settingsListener = listener;
        return { dispose: () => undefined };
      },
      services: {
        git: NO_CLONE_GIT,
        files: projectFiles,
        log: (line: string) => logs.push(line),
        clock: time.clock,
        timers: time.timers,
        paths: posixPaths,
        selfTest: null,
      },
      dependency: (key: { id: string }) =>
        ({ workflow: exported(), chat, sessions } as Record<string, unknown>)[
          key.id
        ],
      layouts,
    } as unknown as Parameters<typeof workflowHeavyMainPart.start>[0]);
  if (options.heavyLater !== true) {
    startHeavy();
  }

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
    await emit('sessions.connected', { ...session('s1', 'h1'), owned: true });
    await emit('chat.sessionOpened', {
      sessionId: 's1',
      profileDir: '~/.c',
      hostSessionId: 'h1',
      projectDir: '/r',
      profile: 'personal',
      origin: 'new',
    });
  };
  const lastFlow = () => flows.get('s1');
  // The last flow with its Heavy state's fields beside its own.
  const lastHeavy = () => {
    const flow = lastFlow();
    return flow === undefined ? undefined : { ...flow, ...heavyStateOf(flow) };
  };
  const savedAt = async () => {
    await settled();
    const saved = JSON.parse(await data.read(FLOWS_FILE)) as {
      flows: { savedAt: number }[];
    };
    return saved.flows[0].savedAt;
  };
  const changeSettings = async (next: HeavyTestSettings) => {
    settingsListener(next);
    await settled();
  };
  // A call of the live contribution of the step tool from session `id`.
  const callStepTool = async (id: string, step: string) => {
    const contribution = contributions.find(({ tools }) =>
      tools.some((tool) => tool.name === SET_WORKFLOW_STEP_TOOL),
    );
    if (contribution === undefined) {
      throw new Error(`no contribution of ${SET_WORKFLOW_STEP_TOOL}`);
    }
    const pending = contribution
      .start(session(id, 'h1'))
      .call(SET_WORKFLOW_STEP_TOOL, { step }, NO_CALL_CONTEXT);
    await settled();
    return pending;
  };
  return {
    data,
    project,
    projectReads,
    time,
    setActiveTime: (next: ActiveTime) => {
      activeTime = next;
    },
    logs,
    chatCalls,
    emit,
    agentEvent,
    replayBurst,
    openS1,
    lastFlow,
    lastHeavy,
    exported,
    startHeavy,
    savedAt,
    changeSettings,
    runAction: (command: string) =>
      handlers.get('runAction')?.({ sessionId: 's1', command }),
    callStepTool,
  };
}

const NO_CALL_CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

const SETTINGS: HeavyTestSettings = {
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

type FlowFields = Partial<SessionFlow & HeavyState>;

// The engine's data folder holding a Heavy flow of `fields` as s1's saved flow under
// h1.
async function savedFlowData(fields: FlowFields): Promise<MemoryFiles> {
  const { planDir, progress, reviewRoundsAtMake, countdownEndsAt, ...flow } =
    fields;
  const data = createMemoryFiles();
  await data.write(
    FLOWS_FILE,
    JSON.stringify({
      flows: [
        {
          hostSessionId: 'h1',
          savedAt: SAVED_AT,
          flow: {
            ...newFlow('s-old', '/r'),
            workflow: HEAVY_WORKFLOW_ID,
            ...flow,
            state: {
              planDir: planDir ?? null,
              progress: progress ?? null,
              reviewRoundsAtMake: reviewRoundsAtMake ?? null,
              countdownEndsAt: countdownEndsAt ?? null,
            },
          },
        },
      ],
    }),
  );
  return data;
}

// A workflow that claims the skill `x:stub`.
function stubWorkflow(fields: Partial<MainWorkflow> = {}): MainWorkflow {
  return {
    id: 'stub',
    order: 10,
    claims: (signal) => startsSkill(signal, 'x:stub'),
    firstStage: 'scope',
    stages: [],
    ...fields,
  };
}

// The main agent's `usage`: it went out for a reply.
const USAGE: UsageAgentEvent = {
  type: 'usage',
  at: 1,
  agentId: 'main',
  contextTokens: 10,
  contextWindow: null,
  autocompact: { configured: null, reported: null },
  cacheExpiresAt: null,
  spendUsd: null,
};

// The main agent's `usage` reporting the process's spend so far.
const spent = (spendUsd: number): UsageAgentEvent => ({ ...USAGE, spendUsd });

const activeFor = (totalMs: number): ActiveTime => ({ totalMs, since: null });

const PLAN_WITH_TWO_ROUNDS = `${PLAN}\n## Run log\n\n### Review rounds\n- one\n- two\n`;

// The lines `runs.jsonl` holds once its appends settle.
async function runLines(
  workflow: ReturnType<typeof startWorkflowPart>,
): Promise<string[]> {
  await settled();
  const text = await readIfPresent(workflow.data, RUNS_FILE);
  return text === null ? [] : text.trimEnd().split('\n');
}

async function runLogLines(
  workflow: ReturnType<typeof startWorkflowPart>,
): Promise<RunLogLine[]> {
  const lines = await runLines(workflow);
  return lines.map((line) => JSON.parse(line) as RunLogLine);
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

// The real engine's part in one harness and Heavy's in another, on the engine's
// exports: stopping Heavy leaves the engine running, as a restart of Heavy alone.
function startPartsInHarnesses(
  settings: HeavyTestSettings,
  services: { files?: Files } = {},
) {
  const { engine, dependency } = startEngineMainPart();
  const heavy = startMainPart(workflowHeavyMainPart, {
    dependencies: [dependency, FAKE_SESSIONS, FAKE_CHAT],
    settings,
    services: { git: NO_CLONE_GIT as never, ...services },
  });
  return { engine, heavy };
}

// Runs a wigley:feature turn that writes the plan into `project`, so the flow holds
// a plan watch and a running countdown.
async function reachPlanReady(
  engine: MainPartHarness<typeof workflowMainPart.manifest>,
  project: Files,
): Promise<void> {
  const agentEvent = async (event: AgentEvent) => {
    engine.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude',
      hostSessionId: 'h1',
      event,
    });
    await settled();
  };
  engine.emit('sessions.connected', { ...session('s1', 'h1'), owned: true });
  engine.emit('chat.sessionOpened', {
    sessionId: 's1',
    profileDir: '~/.c',
    hostSessionId: 'h1',
    projectDir: '/r',
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

describe('workflowHeavyMainPart', () => {
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
      expect(workflow.lastHeavy()).toMatchObject({
        stage: 'planReady',
        planDir: PLAN_DIR,
        progress: readPlanProgress(PLAN, new Map()),
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

    expect(workflow.lastHeavy()).toMatchObject({
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

    expect(workflow.lastHeavy()).toMatchObject({
      stage: 'planReady',
      planDir: PLAN_DIR,
      progress: readPlanProgress(PLAN, new Map()),
      countdownEndsAt: null,
    });
    workflow.time.advance(10_000);
    await settled();
    expect(workflow.chatCalls).toEqual([]);
  });

  it.each<{
    name: string;
    saved: FlowFields;
    actionFirst?: string;
    replay: AgentEvent[];
    expected: FlowFields;
  }>([
    {
      name: 'a planReady the user cancelled, an older feature turn',
      saved: {
        stage: 'planReady',
        planDir: PLAN_DIR,
        progress: readPlanProgress(PLAN, new Map()),
      },
      replay: featureTurnEvents(BEFORE_SAVE),
      expected: {
        stage: 'planReady',
        planDir: PLAN_DIR,
        progress: readPlanProgress(PLAN, new Map()),
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
        progress: readPlanProgress(PLAN, new Map()),
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
        progress: readPlanProgress(PLAN_TICKED, new Map()),
      },
      replay: [{ ...skill('wigley:review', ''), at: AFTER_SAVE }],
      expected: {
        stage: 'review',
        progress: readPlanProgress(PLAN, new Map()),
      },
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

      expect(workflow.lastHeavy()).toMatchObject({
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

      expect(workflow.lastHeavy()).toMatchObject({
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
    expect(workflow.lastHeavy()?.countdownEndsAt).toBeNull();
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

    expect(workflow.lastHeavy()?.progress).toEqual(
      readPlanProgress(PLAN_TICKED, new Map()),
    );
  });

  it('StepTool_Heavy', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.openS1();
    await workflow.agentEvent(skill('wigley:feature', ''));
    workflow.time.advance(5);

    const result = await workflow.callStepTool('s1', 'cold_read');

    expect(workflow.lastFlow()?.stage).toBe('coldRead');
    expect(result.content[0].text).toBe('Step set to cold_read.');
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

  it('Open_SavedCountdown_RunsNone', async () => {
    const data = await savedFlowData({
      stage: 'planReady',
      countdownEndsAt: 9000,
    });
    const workflow = startWorkflowPart(
      { ...SETTINGS, autoClearAndMake: true },
      { data },
    );

    await workflow.openS1();

    expect(workflow.lastHeavy()?.countdownEndsAt).toBeNull();
    expect(await workflow.savedAt()).toBe(SAVED_AT);
    expect(workflow.time.liveTimers()).toBe(0);
  });

  it('Countdown_CancelStopsTheTimer', async () => {
    const workflow = startWorkflowPart({ ...SETTINGS, autoClearAndMake: true });
    await runFeatureTurn(workflow);
    expect(workflow.time.liveTimers()).toBe(1);

    await workflow.runAction('cancelCountdown');

    expect(workflow.time.liveTimers()).toBe(0);
    expect(workflow.lastHeavy()?.countdownEndsAt).toBeNull();
  });

  it("Countdown_CancelOnAnotherWorkflow'sFlow_LeavesItsState", async () => {
    const workflow = startWorkflowPart(SETTINGS);
    workflow.exported().addWorkflow(stubWorkflow());
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    const state = {
      countdownEndsAt: 5,
      planDir: null,
      progress: null,
      reviewRoundsAtMake: null,
    };
    workflow.exported().setState('s1', state);

    await workflow.runAction('cancelCountdown');

    expect(workflow.exported().flowOf('s1')?.state).toBe(state);
  });

  it('FlowLeavingHeavy_StopsItsWatchAndCountdown', async () => {
    const workflow = startWorkflowPart({ ...SETTINGS, autoClearAndMake: true });
    workflow.exported().addWorkflow(stubWorkflow());
    await runFeatureTurn(workflow);
    expect(workflow.time.liveTimers()).toBe(1);

    await workflow.agentEvent(skill('x:stub', ''));
    const signalsAfterTheClaim: WorkflowSignal[] = [];
    workflow.exported().observe({
      folded: ({ signal }) => signalsAfterTheClaim.push(signal),
      opened: () => undefined,
      closed: () => undefined,
      replaying: () => undefined,
    });
    workflow.project.remove(PLAN_DIR);
    await settled();

    expect(signalsAfterTheClaim).toEqual([]);
    expect(workflow.time.liveTimers()).toBe(0);
    expect(workflow.lastFlow()).toMatchObject({
      workflow: 'stub',
      stage: 'scope',
      movedUpFrom: HEAVY_WORKFLOW_ID,
    });
  });

  it('RunLog_HeavyClosed', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.project.write(PLAN_FILE, PLAN_WITH_TWO_ROUNDS);
    await workflow.openS1();
    await workflow.agentEvent(skill('wigley:make', PLAN_DIR));
    workflow.setActiveTime(activeFor(4000));
    await workflow.agentEvent(spent(1.25));
    workflow.setActiveTime(activeFor(0));
    await workflow.emit('sessions.hostSessionChanged', session('s1', 'h2'));
    workflow.setActiveTime(activeFor(1500));
    await workflow.agentEvent(spent(2.5), 'h2');
    workflow.time.advance(90_000);

    workflow.project.remove(PLAN_DIR);
    await settled();

    expect(workflow.lastFlow()?.stage).toBe('closed');
    expect(await runLines(workflow)).toEqual([
      `{"at":${String(START + 90_000)},"sessionId":"s1","projectDir":"/r","workflow":"workflow-heavy","movedUpFrom":null,"activeMs":5500,"costUsd":3.75,"fixCycles":2}`,
    ]);
  });

  it('RunLog_MovedUp', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    workflow.exported().addWorkflow(
      stubWorkflow({
        id: 'light',
        claims: (signal) => startsSkill(signal, 'x:light'),
        firstStage: 'build',
      }),
    );
    await workflow.project.write(PLAN_FILE, PLAN);
    await workflow.openS1();
    await workflow.agentEvent(skill('x:light', ''));
    await workflow.agentEvent(skill('wigley:feature', ''));
    await workflow.agentEvent(skill('wigley:make', PLAN_DIR));

    workflow.project.remove(PLAN_DIR);
    await settled();

    expect(await runLogLines(workflow)).toMatchObject([
      { workflow: HEAVY_WORKFLOW_ID, movedUpFrom: 'light' },
    ]);
  });

  it('RunLog_OnlyOnEntry', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.project.write(PLAN_FILE, PLAN);
    await workflow.openS1();
    await workflow.agentEvent(skill('wigley:make', PLAN_DIR));
    workflow.project.remove(PLAN_DIR);
    await settled();
    expect(workflow.lastFlow()?.stage).toBe('closed');

    workflow.exported().signal('s1', heavySignal({ type: 'planGone' }), 'live');

    expect(await runLines(workflow)).toHaveLength(1);
  });

  it('startWithFlowsHeld_FollowsTheirPlans', async () => {
    const data = await savedFlowData({
      stage: 'make',
      planDir: PLAN_DIR,
      countdownEndsAt: 9000,
    });
    const workflow = startWorkflowPart(SETTINGS, { data, heavyLater: true });
    await workflow.project.write(PLAN_FILE, PLAN);
    await workflow.openS1();
    expect(workflow.lastHeavy()?.progress).toBeNull();

    workflow.startHeavy();
    await settled();

    expect(workflow.lastHeavy()).toMatchObject({
      progress: readPlanProgress(PLAN, new Map()),
      countdownEndsAt: null,
    });
    expect(workflow.time.liveTimers()).toBe(0);
  });

  it('subagentPlanWrite_NamesThePlanAndWatchesIt', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.project.write('/r/docs/plan-a/plan.md', PLAN);
    await workflow.openS1();
    await workflow.agentEvent(skill('wigley:feature', ''));

    await workflow.agentEvent({
      type: 'fileWritten',
      at: 1,
      agentId: 'a1',
      path: '/r/docs/plan-a/plan.md',
    });

    expect(workflow.lastHeavy()).toMatchObject({
      planDir: '/r/docs/plan-a',
      progress: readPlanProgress(PLAN, new Map()),
    });
  });

  it('flowOfAnotherWorkflow_IsNotWatched', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    workflow.exported().addWorkflow(
      stubWorkflow({
        id: 'workflow-light',
        claims: (signal) => startsSkill(signal, 'wigley:light'),
        firstStage: 'build',
      }),
    );
    await workflow.project.write(PLAN_FILE, PLAN);
    await workflow.openS1();
    await workflow.agentEvent(skill('wigley:light', ''));

    await workflow.agentEvent({
      type: 'fileWritten',
      at: 1,
      agentId: 'main',
      path: PLAN_FILE,
    });

    expect(workflow.lastFlow()).toMatchObject({
      workflow: 'workflow-light',
      state: null,
    });
    expect(workflow.projectReads).toEqual([]);
  });

  it('MissedLevel_ClaimedInTurn_StaysFalse', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.openS1();

    for (const event of [
      { type: 'turnStarted', at: 1 },
      skill('wigley:feature', ''),
      USAGE,
      { type: 'turnEnded', at: 1 },
    ] satisfies AgentEvent[]) {
      await workflow.agentEvent(event);
    }

    expect(workflow.lastFlow()).toMatchObject({
      missedLevel: false,
      workflow: HEAVY_WORKFLOW_ID,
    });
  });

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
      act: (
        { engine, heavy }: ReturnType<typeof startPartsInHarnesses>,
        _project: ReturnType<typeof holdableReads>,
      ) => reachPlanReady(engine, heavy.files),
      liveTimers: 1,
    },
    {
      state: 'a plan read held open',
      replacesFiles: true,
      act: async (
        { engine }: ReturnType<typeof startPartsInHarnesses>,
        project: ReturnType<typeof holdableReads>,
      ) => {
        await reachPlanReady(engine, project.files);
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
      const parts = startPartsInHarnesses(
        { ...SETTINGS, autoClearAndMake: true },
        replacesFiles ? { files: project.files } : {},
      );
      const { engine, heavy } = parts;
      await act(parts, project);
      expect(heavy.counts().timers).toBe(liveTimers);
      expect(heavy.counts().registrations).toBeGreaterThan(0);
      const savedAtStop = await readIfPresent(engine.files, FLOWS_PATH);

      await heavy.stop();
      project.release();
      await settled();

      expect(heavy.counts()).toEqual(noCounts);
      expect(await readIfPresent(engine.files, FLOWS_PATH)).toBe(savedAtStop);
      await engine.stop();
    },
  );

  it('stopThenStart_StartsAgain', async () => {
    const { engine, heavy } = startPartsInHarnesses(SETTINGS);

    await heavy.restart();

    await expect(
      heavy.invoke('runAction', { sessionId: 'none', command: 'dismiss' }),
    ).rejects.toThrow('No workflow flow for session none');
    await heavy.stop();
    expect(heavy.counts()).toEqual(noCounts);
    await engine.stop();
  });
});
