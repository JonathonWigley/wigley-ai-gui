import { describe, expect, it } from 'vitest';
import type { ActiveTime } from '../../../contracts/active-time';
import type { AgentEvent, UsageAgentEvent } from '../../../contracts/agent';
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
import {
  type ChatMainEvents,
  type ChatMainExports,
  chatMainKey,
} from '../../chat/contract';
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
  type ChecklistItem,
  type FoldEvent,
  type MainStage,
  type MainWorkflow,
  type SessionFlow,
  startsSkill,
  type WorkflowMainExports,
  type WorkflowSignal,
} from '../contract';
import { newFlow } from '../flow';
import type { workflowManifest } from '../manifest';
import { readPlanProgress } from '../plan-reader';
import {
  HEAVY_WORKFLOW_ID,
  heavySignal,
  type HeavyState,
  heavyStateOf,
} from '../stages/heavy-contract';
import { SET_WORKFLOW_CHECKLIST_TOOL } from './checklist-tool';
import { FLOWS_FILE } from './flow-store';
import { RUNS_FILE, type RunLogLine } from './run-log';
import { SESSION_NOTE } from './session-note';
import { workflowMainPart } from './start';
import { SET_WORKFLOW_STEP_TOOL } from './step-tool';

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

// Workflow's main part started over a fake `MainApi`: memory files for its
// data and for the project (`project`), hand-moved time, and a chat fake that
// records each `clear` and `send`. `silentWatch` gives the project files a
// watch that reports nothing, as an OS watcher that misses a delete;
// `sessionLabel` is the side-bar label sessions gives s1 (none by default);
// `data` is workflow's data folder as the last run left it; `selfTest` starts the
// part with the self-test on, its script never run, so its hooks are exported.
// `setActiveTime` sets the clock chat's fake reports for every session.
function startWorkflowPart(
  settings: WorkflowTestSettings,
  options: {
    silentWatch?: boolean;
    sessionLabel?: string;
    data?: MemoryFiles;
    selfTest?: boolean;
  } = {},
) {
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const sent: SessionFlow[][] = [];
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
  const instructions: string[] = [];
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
    addInstructions: (text) => {
      instructions.push(text);
      return { dispose: () => undefined };
    },
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
      log: (line: string) => logs.push(line),
      clock: time.clock,
      timers: time.timers,
      paths: posixPaths,
      selfTest: options.selfTest === true ? { run: () => undefined } : null,
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
  const lastFlow = () => sent.at(-1)?.find((flow) => flow.sessionId === 's1');
  // The last flow with its Heavy state's fields beside its own.
  const lastHeavy = () => {
    const flow = lastFlow();
    return flow === undefined ? undefined : { ...flow, ...heavyStateOf(flow) };
  };
  const exported = () =>
    part.exports?.(createRegistrations()) as WorkflowMainExports;
  const savedAt = async () => {
    await settled();
    const saved = JSON.parse(await data.read(FLOWS_FILE)) as {
      flows: { savedAt: number }[];
    };
    return saved.flows[0].savedAt;
  };
  const changeSettings = async (next: WorkflowTestSettings) => {
    settingsListener(next);
    await settled();
  };
  // A call of the live contribution of tool `name` from session `id`.
  const callTool = async (name: string, id: string, args: unknown) => {
    const contribution = contributions.find(({ tools }) =>
      tools.some((tool) => tool.name === name),
    );
    if (contribution === undefined) {
      throw new Error(`no contribution of ${name}`);
    }
    const pending = contribution
      .start(session(id, 'h1'))
      .call(name, args, NO_CALL_CONTEXT);
    await settled();
    return pending;
  };
  return {
    data,
    project,
    time,
    setActiveTime: (next: ActiveTime) => {
      activeTime = next;
    },
    sent,
    logs,
    chatCalls,
    emit,
    agentEvent,
    replayBurst,
    openS1,
    lastFlow,
    lastHeavy,
    exported,
    savedAt,
    changeSettings,
    runAction: (command: string) =>
      handlers.get('runAction')?.({ sessionId: 's1', command }),
    instructions,
    contributions,
    callStepTool: (id: string, step: string) =>
      callTool(SET_WORKFLOW_STEP_TOOL, id, { step }),
    callChecklistTool: (id: string, items: unknown) =>
      callTool(SET_WORKFLOW_CHECKLIST_TOOL, id, { items }),
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

// Chat for the harness's parts: every instruction taken and disposable.
const FAKE_CHAT = fakeDependency(
  chatMainKey,
  (consumer) =>
    ({
      addInstructions: () => consumer.track({ dispose: () => undefined }),
      activeTime: () => null,
    }) as unknown as ChatMainExports,
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

type FlowFields = Partial<SessionFlow & HeavyState>;

// Workflow's data folder holding a Heavy flow of `fields` as s1's saved flow under
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

// The part with stub workflows that both take `build`, only Medium `review`.
function startLightAndMedium(options: { data?: MemoryFiles } = {}) {
  const reported = (id: string): MainStage => ({
    id,
    order: 0,
    reportedAs: id,
    enter: (_flow, signal) =>
      signal.type === 'stepReported' && signal.step === id ? id : null,
  });
  const workflow = startWorkflowPart(SETTINGS, options);
  workflow.exported().addWorkflow(
    stubWorkflow({
      id: 'light',
      claims: (signal) => startsSkill(signal, 'x:light'),
      firstStage: 'build',
      stages: [reported('build')],
    }),
  );
  workflow.exported().addWorkflow(
    stubWorkflow({
      id: 'medium',
      order: 20,
      claims: (signal) => startsSkill(signal, 'x:medium'),
      firstStage: 'build',
      stages: [reported('build'), reported('review')],
    }),
  );
  return workflow;
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

const FINISH: WorkflowSignal = { type: 'stepReported', step: 'done' };

// A workflow that claims `x:stub` and finishes on `FINISH`, or on a turn's end.
function finishingWorkflow(fields: Partial<MainWorkflow> = {}): MainWorkflow {
  return stubWorkflow({
    stages: [
      {
        id: 'done',
        order: 0,
        finishes: true,
        enter: (_flow, signal) =>
          signal.type === 'turnEnded' ||
          (signal.type === 'stepReported' && signal.step === 'done')
            ? 'done'
            : null,
      },
    ],
    ...fields,
  });
}

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

// The two ways a session's flow goes.
const FLOW_ENDS: {
  name: string;
  end: (workflow: ReturnType<typeof startWorkflowPart>) => Promise<void>;
}[] = [
  {
    name: 'sessions.ended',
    end: (workflow) => workflow.emit('sessions.ended', { sessionId: 's1' }),
  },
  {
    name: 'forgetFlows',
    end: async (workflow) => {
      workflow.exported().selfTestHooks?.forgetFlows('/r');
    },
  },
];

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
      expect(workflow.lastHeavy()).toMatchObject({
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
      progress: readPlanProgress(PLAN),
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

  it.each<{
    name: string;
    skill: string | null;
    opens: boolean;
    step: string;
    text: string;
    stage: string | undefined;
  }>([
    {
      name: 'light at build',
      skill: 'x:light',
      opens: true,
      step: 'review',
      text: 'Ignored review: this session is not at a place in the workflow that takes it.',
      stage: 'build',
    },
    {
      name: 'medium at build',
      skill: 'x:medium',
      opens: true,
      step: 'review',
      text: 'Step set to review.',
      stage: 'review',
    },
    {
      name: 'a new flow',
      skill: null,
      opens: true,
      step: 'build',
      text: 'Ignored build: this session is not at a place in the workflow that takes it.',
      stage: 'idle',
    },
    {
      name: 'no flow',
      skill: null,
      opens: false,
      step: 'build',
      text: 'Ignored build: this session is not at a place in the workflow that takes it.',
      stage: undefined,
    },
  ])(
    'StepTool_ScopedToTheFlowsWorkflow ($name)',
    async ({ skill: skillName, opens, step, text, stage }) => {
      const workflow = startLightAndMedium();
      if (opens) {
        await workflow.openS1();
      }
      if (skillName !== null) {
        await workflow.agentEvent(skill(skillName, ''));
      }

      const result = await workflow.callStepTool('s1', step);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe(text);
      expect(workflow.exported().flowOf('s1')?.stage).toBe(stage);
    },
  );

  it('StepTool_NotInTheUnion_ListsIt', async () => {
    const workflow = startLightAndMedium();
    await workflow.openS1();
    await workflow.agentEvent(skill('x:medium', ''));

    const result = await workflow.callStepTool('s1', 'nope');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Unknown step. Use one of: build, review, explore, interview, plan, cold_read, fix.',
    );
    expect(workflow.lastFlow()?.stage).toBe('build');
  });

  it.each<{
    name: string;
    data?: () => Promise<MemoryFiles>;
    opens: boolean;
    skill: string | null;
    text: string;
    pushes: number;
    checklist: ChecklistItem[] | null;
  }>([
    {
      name: 'a Light flow',
      opens: true,
      skill: 'x:light',
      text: 'Checklist set: 0 of 1 done.',
      pushes: 1,
      checklist: [{ text: 'a', done: false }],
    },
    {
      name: 'a new flow',
      opens: true,
      skill: null,
      text: 'Ignored the checklist: this session has no workflow yet.',
      pushes: 0,
      checklist: null,
    },
    {
      name: 'no flow',
      opens: false,
      skill: null,
      text: 'Ignored the checklist: this session has no workflow yet.',
      pushes: 0,
      checklist: null,
    },
    {
      name: 'a workflow no plugin holds',
      data: () => savedFlowData({ workflow: 'gone', stage: 'somewhere' }),
      opens: true,
      skill: null,
      text: 'Ignored the checklist: this session has no workflow yet.',
      pushes: 0,
      checklist: null,
    },
  ])(
    'ChecklistTool_Flow ($name)',
    async ({ data, opens, skill: skillName, text, pushes, checklist }) => {
      const workflow = startLightAndMedium({ data: await data?.() });
      if (opens) {
        await workflow.openS1();
      }
      if (skillName !== null) {
        await workflow.agentEvent(skill(skillName, ''));
      }
      await settled();
      const sentBefore = workflow.sent.length;

      const result = await workflow.callChecklistTool('s1', [
        { text: 'a', done: false },
      ]);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe(text);
      expect(workflow.sent).toHaveLength(sentBefore + pushes);
      expect(workflow.lastFlow()?.checklist ?? null).toEqual(checklist);
    },
  );

  it('ChecklistTool_Report_StampsTheSave', async () => {
    const workflow = startLightAndMedium();
    await workflow.openS1();
    await workflow.agentEvent(skill('x:light', ''));
    workflow.time.advance(5);

    await workflow.callChecklistTool('s1', [{ text: 'a', done: false }]);

    expect(await workflow.savedAt()).toBe(START + 5);
  });

  it('Start_AddsTheSessionNote', () => {
    const workflow = startWorkflowPart(SETTINGS);

    expect(workflow.instructions).toEqual([SESSION_NOTE]);
  });

  it('SessionNote_NamesBothTools', () => {
    expect(SESSION_NOTE).toContain('set_workflow_step');
    expect(SESSION_NOTE).toContain('set_workflow_checklist');
    expect(SESSION_NOTE).toContain('only where your running skill names it');
  });

  it('Start_ContributesBothTools', () => {
    const workflow = startWorkflowPart(SETTINGS);

    expect(
      workflow.contributions.flatMap(({ tools }) => tools.map((t) => t.name)),
    ).toEqual(
      expect.arrayContaining([
        SET_WORKFLOW_STEP_TOOL,
        SET_WORKFLOW_CHECKLIST_TOOL,
      ]),
    );
  });

  it('stepTool_StageAddedByAPlugin_JoinsTheToolUntilDisposed', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    const stepsOffered = () => {
      const definition = workflow.contributions
        .flatMap(({ tools }) => tools)
        .find((tool) => tool.name === SET_WORKFLOW_STEP_TOOL) as ToolDefinition;
      return (
        definition.inputSchema as {
          properties: { step: { enum: string[] } };
        }
      ).properties.step.enum;
    };
    const contributionsAtStart = workflow.contributions.length;
    expect(stepsOffered()).not.toContain('extra');

    const added = workflow.exported().addWorkflow(
      stubWorkflow({
        stages: [
          {
            id: 'extra',
            order: 23,
            reportedAs: 'extra',
            enter: (_flow, signal) =>
              signal.type === 'stepReported' && signal.step === 'extra'
                ? 'extra'
                : null,
          },
        ],
      }),
    );

    expect(workflow.contributions).toHaveLength(contributionsAtStart);
    expect(stepsOffered()).toContain('extra');
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
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
        dependencies: [FAKE_SESSIONS, FAKE_CHAT],
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
      dependencies: [FAKE_SESSIONS, FAKE_CHAT],
    });

    await harness.restart();

    expect(await harness.invoke('flows')).toEqual([]);
  });

  it('exports_ConsumerDisposed_FreesTheWorkflowId', () => {
    const harness = startMainPart(workflowMainPart, {
      dependencies: [FAKE_SESSIONS, FAKE_CHAT],
    });
    const exportsFor = (consumer: ReturnType<typeof createRegistrations>) =>
      harness.started().exports?.(consumer) as WorkflowMainExports;
    const consumerA = createRegistrations();
    exportsFor(consumerA).addWorkflow(stubWorkflow());

    consumerA.dispose();

    expect(() =>
      exportsFor(createRegistrations()).addWorkflow(stubWorkflow()),
    ).not.toThrow();
  });

  it('addWorkflow_StagesOutOfOrder_AsksThemByOrderWithTiesInArrayOrder', async () => {
    const answers = (id: string, order: number) => ({
      id,
      order,
      enter: () => id,
    });
    const workflow = startWorkflowPart(SETTINGS);
    workflow.exported().addWorkflow(
      stubWorkflow({
        stages: [
          answers('late', 20),
          answers('tied', 10),
          answers('tied2', 10),
        ],
      }),
    );
    await workflow.openS1();

    await workflow.agentEvent(skill('x:stub', ''));

    expect(workflow.lastFlow()?.stage).toBe('tied');
  });

  it.each<{
    name: string;
    events: AgentEvent[];
    replayed: boolean;
    missedLevel: boolean;
    workflow: string | null;
  }>([
    {
      name: 'MissedLevel_LiveTurnWithWork_SetsAndPushes',
      events: [
        { type: 'turnStarted', at: 1 },
        USAGE,
        { type: 'turnEnded', at: 1 },
      ],
      replayed: false,
      missedLevel: true,
      workflow: null,
    },
    {
      name: 'MissedLevel_LiveTurnWithNoWork_StaysFalse',
      events: [
        { type: 'turnStarted', at: 1 },
        { type: 'turnEnded', at: 1 },
      ],
      replayed: false,
      missedLevel: false,
      workflow: null,
    },
    {
      name: 'MissedLevel_ReplayedTurn_StaysFalse',
      events: [
        { type: 'turnStarted', at: 1 },
        USAGE,
        { type: 'turnEnded', at: 1 },
      ],
      replayed: true,
      missedLevel: false,
      workflow: null,
    },
    {
      name: 'MissedLevel_ClaimedInTurn_StaysFalse',
      events: [
        { type: 'turnStarted', at: 1 },
        skill('wigley:feature', ''),
        USAGE,
        { type: 'turnEnded', at: 1 },
      ],
      replayed: false,
      missedLevel: false,
      workflow: HEAVY_WORKFLOW_ID,
    },
    {
      name: 'MissedLevel_SessionEnded_Sets',
      events: [
        { type: 'turnStarted', at: 1 },
        USAGE,
        { type: 'sessionEnded', at: 1 },
      ],
      replayed: false,
      missedLevel: true,
      workflow: null,
    },
  ])(
    '$name',
    async ({ events, replayed, missedLevel, workflow: workflowId }) => {
      const workflow = startWorkflowPart(SETTINGS);
      await workflow.openS1();

      for (const event of events) {
        await workflow.agentEvent(event, 'h1', replayed);
      }

      expect(workflow.lastFlow()).toMatchObject({
        missedLevel,
        workflow: workflowId,
      });
    },
  );

  it.each(FLOW_ENDS)('TurnWork_ForgottenOnEnd ($name)', async ({ end }) => {
    const workflow = startWorkflowPart(SETTINGS, { selfTest: true });
    await workflow.openS1();
    await workflow.agentEvent({ type: 'turnStarted', at: 1 });
    await workflow.agentEvent(USAGE);

    await end(workflow);
    await workflow.openS1();
    await workflow.agentEvent({ type: 'turnEnded', at: 1 });

    expect(workflow.lastFlow()?.missedLevel).toBe(false);
  });

  it.each<{
    name: string;
    event: AgentEvent;
    replayed: boolean;
    origin: string;
    whole: boolean;
    changes: boolean;
  }>([
    {
      name: 'a live signal that changes nothing',
      event: { type: 'turnEnded', at: AFTER_SAVE },
      replayed: false,
      origin: 'live',
      whole: true,
      changes: false,
    },
    {
      name: 'a replayed event past the save',
      event: { type: 'turnStarted', at: AFTER_SAVE },
      replayed: true,
      origin: 'replay',
      whole: true,
      changes: true,
    },
    {
      name: 'a replayed event at the save',
      event: { type: 'turnStarted', at: SAVED_AT },
      replayed: true,
      origin: 'replay',
      whole: false,
      changes: true,
    },
    {
      name: 'a replayed turn end at the save over a flow with no turn',
      event: { type: 'turnEnded', at: SAVED_AT },
      replayed: true,
      origin: 'replay',
      whole: false,
      changes: false,
    },
  ])(
    'Observer_Folded ($name)',
    async ({ event, replayed, origin, whole, changes }) => {
      const data = await savedFlowData({ stage: 'make' });
      const workflow = startWorkflowPart(SETTINGS, { data });
      const folded: FoldEvent[] = [];
      workflow.exported().observe({
        folded: (fold) => folded.push(fold),
        opened: () => undefined,
        closed: () => undefined,
        replaying: () => undefined,
      });
      await workflow.openS1();

      await workflow.agentEvent(event, 'h1', replayed);

      expect(folded).toHaveLength(1);
      expect(folded[0]).toMatchObject({ sessionId: 's1', origin, whole });
      expect(folded[0].after === folded[0].before).toBe(!changes);
    },
  );

  it('Observer_Members', async () => {
    const workflow = startWorkflowPart(SETTINGS, { selfTest: true });
    const calls: unknown[] = [];
    workflow.exported().observe({
      folded: ({ whole }) => calls.push(['folded', whole]),
      opened: (flow) => calls.push(['opened', flow.sessionId]),
      closed: (sessionId) => calls.push(['closed', sessionId]),
      replaying: (sessionId) => calls.push(['replaying', sessionId]),
    });

    await workflow.openS1();
    await workflow.agentEvent({ type: 'turnStarted', at: 1 }, 'h1', true);
    await workflow.emit('sessions.ended', { sessionId: 's1' });
    await workflow.openS1();
    workflow.exported().selfTestHooks?.forgetFlows('/r');

    expect(calls).toEqual([
      ['opened', 's1'],
      ['replaying', 's1'],
      ['folded', true],
      ['closed', 's1'],
      ['opened', 's1'],
      ['closed', 's1'],
    ]);
  });

  it('Observer_Disposed_HearsNothing', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    const opened: string[] = [];
    const observer = workflow.exported().observe({
      folded: () => undefined,
      opened: (flow) => opened.push(flow.sessionId),
      closed: () => undefined,
      replaying: () => undefined,
    });

    observer.dispose();
    await workflow.openS1();

    expect(opened).toEqual([]);
  });

  it('Exports_SetState_KeepsSavedAtAndSends', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    const folded: FoldEvent[] = [];
    workflow.exported().observe({
      folded: (fold) => folded.push(fold),
      opened: () => undefined,
      closed: () => undefined,
      replaying: () => undefined,
    });
    await workflow.openS1();
    workflow.exported().signal('s1', { type: 'turnStarted' }, 'live');
    const savedBefore = await workflow.savedAt();
    folded.length = 0;
    const sentBefore = workflow.sent.length;
    workflow.time.advance(5);

    workflow.exported().setState('s1', { n: 1 });

    expect(workflow.exported().flowOf('s1')?.state).toEqual({ n: 1 });
    expect(await workflow.savedAt()).toBe(savedBefore);
    expect(workflow.sent).toHaveLength(sentBefore + 1);
    expect(folded).toEqual([]);
  });

  it('Exports_SetState_NoFlowOrUndefined', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.openS1();

    workflow.exported().setState('s-none', { n: 1 });
    workflow.exported().setState('s1', undefined);

    expect(workflow.exported().flowOf('s-none')).toBeNull();
    expect(workflow.exported().flowOf('s1')?.state).toBeNull();
  });

  it.each<{ origin: 'live' | 'observed'; stamped: boolean }>([
    { origin: 'observed', stamped: false },
    { origin: 'live', stamped: true },
  ])('Exports_Signal_StampsOnlyLive ($origin)', async ({ origin, stamped }) => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.openS1();
    const signal: WorkflowSignal = { type: 'turnStarted' };
    const savedBefore = await workflow.savedAt();
    workflow.time.advance(5);

    workflow.exported().signal('s1', signal, origin);

    expect(await workflow.savedAt()).toBe(stamped ? START + 5 : savedBefore);
  });

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
    const workflow = startLightAndMedium();
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

  it('RunLog_SpendAfterTheStep', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    await workflow.agentEvent(spent(1));

    workflow.exported().signal('s1', FINISH, 'live');
    await workflow.agentEvent(spent(2));

    expect(await runLogLines(workflow)).toMatchObject([{ costUsd: 1 }]);
  });

  it('RunMeter_BaselineAtClaim', async () => {
    const workflow = startLightAndMedium();
    workflow.exported().addWorkflow(
      finishingWorkflow({
        order: 30,
        claims: (signal) => startsSkill(signal, 'x:medium-up'),
      }),
    );
    await workflow.openS1();
    workflow.setActiveTime(activeFor(3000));
    await workflow.agentEvent(spent(1));
    await workflow.agentEvent(skill('x:light', ''));
    workflow.setActiveTime(activeFor(4000));
    await workflow.agentEvent(skill('x:medium-up', ''));
    workflow.setActiveTime(activeFor(5000));
    await workflow.agentEvent(spent(2));

    workflow.exported().signal('s1', FINISH, 'live');

    expect(await runLogLines(workflow)).toMatchObject([
      { activeMs: 2000, costUsd: 1, movedUpFrom: 'light' },
    ]);
  });

  it('RunMeter_NoteKeepsTheLargest', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    workflow.setActiveTime(activeFor(4000));
    await workflow.agentEvent(spent(1));
    workflow.setActiveTime(activeFor(0));
    await workflow.agentEvent({ type: 'turnStarted', at: 1 });
    await workflow.emit('sessions.hostSessionChanged', session('s1', 'h2'));
    workflow.setActiveTime(activeFor(1500));
    await workflow.agentEvent(spent(1), 'h2');

    workflow.exported().signal('s1', FINISH, 'live');

    expect(await runLogLines(workflow)).toMatchObject([{ activeMs: 5500 }]);
  });

  it('RunLog_StubWorkflowWithNoFixCycles', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));

    workflow.exported().signal('s1', FINISH, 'live');

    expect(await runLogLines(workflow)).toEqual([
      {
        at: START,
        sessionId: 's1',
        projectDir: '/r',
        workflow: 'stub',
        movedUpFrom: null,
        activeMs: 0,
        costUsd: null,
        fixCycles: 0,
      },
    ]);
  });

  it('RunLog_NoFinishesStage_NoLine', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    await workflow.project.write(PLAN_FILE, PLAN);
    await workflow.openS1();

    await workflow.agentEvent(skill('wigley:make', PLAN_DIR));

    expect(workflow.lastFlow()?.stage).toBe('make');
    expect(await runLines(workflow)).toEqual([]);
  });

  it('RunLog_OpenSpan_CountsUpToTheClock', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    workflow.setActiveTime({ totalMs: 1000, since: START });
    workflow.time.advance(500);

    workflow.exported().signal('s1', FINISH, 'live');

    expect(await runLogLines(workflow)).toMatchObject([{ activeMs: 1500 }]);
  });

  it.each([
    { name: 'past the save', at: AFTER_SAVE, lines: 1 },
    { name: 'at the save', at: SAVED_AT, lines: 0 },
  ])('RunLog_Replay_WritesOnlyPastTheSave ($name)', async ({ at, lines }) => {
    const data = await savedFlowData({ workflow: 'stub', stage: 'scope' });
    const workflow = startWorkflowPart(SETTINGS, { data });
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();

    await workflow.replayBurst([{ type: 'turnEnded', at }]);

    expect(await runLines(workflow)).toHaveLength(lines);
  });

  it('RunMeter_ReplayedSpend_Counts', async () => {
    const workflow = startWorkflowPart(SETTINGS);
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    await workflow.agentEvent(spent(1), 'h1', true);

    workflow.exported().signal('s1', FINISH, 'live');

    expect(await runLogLines(workflow)).toMatchObject([{ costUsd: 1 }]);
  });

  it.each(FLOW_ENDS)('RunMeter_ForgottenOnEnd ($name)', async ({ end }) => {
    const workflow = startWorkflowPart(SETTINGS, { selfTest: true });
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();
    await workflow.agentEvent(spent(1));

    await end(workflow);
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    workflow.exported().signal('s1', FINISH, 'live');

    expect(await runLogLines(workflow)).toMatchObject([{ costUsd: null }]);
  });
});
