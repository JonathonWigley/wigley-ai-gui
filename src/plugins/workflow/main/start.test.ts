import { describe, expect, it } from 'vitest';
import type { ActiveTime } from '../../../contracts/active-time';
import type { AgentEvent, UsageAgentEvent } from '../../../contracts/agent';
import { readIfPresent } from '../../../contracts/files';
import type { QualifiedEvents } from '../../../contracts/plugin';
import type { KeyedSlotKey } from '../../../contracts/state';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  noCounts,
  type MainPartHarness,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type ChatMainEvents,
  type ChatMainExports,
  type ChatSessionInfo,
  chatSessionSlot,
  HEADLESS_NOTE,
  HEADLESS_OFF_NOTE,
} from '../../chat/contract';
import {
  type AgentSession,
  type ContributeToolsOptions,
  type SessionsMainEvents,
  type SessionsMainExports,
  type ToolCallContext,
  type ToolDefinition,
  type SessionRow,
  sessionsRowsSlot,
  type ToolSession,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import {
  type ChecklistItem,
  type FoldEvent,
  type MainStage,
  type MainWorkflow,
  type SessionFlow,
  startsSkill,
  workflowFlowsSlot,
  type WorkflowMainExports,
  type WorkflowSignal,
} from '../contract';
import { newFlow } from '../flow';
import type { workflowManifest } from '../manifest';
import { SET_WORKFLOW_CHECKLIST_TOOL } from './checklist-tool';
import { startEngineMainPart } from './engine-fakes.test-support';
import { FLOWS_FILE } from './flow-store';
import { RUNS_FILE, type RunLogLine } from './run-log';
import { SESSION_NOTE } from './session-note';
import { workflowMainPart } from './start';
import { SET_WORKFLOW_STEP_TOOL } from './step-tool';

const START = 1_000_000;

// The events workflow's main part hears.
type WorkflowHeard = QualifiedEvents<'chat', ChatMainEvents> &
  QualifiedEvents<'sessions', SessionsMainEvents>;

const FLOWS_PATH = `/data/workflow/${FLOWS_FILE}`;

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
      harness: null,
      rowId: null,
    },
  };
}

// Workflow's main part started over a fake `MainApi`: memory files for its
// data, hand-moved time, fakes of chat and sessions, and a real store for its slot:
// `sent` holds each flow the slot's notices carry. `data` is workflow's data folder
// as the last run left it; `selfTest` starts the part with the self-test on, so its
// hooks are exported.
// `setActiveTime` sets the clock chat's fake reports for every session.
function startWorkflowPart(
  options: {
    data?: MemoryFiles;
    selfTest?: boolean;
  } = {},
) {
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const sent: SessionFlow[] = [];
  const store = createSlotStore(() => undefined);
  const slot = store.read(workflowFlowsSlot, 'test');
  slot.on((_sessionId, flow) => {
    if (flow !== undefined) {
      sent.push(flow);
    }
  });
  const data = options.data ?? createMemoryFiles();
  const time = handTime();
  const instructions: string[] = [];
  let activeTime: ActiveTime | null = null;
  let headless = false;
  let launchedHeadless = false;
  const chat: Pick<
    ChatMainExports,
    'activeTime' | 'addInstructions' | 'isHeadless' | 'launchedHeadless'
  > = {
    activeTime: () => activeTime,
    isHeadless: () => headless,
    launchedHeadless: () => launchedHeadless,
    addInstructions: (text) => {
      instructions.push(text);
      return { dispose: () => undefined };
    },
  };
  const contributions: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
    options: ContributeToolsOptions | undefined;
  }[] = [];
  const sessions: Pick<SessionsMainExports, 'contributeTools'> = {
    contributeTools: (tools, start, options) => {
      const contribution = { tools, start, options };
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
    state: {
      publish: () => store.publish(workflowFlowsSlot),
      read: (key: KeyedSlotKey<unknown>) => store.read(key, 'workflow'),
    },
    events: {
      emit: () => undefined,
      on: (event: string, listener: (data: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    settings: () => ({}),
    onSettingsChanged: () => ({ dispose: () => undefined }),
    services: {
      files: createMemoryFiles(),
      log: () => undefined,
      clock: time.clock,
      timers: time.timers,
      paths: posixPaths,
      selfTest: options.selfTest === true ? { run: () => undefined } : null,
    },
    dependency: (key: { id: string }) => dependencies[key.id] ?? {},
    data,
    drive: null,
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
  // Chat's open alone, as for a session chat adopts across its restart.
  const openS1 = async () => {
    await emit('chat.sessionOpened', {
      sessionId: 's1',
      profileDir: '~/.c',
      hostSessionId: 'h1',
      projectDir: '/r',
      profile: 'personal',
      origin: 'new',
    });
  };
  const lastFlow = () => slot.get('s1');
  const exported = () =>
    part.exports?.(createRegistrations()) as WorkflowMainExports;
  const savedAt = async () => {
    await settled();
    const saved = JSON.parse(await data.read(FLOWS_FILE)) as {
      flows: { savedAt: number }[];
    };
    return saved.flows[0].savedAt;
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
    time,
    dispose: async () => part.dispose?.('end'),
    setActiveTime: (next: ActiveTime) => {
      activeTime = next;
    },
    setHeadless: (next: boolean) => {
      headless = next;
    },
    setLaunchedHeadless: (next: boolean) => {
      launchedHeadless = next;
    },
    sent,
    emit,
    agentEvent,
    replayBurst,
    openS1,
    lastFlow,
    exported,
    savedAt,
    instructions,
    contributions,
    callStepTool: (id: string, step: string) =>
      callTool(SET_WORKFLOW_STEP_TOOL, id, { step }),
    callChecklistTool: (id: string, items: unknown) =>
      callTool(SET_WORKFLOW_CHECKLIST_TOOL, id, { items }),
  };
}

// Chat's state for session `sessionId`, held under `profile`.
function chatHeld(sessionId: string, profile: string): ChatSessionInfo {
  return {
    sessionId,
    projectDir: '/p',
    harness: 'fake',
    profile,
    activity: 'idle',
    background: 0,
    activeTime: { totalMs: 0, since: null },
    running: true,
    pid: null,
    compaction: null,
    repo: 'p',
    branch: null,
    worktrees: [],
    headless: false,
  };
}

// The events that open s1 under h1, as sessions and chat emit them.
function emitOpenS1(harness: MainPartHarness<typeof workflowManifest>) {
  harness.emit('sessions.connected', {
    ...session('s1', 'h1'),
    owned: true,
  });
  harness.emit('chat.sessionOpened', {
    sessionId: 's1',
    profileDir: '~/.c',
    hostSessionId: 'h1',
    projectDir: '/p',
    profile: 'personal',
    origin: 'new',
  });
}

const NO_CALL_CONTEXT: ToolCallContext = {
  toolUseId: null,
  signal: new AbortController().signal,
};

function skill(name: string, args: string): AgentEvent {
  return { type: 'skillStarted', at: 1, agentId: 'main', skill: name, args };
}

const SAVED_AT = START - 1_000;
const AFTER_SAVE = START - 500;

// Workflow's data folder holding a flow of `fields` as s1's saved flow under h1.
async function savedFlowData(
  fields: Partial<SessionFlow>,
): Promise<MemoryFiles> {
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
            workflow: 'stub',
            ...fields,
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

// The part with stub workflows that both take `build` under one stage id and
// `ship` under their own, only Medium `review`.
function startSmallAndMedium(options: { data?: MemoryFiles } = {}) {
  const reported = (id: string, reportedAs = id): MainStage => ({
    id,
    order: 0,
    reportedAs,
    enter: (_flow, signal) =>
      signal.type === 'stepReported' && signal.step === id ? id : null,
  });
  const workflow = startWorkflowPart(options);
  workflow.exported().addWorkflow(
    stubWorkflow({
      id: 'small',
      claims: (signal) => startsSkill(signal, 'x:small'),
      firstStage: 'build',
      stages: [reported('build'), reported('ship-small', 'ship')],
    }),
  );
  workflow.exported().addWorkflow(
    stubWorkflow({
      id: 'medium',
      order: 20,
      claims: (signal) => startsSkill(signal, 'x:medium'),
      firstStage: 'build',
      stages: [
        reported('build'),
        reported('ship-medium', 'ship'),
        reported('review'),
      ],
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

// A clear in a list of agent events: the host session changes.
const CLEARED = 'cleared';

const activeFor = (totalMs: number): ActiveTime => ({ totalMs, since: null });

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

describe('workflowMainPart', () => {
  it('oneFlowChange_NotifiesOneKey', async () => {
    const workflow = startWorkflowPart();
    await workflow.openS1();
    for (const id of ['s2', 's3']) {
      await workflow.emit('chat.sessionOpened', {
        sessionId: id,
        profileDir: '~/.c',
        hostSessionId: `h-${id}`,
        projectDir: '/r',
        profile: 'personal',
        origin: 'new',
      });
    }
    workflow.sent.length = 0;

    await workflow.agentEvent({ type: 'turnStarted', at: 1 });

    expect(workflow.sent.map(({ sessionId }) => sessionId)).toEqual(['s1']);
  });

  it('sessionEnded_EndsTheTurnOnlyFromTheCurrentHost', async () => {
    const workflow = startWorkflowPart();
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

  it.each<{
    name: string;
    skill: string | null;
    opens: boolean;
    step: string;
    text: string;
    stage: string | undefined;
  }>([
    {
      name: 'small at build',
      skill: 'x:small',
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
      name: "the later workflow's own stage of a shared report",
      skill: 'x:medium',
      opens: true,
      step: 'ship',
      text: 'Step set to ship.',
      stage: 'ship-medium',
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
      const workflow = startSmallAndMedium();
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
    const workflow = startSmallAndMedium();
    await workflow.openS1();
    await workflow.agentEvent(skill('x:medium', ''));

    const result = await workflow.callStepTool('s1', 'nope');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Unknown step. Use one of: build, ship, review.',
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
      name: 'a Small flow',
      opens: true,
      skill: 'x:small',
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
      const workflow = startSmallAndMedium({ data: await data?.() });
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
    const workflow = startSmallAndMedium();
    await workflow.openS1();
    await workflow.agentEvent(skill('x:small', ''));
    workflow.time.advance(5);

    await workflow.callChecklistTool('s1', [{ text: 'a', done: false }]);

    expect(await workflow.savedAt()).toBe(START + 5);
  });

  it('Tools_LaunchedHeadlessTurnedOffBeforeTheFirstCall_OffNoteOnTheFirstResult', async () => {
    const workflow = startSmallAndMedium();
    workflow.setLaunchedHeadless(true);
    await workflow.openS1();
    await workflow.agentEvent(skill('x:small', ''));

    const results = [
      await workflow.callStepTool('s1', 'build'),
      await workflow.callChecklistTool('s1', [{ text: 'a', done: false }]),
    ];

    expect(results.map((result) => result.content[0].text)).toEqual([
      `Step set to build.\n${HEADLESS_OFF_NOTE}`,
      'Checklist set: 0 of 1 done.',
    ]);
  });

  it('Tools_HeadlessTurnsOff_OffNoteOnTheFirstResultOfEitherTool', async () => {
    const workflow = startSmallAndMedium();
    await workflow.openS1();
    await workflow.agentEvent(skill('x:small', ''));
    workflow.setHeadless(true);
    const whileOn = await workflow.callStepTool('s1', 'build');
    workflow.setHeadless(false);

    const results = [
      await workflow.callChecklistTool('s1', [{ text: 'a', done: false }]),
      await workflow.callStepTool('s1', 'build'),
      await workflow.callChecklistTool('s1', [{ text: 'a', done: false }]),
    ];

    expect(whileOn.content[0].text).toContain(HEADLESS_NOTE);
    expect(results.map((result) => result.content[0].text)).toEqual([
      `Checklist set: 0 of 1 done.\n${HEADLESS_OFF_NOTE}`,
      'Step set to build.',
      'Checklist set: 0 of 1 done.',
    ]);
  });

  it('Start_AddsTheSessionNote', () => {
    const workflow = startWorkflowPart();

    expect(workflow.instructions).toEqual([SESSION_NOTE]);
  });

  it('Start_ContributesBothTools', () => {
    const workflow = startSmallAndMedium();

    expect(
      workflow.contributions.map(({ tools, options }) => ({
        tools: tools.map((t) => t.name),
        options,
      })),
    ).toEqual(
      expect.arrayContaining([
        { tools: [SET_WORKFLOW_STEP_TOOL], options: { mainAgentOnly: true } },
        {
          tools: [SET_WORKFLOW_CHECKLIST_TOOL],
          options: { mainAgentOnly: true },
        },
      ]),
    );
  });

  it('stepTool_StageAddedByAPlugin_JoinsTheToolUntilDisposed', async () => {
    const workflow = startSmallAndMedium();
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
    expect(
      workflow.contributions
        .filter(({ tools }) =>
          tools.some((tool) => tool.name === SET_WORKFLOW_STEP_TOOL),
        )
        .map(({ options }) => options),
    ).toEqual([{ mainAgentOnly: true }]);
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    await workflow.callStepTool('s1', 'extra');
    expect(workflow.lastFlow()?.stage).toBe('extra');

    added.dispose();
    expect(stepsOffered()).not.toContain('extra');
  });

  it('stepTool_LastReportableWorkflowDisposed_LeavesNoTool', () => {
    const workflow = startWorkflowPart();
    const added = workflow.exported().addWorkflow(
      stubWorkflow({
        stages: [
          { id: 'extra', order: 0, reportedAs: 'extra', enter: () => null },
        ],
      }),
    );
    const toolNames = () =>
      workflow.contributions.flatMap(({ tools }) => tools.map((t) => t.name));
    expect(toolNames()).toContain(SET_WORKFLOW_STEP_TOOL);

    added.dispose();

    expect(toolNames()).toEqual([SET_WORKFLOW_CHECKLIST_TOOL]);
  });

  it('savedFlowInAStageNoLongerRegistered_OpensAndFoldsWithoutThrowing', async () => {
    const data = await savedFlowData({ stage: 'feature' });
    const workflow = startWorkflowPart({ data });
    workflow.exported().addWorkflow(
      stubWorkflow({
        stages: [
          {
            id: 'scope',
            order: 0,
            enter: (_flow, signal) =>
              startsSkill(signal, 'x:stub') ? 'scope' : null,
          },
        ],
      }),
    );

    await workflow.openS1();
    await workflow.agentEvent({ type: 'turnEnded', at: AFTER_SAVE });
    expect(workflow.lastFlow()?.stage).toBe('feature');

    await workflow.agentEvent(skill('x:stub', ''));
    expect(workflow.lastFlow()?.stage).toBe('scope');
  });

  it.each([
    { state: 'fresh start', act: () => Promise.resolve() },
    {
      state: 'a stub flow open',
      act: async (harness: MainPartHarness<typeof workflowManifest>) => {
        harness.emit('chat.sessionOpened', {
          sessionId: 's1',
          profileDir: '~/.c',
          hostSessionId: 'h1',
          projectDir: '/r',
          profile: 'personal',
          origin: 'new',
        });
        await settled();
        harness.emit('chat.agentEvent', {
          sessionId: 's1',
          profileDir: '~/.claude',
          hostSessionId: 'h1',
          event: skill('x:stub', ''),
        });
        await settled();
      },
    },
  ])(
    'stop_LeavesNoLiveRegistration_AndWritesNothing ($state)',
    async ({ act }) => {
      const { engine: harness } = startEngineMainPart();
      const exported = harness
        .started()
        .exports?.(createRegistrations()) as WorkflowMainExports;
      exported.addWorkflow(stubWorkflow());
      await act(harness);
      expect(harness.counts().registrations).toBeGreaterThan(0);
      const savedAtStop = await readIfPresent(harness.files, FLOWS_PATH);

      await harness.stop();
      await settled();

      expect(harness.counts()).toEqual(noCounts);
      expect(await readIfPresent(harness.files, FLOWS_PATH)).toBe(savedAtStop);
    },
  );

  it('stopThenStart_StartsAgain', async () => {
    const { engine: harness } = startEngineMainPart();

    await harness.restart();
    await settled();

    expect([...harness.state.read(workflowFlowsSlot, 'test').all()]).toEqual(
      [],
    );
  });

  it.each<{
    name: string;
    row: Partial<SessionRow>;
    chatProfile: string | null;
    opens: boolean;
  }>([
    {
      name: 'a row chat holds',
      row: { hostSessionId: 'h1', projectDir: '/p' },
      chatProfile: 'personal',
      opens: true,
    },
    {
      name: 'a row chat does not hold',
      row: { hostSessionId: 'h1', projectDir: '/p' },
      chatProfile: null,
      opens: false,
    },
    {
      name: 'a row with no host id',
      row: { projectDir: '/p' },
      chatProfile: 'personal',
      opens: false,
    },
    {
      name: "a profile not in chat's settings",
      row: { hostSessionId: 'h1', projectDir: '/p' },
      chatProfile: 'gone',
      opens: false,
    },
  ])(
    'restart_RowAlreadyOpen_OpensItsSavedFlowAsTheEventsWould ($name)',
    async ({ row, chatProfile, opens }) => {
      const { engine: harness } = startEngineMainPart();
      const exportsNow = () =>
        harness
          .started()
          .exports?.(createRegistrations()) as WorkflowMainExports;
      exportsNow().addWorkflow(stubWorkflow());
      emitOpenS1(harness);
      await settled();
      harness.emit('chat.agentEvent', {
        sessionId: 's1',
        profileDir: '~/.c',
        hostSessionId: 'h1',
        event: skill('x:stub', ''),
        replayed: false,
      });
      await settled();
      harness.state.publish(sessionsRowsSlot).set('s1', sessionRow('s1', row));
      if (chatProfile !== null) {
        harness.state
          .publish(chatSessionSlot)
          .set('s1', chatHeld('s1', chatProfile));
      }

      await harness.restart();
      await settled();

      expect(exportsNow().flowOf('s1')).toEqual(
        opens
          ? expect.objectContaining({
              sessionId: 's1',
              projectDir: '/p',
              workflow: 'stub',
            })
          : null,
      );
    },
  );

  it.each<{ name: string; eventFirst: boolean }>([
    { name: "the events before the start's open", eventFirst: true },
    { name: "the events after the start's open", eventFirst: false },
  ])(
    'start_OpenEventsMeetTheStartsOpen_OpensOnce ($name)',
    async ({ eventFirst }) => {
      const { engine: harness } = startEngineMainPart();
      const opened: string[] = [];
      const exported = harness
        .started()
        .exports?.(createRegistrations()) as WorkflowMainExports;
      exported.observe({
        folded: () => undefined,
        opened: (flow) => opened.push(flow.sessionId),
        closed: () => undefined,
        replaying: () => undefined,
      });
      harness.state
        .publish(sessionsRowsSlot)
        .set('s1', sessionRow('s1', { hostSessionId: 'h1', projectDir: '/p' }));
      harness.state
        .publish(chatSessionSlot)
        .set('s1', chatHeld('s1', 'personal'));

      if (eventFirst) {
        emitOpenS1(harness);
        harness.ready();
      } else {
        harness.ready();
        emitOpenS1(harness);
      }
      await settled();

      expect(opened).toEqual(['s1']);
    },
  );

  it('dispose_WriteStillPending_ResolvesOnceItLands', async () => {
    const files = createMemoryFiles();
    let landWrites = () => undefined as void;
    const writesLand = new Promise<void>((land) => {
      landWrites = land;
    });
    const data: MemoryFiles = {
      ...files,
      write: async (path, text) => {
        await writesLand;
        await files.write(path, text);
      },
    };
    const workflow = startWorkflowPart({ data });
    await workflow.openS1();
    let isDisposed = false;

    const disposing = workflow.dispose().then(() => {
      isDisposed = true;
    });
    await settled();
    const disposedBeforeTheWrite = isDisposed;
    landWrites();
    await disposing;

    expect(disposedBeforeTheWrite).toBe(false);
    expect(await readIfPresent(files, FLOWS_FILE)).toContain('"h1"');
  });

  it('exports_ConsumerDisposed_FreesTheWorkflowId', () => {
    const { engine: harness } = startEngineMainPart();
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
    const workflow = startWorkflowPart();
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
    events: (AgentEvent | typeof CLEARED)[];
    replayed: boolean;
    missedLevel: boolean;
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
    },
    {
      name: 'MissedLevel_LiveTurnWithNoWork_StaysFalse',
      events: [
        { type: 'turnStarted', at: 1 },
        { type: 'turnEnded', at: 1 },
      ],
      replayed: false,
      missedLevel: false,
    },
    {
      name: 'MissedLevel_ClearedMidTurn_ForgetsTheWork',
      events: [
        { type: 'turnStarted', at: 1 },
        USAGE,
        CLEARED,
        { type: 'turnEnded', at: 1 },
      ],
      replayed: false,
      missedLevel: false,
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
    },
  ])('$name', async ({ events, replayed, missedLevel }) => {
    const workflow = startWorkflowPart();
    await workflow.openS1();

    let hostSessionId = 'h1';
    for (const event of events) {
      if (event === CLEARED) {
        hostSessionId = 'h2';
        await workflow.emit(
          'sessions.hostSessionChanged',
          session('s1', hostSessionId),
        );
      } else {
        await workflow.agentEvent(event, hostSessionId, replayed);
      }
    }

    expect(workflow.lastFlow()).toMatchObject({
      missedLevel,
      workflow: null,
    });
  });

  it.each(FLOW_ENDS)('TurnWork_ForgottenOnEnd ($name)', async ({ end }) => {
    const workflow = startWorkflowPart({ selfTest: true });
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
      const data = await savedFlowData({ stage: 'build' });
      const workflow = startWorkflowPart({ data });
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
    const workflow = startWorkflowPart({ selfTest: true });
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

  // A session chat keeps through its own restart gets no `sessions.connected`.
  it('sessionOpened_WithNoConnected_OpensUnderItsHostAndFolder', async () => {
    const workflow = startWorkflowPart();
    const opened: SessionFlow[] = [];
    workflow.exported().observe({
      folded: () => undefined,
      opened: (flow) => opened.push(flow),
      closed: () => undefined,
      replaying: () => undefined,
    });

    await workflow.emit('chat.sessionOpened', {
      sessionId: 's7',
      profileDir: '~/.c',
      hostSessionId: 'h-kept',
      projectDir: '/kept',
      profile: 'personal',
      origin: 'restored',
    });

    expect(opened).toMatchObject([{ sessionId: 's7', projectDir: '/kept' }]);
    const saved = JSON.parse(await workflow.data.read(FLOWS_FILE)) as {
      flows: { hostSessionId: string }[];
    };
    expect(saved.flows.map((entry) => entry.hostSessionId)).toEqual(['h-kept']);
  });

  it('Observer_Disposed_HearsNothing', async () => {
    const workflow = startWorkflowPart();
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
    const workflow = startWorkflowPart();
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
    const workflow = startWorkflowPart();
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
    const workflow = startWorkflowPart();
    await workflow.openS1();
    const signal: WorkflowSignal = { type: 'turnStarted' };
    const savedBefore = await workflow.savedAt();
    workflow.time.advance(5);

    workflow.exported().signal('s1', signal, origin);

    expect(await workflow.savedAt()).toBe(stamped ? START + 5 : savedBefore);
  });

  it('RunLog_SpendAfterTheStep', async () => {
    const workflow = startWorkflowPart();
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    await workflow.agentEvent(spent(1));

    workflow.exported().signal('s1', FINISH, 'live');
    await workflow.agentEvent(spent(2));

    expect(await runLogLines(workflow)).toMatchObject([{ costUsd: 1 }]);
  });

  it('RunMeter_BaselineAtClaim', async () => {
    const workflow = startSmallAndMedium();
    workflow.exported().addWorkflow(
      finishingWorkflow({
        order: 30,
        claims: (signal) => startsSkill(signal, 'x:medium-up'),
      }),
    );
    await workflow.openS1();
    workflow.setActiveTime(activeFor(3000));
    await workflow.agentEvent(spent(1));
    await workflow.agentEvent(skill('x:small', ''));
    workflow.setActiveTime(activeFor(4000));
    await workflow.agentEvent(skill('x:medium-up', ''));
    workflow.setActiveTime(activeFor(5000));
    await workflow.agentEvent(spent(2));

    workflow.exported().signal('s1', FINISH, 'live');

    expect(await runLogLines(workflow)).toMatchObject([
      { activeMs: 2000, costUsd: 1, movedUpFrom: 'small' },
    ]);
  });

  it('RunMeter_NoteKeepsTheLargest', async () => {
    const workflow = startWorkflowPart();
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
    const workflow = startWorkflowPart();
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
    const workflow = startWorkflowPart();
    workflow.exported().addWorkflow(stubWorkflow());
    await workflow.openS1();

    await workflow.agentEvent(skill('x:stub', ''));

    expect(workflow.lastFlow()?.stage).toBe('scope');
    expect(await runLines(workflow)).toEqual([]);
  });

  it('RunLog_OpenSpan_CountsUpToTheClock', async () => {
    const workflow = startWorkflowPart();
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
    const workflow = startWorkflowPart({ data });
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();

    await workflow.replayBurst([{ type: 'turnEnded', at }]);

    expect(await runLines(workflow)).toHaveLength(lines);
  });

  it('RunMeter_ReplayedSpend_Counts', async () => {
    const workflow = startWorkflowPart();
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    await workflow.agentEvent(spent(1), 'h1', true);

    workflow.exported().signal('s1', FINISH, 'live');

    expect(await runLogLines(workflow)).toMatchObject([{ costUsd: 1 }]);
  });

  it.each(FLOW_ENDS)('RunMeter_ForgottenOnEnd ($name)', async ({ end }) => {
    const workflow = startWorkflowPart({ selfTest: true });
    workflow.exported().addWorkflow(finishingWorkflow());
    await workflow.openS1();
    workflow.setActiveTime(activeFor(4000));
    await workflow.agentEvent(spent(1));

    await end(workflow);
    workflow.setActiveTime(activeFor(0));
    await workflow.openS1();
    await workflow.agentEvent(skill('x:stub', ''));
    await workflow.emit('sessions.hostSessionChanged', session('s1', 'h2'));
    workflow.exported().signal('s1', FINISH, 'live');

    expect(await runLogLines(workflow)).toMatchObject([
      { activeMs: 0, costUsd: null },
    ]);
  });
});
