import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentHarness, SessionControl } from '../../../contracts/agent';
import type { AlertNoun } from '../../../contracts/alerts';
import type { DemoMainStep } from '../../../contracts/demo';
import { readIfPresent } from '../../../contracts/files';
import type { LoginStartStatus } from '../../../contracts/login-start';
import type { PartStop, RunMode } from '../../../contracts/plugin';
import type {
  HostedRun,
  HostedSpawn,
  PendingSpawn,
  SessionHost,
} from '../../../contracts/session-host';
import { harnessRegistryOf } from '../../../shared/agent-harness-registry.test-support';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { createFakeLoginStart } from '../../../shared/fake-login-start';
import { createFakeSessionHost } from '../../../shared/fake-session-host';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type AdoptRequest,
  type ChatMainExports,
  type ChatProject,
  type ChatSessionInfo,
  chatMainKey,
  chatSessionSlot,
  type LaunchRequest,
  type PreparedLaunch,
} from '../../chat/contract';
import {
  type AgentSession,
  type ContributeToolsOptions,
  type SessionsMainExports,
  sessionsMainKey,
  sessionsRowsSlot,
  sessionsSelectionSlot,
  type ToolCallContext,
  type ToolDefinition,
  type ToolSession,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import {
  DEMO_TASK_IDS,
  type RunHistoryEntry,
  type ScheduledTask,
  schedulingStateSlot,
  type TaskDraft,
} from '../contract';
import { taskFileText } from '../task-file';
import { HISTORY_FILE } from './history-store';
import type { ScheduledRunRecord } from './run-records';
import { schedulingMainPart } from './start';
import { TASK_TOOLS } from './task-tools';

// UTC, so every `daily` time reads directly as the ISO time beside it.
let savedZone: string | undefined;

beforeAll(() => {
  savedZone = process.env.TZ;
  process.env.TZ = 'UTC';
});

afterAll(() => {
  if (savedZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = savedZone;
  }
});

const THREE_DAYS_AGO_10 = Date.parse('2026-11-14T10:00:00Z');
const YESTERDAY_10 = Date.parse('2026-11-16T10:00:00Z');
const TODAY_09 = Date.parse('2026-11-17T09:00:00Z');
const TODAY_10 = Date.parse('2026-11-17T10:00:00Z');
const TODAY_12 = Date.parse('2026-11-17T12:00:00Z');
const TOMORROW_09 = Date.parse('2026-11-18T09:00:00Z');

const TASK_ID = '3f9a01bc';
const OTHER_ID = '0c7e2d95';
const TASK_PATH = '/home/me/.config/wigley-ai-gui/scheduled-tasks.json';
const HISTORY_PATH = `/data/scheduling/${HISTORY_FILE}`;
const OFFLINE_ENV = { WIGLEY_FORMS_OFFLINE: '/endpoint/offline-calls' };
const NEVER_FIRES =
  'This app never fires scheduled tasks; Run now works in the installed app.';
const ALERT_NOUN: AlertNoun = {
  singular: 'finished scheduled run',
  plural: 'finished scheduled runs',
};
const START_CONTROLS: SessionControl[] = [
  {
    id: 'mode',
    label: 'Mode',
    choices: [
      { value: 'plan', label: 'Plan' },
      { value: 'auto', label: 'Auto' },
    ],
    value: null,
  },
];
const PROJECTS: ChatProject[] = [
  { kind: 'folder', name: 'games', folder: '~/games', profile: 'personal' },
];

const settle = async () => {
  for (let turn = 0; turn < 30; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// A daily 09:00 task edited today at 10:00, so its next run is tomorrow's 09:00, with `change` laid over it.
function task(change: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: TASK_ID,
    name: 'Morning triage',
    target: { projectDir: '~/dev/a' },
    profile: 'work',
    prompt: 'Triage the follow-ups.',
    schedule: { kind: 'daily', time: '09:00' },
    controls: { mode: 'plan' },
    paused: false,
    attended: false,
    updatedAt: TODAY_10,
    ...change,
  };
}

function draftOf(scheduled: ScheduledTask): TaskDraft {
  const { updatedAt: _updatedAt, ...draft } = scheduled;
  return draft;
}

function adoptRequest(rowId: string, hostSessionId: string): AdoptRequest {
  return {
    hostSessionId,
    processId: `${hostSessionId}-1-0`,
    rowId,
    projectDir: '/home/me/dev/a',
    harness: 'claude',
    profile: 'work',
    headless: true,
    unattended: false,
    instructions: [],
    owner: null,
    controls: { mode: 'plan' },
    titles: { user: null, agent: null, firstMessage: 'Triage the follow-ups.' },
  };
}

// A host run of today's 09:00 of the task, adopted as `row-run` on `host-run`, with `change` laid over it.
function hostedRun(change: Partial<HostedRun> = {}): HostedRun {
  const record: ScheduledRunRecord = {
    taskId: TASK_ID,
    occurrence: TODAY_09,
    adopt: adoptRequest('row-run', 'host-run'),
  };
  return {
    id: 'spawn-run',
    record,
    startedAt: TODAY_09,
    skipped: false,
    exit: null,
    ...change,
  };
}

// A second run of the task, at today's 10:00, adopted as `row-run-2`.
function secondRun(): HostedRun {
  const record: ScheduledRunRecord = {
    taskId: TASK_ID,
    occurrence: TODAY_10,
    adopt: adoptRequest('row-run-2', 'host-run-2'),
  };
  return hostedRun({ id: 'spawn-run-2', record, startedAt: TODAY_10 });
}

function sessionInfo(
  sessionId: string,
  session: Pick<ChatSessionInfo, 'running' | 'activity'>,
): ChatSessionInfo {
  return {
    sessionId,
    projectDir: '/home/me/dev/a',
    harness: 'claude',
    profile: 'work',
    background: 0,
    activeTime: { totalMs: 0, since: null },
    pid: null,
    compaction: null,
    repo: 'a',
    branch: null,
    worktrees: [],
    headless: true,
    ...session,
  };
}

function runningEntry(change: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    taskId: TASK_ID,
    occurrence: TODAY_09,
    at: TODAY_09,
    outcome: 'running',
    reason: null,
    rowId: 'row-run',
    processId: 'host-run-1-0',
    viewed: false,
    ...change,
  };
}

function failedEntry(reason: string): RunHistoryEntry {
  return runningEntry({
    outcome: 'failed',
    reason,
    rowId: null,
    processId: null,
    viewed: true,
  });
}

function spawnIdOf(entry: PendingSpawn | undefined): string | undefined {
  return (entry?.spawn as HostedSpawn | undefined)?.id;
}

interface StartOptions {
  isDev?: boolean;
  runMode?: RunMode;
  tasks?: ScheduledTask[];
  history?: RunHistoryEntry[] | string;
  // In the host before the part starts, so only `listRuns` brings them.
  runs?: HostedRun[];
  loginAnswer?: LoginStartStatus;
  // Registered before the chat's harness.
  harnessesFirst?: AgentHarness[];
}

// The part on the harness at today's 12:00, over fakes that live across a restart: a chat whose `prepareLaunch`
// counts its prepares in the ids and whose `adopt` opens the row `part.session` describes (null: a relay row, with no
// chat session), a sessions that records its holds, replays and contributions, the fake host and login start. `calls`
// is one log across the fakes; `history add` stands where the part logged `adopted run of …`, which it writes right
// after its history add. `enterStep` enters the Scheduled tasks demo step's main half.
function startPart(options: StartOptions = {}) {
  let now = TODAY_12;
  const clock = { now: () => now };
  const host = createFakeSessionHost(clock);
  const loginStart = createFakeLoginStart();
  if (options.loginAnswer !== undefined) {
    loginStart.answer(options.loginAnswer);
  }
  const calls: string[] = [];
  const prepares: {
    request: LaunchRequest;
    env: Readonly<Record<string, string>>;
  }[] = [];
  const adopts: AdoptRequest[] = [];
  const holds: Promise<unknown>[] = [];
  const contributions: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
    options: ContributeToolsOptions | undefined;
  }[] = [];
  const alerts: { count: number; noun: AlertNoun }[] = [];
  const instructionsListeners = new Set<() => void>();
  let seenLogs = 0;
  let isPushHeld = false;
  // What every `listRuns` waits on before it reads the host; null reads at once.
  let listGate: Promise<void> | null = null;
  // The harness's log, once `startMainPart` returned: the part subscribes during its start.
  let logs: () => readonly { message: string }[] = () => [];
  for (const run of options.runs ?? []) {
    host.startRun(run);
  }

  const note = (call: string) => {
    for (const { message } of logs().slice(seenLogs)) {
      if (message.startsWith('adopted run of')) {
        calls.push('history add');
      }
    }
    seenLogs = logs().length;
    calls.push(call);
  };

  const sessionHost: SessionHost = {
    ...host,
    listRuns() {
      note('listRuns');
      const gate = listGate;
      return gate === null ? host.listRuns() : gate.then(() => host.listRuns());
    },
    forgetRuns(ids) {
      note(`forgetRuns ${ids.join(' ')}`);
      host.forgetRuns(ids);
    },
    setPending(entries) {
      note('setPending');
      host.setPending(entries);
    },
    onRunStarted(listener) {
      note('onRunStarted');
      return host.onRunStarted((run) => {
        if (!isPushHeld) {
          listener(run);
        }
      });
    },
    onConnected(listener) {
      const subscription = host.onConnected(listener);
      return {
        dispose() {
          subscription.dispose();
          if (part.unsubscribeError !== null) {
            throw new Error(part.unsubscribeError);
          }
        },
      };
    },
  };

  const chatHarness = {
    id: 'claude',
    info: () => ({
      profiles: [
        { name: 'work', configDir: '~/.claude-work' },
        { name: 'personal', configDir: '~/.claude' },
      ],
    }),
    startControls: () => START_CONTROLS,
    capControls: (controls: Readonly<Record<string, string>>) => ({
      ...controls,
    }),
  } as unknown as AgentHarness;

  const chat = {
    async prepareLaunch(
      request: LaunchRequest,
      env: Readonly<Record<string, string>>,
    ): Promise<PreparedLaunch> {
      const error = part.prepareErrors.shift();
      if (error !== undefined) {
        throw new Error(error);
      }
      prepares.push({ request, env });
      const n = prepares.length;
      return {
        spawn: { id: `spawn-${n}` } as HostedSpawn,
        adopt: adoptRequest(`row-${n}`, `host-${n}`),
      };
    },
    adopt(run: AdoptRequest) {
      note('adopt');
      adopts.push(run);
      return part.answerAdopt(run);
    },
    projects: () => PROJECTS,
    profileOf: () => 'work',
    defaultProfile: () => 'work',
    restored: () => Promise.resolve(),
    onInstructionsChanged(listener: () => void) {
      instructionsListeners.add(listener);
      return { dispose: () => instructionsListeners.delete(listener) };
    },
  } as unknown as ChatMainExports;

  const sessions = {
    holdConnects(until: Promise<unknown>) {
      note('holdConnects');
      holds.push(until);
      until.then(() => calls.push('hold settled'));
    },
    offlineEnv: () => OFFLINE_ENV,
    replayCalls(hostSessionId: string) {
      note(`replayCalls ${hostSessionId}`);
      if (part.replayError !== null) {
        return Promise.reject(new Error(part.replayError));
      }
      return Promise.resolve(part.replayed);
    },
    contributeTools(
      tools: ToolDefinition[],
      start: (session: AgentSession) => ToolSession,
      contributeOptions?: ContributeToolsOptions,
    ) {
      contributions.push({ tools, start, options: contributeOptions });
      return { dispose() {} };
    },
  } as unknown as SessionsMainExports;

  const demoSteps = createDemoStepRegistry<DemoMainStep>();
  const harness = startMainPart(schedulingMainPart, {
    services: {
      runMode: options.runMode ?? 'live',
      appInstance: {
        id: options.isDev ? 'wigley-ai-gui-dev' : 'wigley-ai-gui',
        displayName: options.isDev ? 'Auri Dev' : 'Auri',
        isDev: options.isDev ?? false,
      },
      homeDir: '/home/me',
      clock,
      sessionHost,
      loginStart,
      agentHarnesses: harnessRegistryOf([
        ...(options.harnessesFirst ?? []),
        chatHarness,
      ]),
      alerts: {
        setOpenCount: (_source, count, noun) => alerts.push({ count, noun }),
      },
      demoSteps,
    },
    dependencies: [
      fakeDependency(chatMainKey, () => chat),
      fakeDependency(sessionsMainKey, () => sessions),
    ],
  });
  logs = () => harness.logs;
  // Written before the part's first step reads them: the start queues its loads and returns.
  void harness.files.write(
    TASK_PATH,
    taskFileText({ tasks: options.tasks ?? [task()] }),
  );
  if (options.history !== undefined) {
    void harness.files.write(
      HISTORY_PATH,
      typeof options.history === 'string'
        ? options.history
        : JSON.stringify(options.history),
    );
  }
  const rows = harness.state.publish(sessionsRowsSlot);
  const chatSessions = harness.state.publish(chatSessionSlot);
  const selection = harness.state.publish(sessionsSelectionSlot);

  const part = {
    harness,
    host,
    loginStart,
    calls,
    prepares,
    adopts,
    holds,
    contributions,
    alerts,
    rows,
    chatSessions,
    selection,
    prepareErrors: [] as string[],
    replayed: 0,
    // What `replayCalls` rejects with; null resolves to `replayed`.
    replayError: null as string | null,
    // What the `onConnected` subscription's dispose throws; null disposes cleanly.
    unsubscribeError: null as string | null,
    // What the adopted row's chat session reads; null opens a relay row, with no chat session.
    session: { running: true, activity: 'working' } as Pick<
      ChatSessionInfo,
      'running' | 'activity'
    > | null,
    // The row id `adopt` resolves to; null for the request's own.
    adoptedRowId: null as string | null,
    answerAdopt(run: AdoptRequest): Promise<string> {
      const rowId = part.adoptedRowId ?? run.rowId;
      rows.set(rowId, sessionRow(rowId, { hostSessionId: run.hostSessionId }));
      if (part.session !== null) {
        chatSessions.set(rowId, sessionInfo(rowId, part.session));
      }
      return Promise.resolve(rowId);
    },
    state: () => harness.state.read(schedulingStateSlot, 'test').get(),
    messages: () => harness.logs.map((line) => line.message),
    lastPending: () => host.pendingLists.at(-1),
    holdPushes(isHeld: boolean) {
      isPushHeld = isHeld;
    },
    // Holds every `listRuns` from now on until the returned release is called.
    holdListRuns(): () => void {
      let release = () => undefined as void;
      listGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        listGate = null;
        release();
      };
    },
    changeInstructions() {
      for (const listener of instructionsListeners) {
        listener();
      }
    },
    async push(run: HostedRun) {
      host.startRun(run);
      await settle();
    },
    async advance(ms: number) {
      now += ms;
      harness.advance(ms);
      await settle();
    },
    async historyFile(): Promise<RunHistoryEntry[]> {
      const text = await readIfPresent(harness.files, HISTORY_PATH);
      return text === null ? [] : (JSON.parse(text) as RunHistoryEntry[]);
    },
    async taskFile(): Promise<string | null> {
      return readIfPresent(harness.files, TASK_PATH);
    },
    enterStep() {
      const step = demoSteps
        .list()
        .find(({ id }) => id === 'scheduling.schedules');
      if (step === undefined) {
        throw new Error('scheduling registered no scheduling.schedules step');
      }
      return step.enter({
        scratchDir: '/scratch',
        launchSession: async () => 'row-demo',
        processEvents: () => {
          throw new Error('no process events in this test');
        },
      });
    },
    async listTool(): Promise<string> {
      const session = contributions[0].start({
        id: 'row-caller',
      } as AgentSession);
      const result = await session.call(
        'list_scheduled_tasks',
        {},
        {} as ToolCallContext,
      );
      return JSON.stringify(result);
    },
  };
  return part;
}

describe('schedulingMainPart', () => {
  it.each<{ isDev: boolean; runMode: RunMode; fires: boolean }>([
    { isDev: false, runMode: 'live', fires: true },
    { isDev: true, runMode: 'live', fires: false },
    { isDev: true, runMode: 'drive', fires: true },
    { isDev: true, runMode: 'selfTest', fires: true },
  ])(
    'start_FiresRule_QueuesOrNot: isDev $isDev, $runMode',
    async ({ isDev, runMode, fires }) => {
      const part = startPart({ isDev, runMode });
      await settle();

      if (fires) {
        expect(part.host.pendingLists).toHaveLength(1);
        return;
      }
      expect(part.host.pendingLists).toEqual([]);
      expect(part.calls).not.toContain('listRuns');
      expect(part.calls).not.toContain('onRunStarted');
      expect(part.loginStart.calls).toEqual([]);
      expect(part.state()).toMatchObject({
        fires: false,
        loginStart: null,
        tasks: [{ nextRun: null }],
      });
    },
  );

  it('start_Tasks_QueuesOnePendingEntryPerPlannedTask', async () => {
    const part = startPart({
      tasks: [task(), task({ id: OTHER_ID, name: 'Paused', paused: true })],
    });
    await settle();

    const entries = part.lastPending();
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({
      at: TOMORROW_09,
      record: {
        taskId: TASK_ID,
        occurrence: TOMORROW_09,
        adopt: adoptRequest('row-1', 'host-1'),
      },
    });
    expect(part.prepares).toEqual([
      {
        request: {
          projectDir: '/home/me/dev/a',
          profile: 'work',
          message: { text: 'Triage the follow-ups.', images: [] },
          headless: true,
          controls: { mode: 'plan' },
        },
        env: OFFLINE_ENV,
      },
    ]);
    expect(part.loginStart.calls).toEqual([true]);
    expect(part.messages()).toContain('queued 1 runs');
  });

  it.each<{
    attended: boolean;
    headless: boolean;
    env: Readonly<Record<string, string>>;
  }>([
    { attended: true, headless: false, env: {} },
    { attended: false, headless: true, env: OFFLINE_ENV },
  ])(
    'queueRuns_AttendedTask_PreparesHeadlessOffAndNeedsClient: attended $attended',
    async ({ attended, headless, env }) => {
      const part = startPart({ tasks: [task({ attended })] });
      await settle();

      expect(part.prepares).toMatchObject([{ request: { headless } }]);
      expect(part.prepares[0]?.env).toEqual(env);
      expect(part.lastPending()?.[0]?.needsClient).toBe(attended);
    },
  );

  it('start_HostRanWhileClosed_RecordsBeforeTheFirstPlan', async () => {
    const part = startPart({
      tasks: [task({ updatedAt: YESTERDAY_10 })],
      runs: [hostedRun()],
    });
    await settle();

    expect(part.host.pendingLists[0]?.[0]).toMatchObject({
      at: TOMORROW_09,
      record: { occurrence: TOMORROW_09 },
    });
    expect(await part.historyFile()).toEqual([runningEntry()]);
  });

  it('start_ListRunsRejects_RetriesAndPlansNothing', async () => {
    const part = startPart();
    part.host.failList('host down');
    await settle();

    expect(part.messages()).toContain('runs not read: host down');
    expect(part.host.pendingLists).toEqual([]);

    part.host.failList(null);
    await part.advance(9_999);
    expect(part.host.pendingLists).toEqual([]);

    await part.advance(1);
    expect(part.host.pendingLists).toHaveLength(1);
  });

  it('start_HoldsConnectsBeforeTheFirstListRuns', async () => {
    const part = startPart({ runs: [hostedRun()] });
    await settle();

    const order = part.calls.filter((call) =>
      ['holdConnects', 'listRuns', 'adopt', 'hold settled'].includes(call),
    );
    expect(order).toEqual([
      'holdConnects',
      'listRuns',
      'adopt',
      'hold settled',
    ]);
  });

  it('start_Reconnect_ListsRunsAgain', async () => {
    const part = startPart();
    await settle();
    part.holdPushes(true);
    part.host.startRun(hostedRun());
    part.holdPushes(false);
    part.calls.length = 0;

    part.host.connectAgain();
    await settle();

    // The hold's release resolves before the plan, but `hold settled` is noted a microtask later, after the plan's
    // synchronous `setPending`; so the hold and the plan are each ordered against the adopt.
    const holdCalls = ['holdConnects', 'listRuns', 'adopt', 'hold settled'];
    expect(part.calls.filter((call) => holdCalls.includes(call))).toEqual(
      holdCalls,
    );
    const planCalls = ['holdConnects', 'listRuns', 'adopt', 'setPending'];
    expect(part.calls.filter((call) => planCalls.includes(call))).toEqual(
      planCalls,
    );
  });

  it('run_Pushed_AdoptsRecordsReplaysForgetsAndReplans', async () => {
    const part = startPart();
    await settle();
    part.calls.length = 0;

    await part.push(hostedRun());

    expect(part.calls).toEqual([
      'adopt',
      'history add',
      'replayCalls host-run',
      'forgetRuns spawn-run',
      'setPending',
    ]);
  });

  it.each<{
    case: string;
    heard: 'listed' | 'pushed';
    run?: Partial<HostedRun>;
    adopt?: 'resolve' | 'reject' | 'rejectWhileDisposing';
    adoptedRowId?: string;
    session?: Pick<ChatSessionInfo, 'running' | 'activity'> | null;
    history?: RunHistoryEntry[];
    replayed?: number;
    replayError?: string;
    expected: RunHistoryEntry[];
    log?: string;
    forgets: boolean;
  }>([
    {
      case: 'skipped',
      heard: 'listed',
      run: { skipped: true },
      expected: [
        runningEntry({
          outcome: 'skipped',
          rowId: null,
          processId: null,
          viewed: true,
        }),
      ],
      log: 'skipped run of Morning triage: its previous run is still going',
      forgets: true,
    },
    {
      case: 'a spawn error',
      heard: 'listed',
      run: { exit: { code: null, signal: null, error: 'spawn x EPERM' } },
      expected: [
        failedEntry(
          'could not start the agent in /home/me/dev/a: spawn x EPERM',
        ),
      ],
      log: 'run of Morning triage failed to start: could not start the agent in /home/me/dev/a: spawn x EPERM',
      forgets: true,
    },
    {
      case: 'adopted as another row, reading idle',
      heard: 'listed',
      adoptedRowId: 'row-other',
      session: { running: true, activity: 'idle' },
      replayed: 1,
      expected: [runningEntry({ outcome: 'finished', rowId: 'row-other' })],
      log: 'replayed 1 calls for row-other',
      forgets: true,
    },
    {
      case: 'adopt rejects',
      heard: 'pushed',
      adopt: 'reject',
      expected: [failedEntry('not opened: row not opened')],
      log: 'run of Morning triage not opened: row not opened',
      forgets: true,
    },
    {
      case: 'adopt rejects while the part disposes',
      heard: 'pushed',
      adopt: 'rejectWhileDisposing',
      expected: [],
      log: 'run of Morning triage not opened: row not opened',
      forgets: false,
    },
    {
      case: 'a relay row',
      heard: 'pushed',
      adoptedRowId: 'row-relay',
      session: null,
      expected: [runningEntry({ outcome: 'finished', rowId: 'row-relay' })],
      forgets: true,
    },
    {
      case: 'a held row whose entry history already has',
      heard: 'listed',
      adoptedRowId: 'row-held',
      history: [runningEntry({ at: TODAY_09 + 1000, rowId: 'row-held' })],
      expected: [runningEntry({ at: TODAY_09 + 1000, rowId: 'row-held' })],
      forgets: true,
    },
    {
      case: 'listed, process running, reading idle',
      heard: 'listed',
      session: { running: true, activity: 'idle' },
      expected: [runningEntry({ outcome: 'finished' })],
      forgets: true,
    },
    {
      case: 'pushed, process running, reading idle',
      heard: 'pushed',
      session: { running: true, activity: 'idle' },
      expected: [runningEntry()],
      forgets: true,
    },
    {
      case: 'pushed, process gone',
      heard: 'pushed',
      run: { exit: { code: 0, signal: null, error: null } },
      session: { running: false, activity: 'idle' },
      expected: [runningEntry({ outcome: 'finished' })],
      forgets: true,
    },
    {
      case: 'listed, a host death',
      heard: 'listed',
      run: { exit: { code: null, signal: null, error: null } },
      session: { running: false, activity: 'idle' },
      expected: [runningEntry({ outcome: 'finished' })],
      forgets: true,
    },
    {
      case: 'listed, an unheld row whose process may still run',
      heard: 'listed',
      session: { running: false, activity: 'idle' },
      expected: [runningEntry()],
      forgets: true,
    },
    {
      case: 'replayCalls rejects',
      heard: 'pushed',
      replayError: 'EACCES',
      expected: [runningEntry()],
      log: 'calls of host session host-run for row-run not replayed: EACCES',
      forgets: true,
    },
  ])('run_Outcome_WritesHistory: $case', async (row) => {
    const run = hostedRun(row.run);
    const part = startPart({
      history: row.history,
      runs: row.heard === 'listed' ? [run] : [],
    });
    part.adoptedRowId = row.adoptedRowId ?? null;
    if (row.session !== undefined) {
      part.session = row.session;
    }
    part.replayed = row.replayed ?? 0;
    part.replayError = row.replayError ?? null;
    let rejectAdopt = (_error: Error) => undefined as void;
    if (row.adopt === 'reject') {
      part.answerAdopt = () => Promise.reject(new Error('row not opened'));
    }
    if (row.adopt === 'rejectWhileDisposing') {
      part.answerAdopt = () =>
        new Promise((_resolve, reject) => {
          rejectAdopt = reject;
        });
    }
    await settle();
    if (row.heard === 'pushed') {
      await part.push(run);
    }
    if (row.adopt === 'rejectWhileDisposing') {
      const stopping = part.harness.stop('quit');
      rejectAdopt(new Error('row not opened'));
      await stopping;
    }
    await settle();

    expect(part.adopts).toHaveLength(
      run.skipped || run.exit?.error != null ? 0 : 1,
    );
    expect(await part.historyFile()).toEqual(row.expected);
    expect(part.host.forgotten).toEqual(row.forgets ? [run.id] : []);
    if (row.log !== undefined) {
      expect(part.messages()).toContain(row.log);
    }
  });

  it('start_HistoryLoadFails_PlansWithNoCatchUp', async () => {
    const part = startPart({
      tasks: [task({ updatedAt: THREE_DAYS_AGO_10 })],
      history: 'not json',
    });
    await settle();

    expect(
      part.messages().some((line) => line.startsWith('history.json not read:')),
    ).toBe(true);
    expect(part.host.pendingLists[0]?.[0]?.at).toBe(TOMORROW_09);
  });

  it.each<{
    case: string;
    tasks: ScheduledTask[];
    act?: (part: ReturnType<typeof startPart>) => Promise<void>;
    expected: boolean[];
  }>([
    { case: 'one active task', tasks: [task()], expected: [true] },
    // Breaks: the host started at login for an attended run, which starts only while the app is open.
    {
      case: 'only an attended task',
      tasks: [task({ attended: true })],
      expected: [false],
    },
    {
      case: 'an attended and an unattended task',
      tasks: [task({ attended: true }), task({ id: OTHER_ID })],
      expected: [true],
    },
    {
      case: 'only paused tasks',
      tasks: [task({ paused: true })],
      expected: [false],
    },
    {
      case: 'the only task paused',
      tasks: [task()],
      act: async (part) => {
        await part.harness.invoke('setPaused', TASK_ID, true);
      },
      expected: [true, false],
    },
    {
      case: 'the only task resumed',
      tasks: [task({ paused: true })],
      act: async (part) => {
        await part.harness.invoke('setPaused', TASK_ID, false);
      },
      expected: [false, true],
    },
    {
      case: 'two re-plans with no change',
      tasks: [task()],
      act: async (part) => {
        part.changeInstructions();
        await settle();
        part.changeInstructions();
      },
      expected: [true],
    },
  ])(
    'plan_WantChanges_SetsLoginStartOnceAndPublishesStatus: $case',
    async ({ tasks, act, expected }) => {
      const part = startPart({ tasks });
      await settle();
      await act?.(part);
      await settle();

      expect(part.loginStart.calls).toEqual(expected);
    },
  );

  it('plan_WantChanges_SetsLoginStartOnceAndPublishesStatus: needsApproval', async () => {
    const status: LoginStartStatus = {
      state: 'needsApproval',
      detail: 'Allow it in System Settings.',
    };
    const part = startPart({ loginAnswer: status });
    await settle();

    expect(part.state()?.loginStart).toEqual(status);
  });

  it('plan_InstructionsChange_PreparesAgain', async () => {
    const part = startPart();
    await settle();
    const before = spawnIdOf(part.lastPending()?.[0]);

    part.changeInstructions();
    await settle();

    expect(spawnIdOf(part.lastPending()?.[0])).not.toBe(before);
  });

  it('plan_InstructionsChange_RecordsFiredRunsBeforeQueueing', async () => {
    // Edited yesterday, so today's 09:00 is a catch-up the first plan queues at once.
    const part = startPart({ tasks: [task({ updatedAt: YESTERDAY_10 })] });
    await settle();
    part.holdPushes(true);
    part.host.startRun(hostedRun());
    part.holdPushes(false);

    part.changeInstructions();
    await settle();

    expect(part.lastPending()).toMatchObject([
      { at: TOMORROW_09, record: { occurrence: TOMORROW_09 } },
    ]);
    expect(await part.historyFile()).toEqual([runningEntry()]);
  });

  it('plan_TaskEditsDuringARead_ListRunsOnceThenPlanOnce', async () => {
    const part = startPart();
    await settle();
    const releaseList = part.holdListRuns();
    part.calls.length = 0;

    // The first edit's read waits in `listRuns`; the next two arrive while it does.
    for (const prompt of ['Triage A.', 'Triage B.', 'Triage C.']) {
      await part.harness.files.write(
        TASK_PATH,
        taskFileText({ tasks: [task({ prompt })] }),
      );
      await settle();
    }
    releaseList();
    await settle();

    const readAndPlanCalls = ['holdConnects', 'listRuns', 'setPending'];
    expect(
      part.calls.filter((call) => readAndPlanCalls.includes(call)),
    ).toEqual(['holdConnects', 'listRuns', 'setPending', 'setPending']);
    expect(part.prepares.at(-1)?.request.message.text).toBe('Triage C.');
  });

  it('plan_TaskEditJoinsAQueuedRead_ListRunsOnceMore', async () => {
    const part = startPart();
    await settle();
    const releaseList = part.holdListRuns();
    part.calls.length = 0;

    // The first edit's read waits in `listRuns`; a reconnect queues a second read behind it, and the next edit
    // arrives while that read is queued and not begun.
    await part.harness.files.write(
      TASK_PATH,
      taskFileText({ tasks: [task({ prompt: 'Triage A.' })] }),
    );
    await settle();
    part.host.connectAgain();
    await settle();
    await part.harness.files.write(
      TASK_PATH,
      taskFileText({ tasks: [task({ prompt: 'Triage B.' })] }),
    );
    await settle();
    releaseList();
    await settle();

    // Joined, the edit costs no third read and no plan beyond the two reads' own.
    const readAndPlanCalls = ['holdConnects', 'listRuns', 'setPending'];
    expect(
      part.calls.filter((call) => readAndPlanCalls.includes(call)),
    ).toEqual([...readAndPlanCalls, ...readAndPlanCalls]);
    expect(part.prepares.at(-1)?.request.message.text).toBe('Triage B.');
  });

  it('tools_ViewsReadTheStoresAtCallTime', async () => {
    const part = startPart();
    await settle();
    // An adopt that never settles holds the chain, so no step re-publishes.
    part.answerAdopt = () => new Promise(() => undefined);
    await part.push(hostedRun());

    await part.harness.invoke(
      'saveTask',
      draftOf(task({ id: null as unknown as string, name: 'Nightly check' })),
    );

    expect(await part.listTool()).toContain('Nightly check');
    expect(part.state()?.tasks.map((view) => view.task.name)).toEqual([
      'Morning triage',
    ]);
  });

  it('run_NotAScheduledRecord_IsForgotten', async () => {
    const part = startPart();
    await settle();

    await part.push(hostedRun({ id: 'spawn-other', record: 'other' }));

    expect(part.adopts).toEqual([]);
    expect(part.host.forgotten).toEqual(['spawn-other']);
    expect(part.messages()).toContain(
      'run spawn-other is not a scheduled run; forgotten',
    );
  });

  it('run_SameIdTwice_IsHandledOnce', async () => {
    const part = startPart();
    await settle();

    await part.push(hostedRun());
    await part.push(hostedRun());

    expect(part.adopts).toHaveLength(1);
    expect(part.host.forgotten).toEqual(['spawn-run', 'spawn-run']);
  });

  it('plan_PrepareThrows_RecordsFailedOnlyWhenDue: due', async () => {
    const part = startPart({ tasks: [task({ updatedAt: YESTERDAY_10 })] });
    part.prepareErrors.push('no folder /home/me/dev/a');
    await settle();

    expect(await part.historyFile()).toEqual([
      { ...failedEntry('no folder /home/me/dev/a'), at: TODAY_12 },
    ]);
    expect(part.messages()).toContain(
      'run of Morning triage failed to start: no folder /home/me/dev/a',
    );
    expect(part.lastPending()?.[0]?.at).toBe(TOMORROW_09);
  });

  it('plan_PrepareThrows_RecordsFailedOnlyWhenDue: later', async () => {
    const part = startPart();
    part.prepareErrors.push('no folder /home/me/dev/a');
    await settle();

    expect(await part.historyFile()).toEqual([]);
    expect(part.lastPending()).toEqual([]);
    expect(part.state()?.tasks[0]?.nextRun).toBe(TOMORROW_09);

    await part.advance(TOMORROW_09 - TODAY_12);

    expect(part.prepares).toHaveLength(1);
    expect(part.lastPending()?.[0]?.at).toBe(TOMORROW_09);
  });

  it('plan_UnchangedOccurrence_ReusesThePreparedLaunch', async () => {
    const part = startPart();
    await settle();
    const first = spawnIdOf(part.lastPending()?.[0]);

    await part.harness.invoke(
      'saveTask',
      draftOf(task({ id: null as unknown as string, name: 'Nightly check' })),
    );
    await settle();
    expect(spawnIdOf(part.lastPending()?.[0])).toBe(first);

    // A hand edit of the prompt alone keeps the `updatedAt` the file holds.
    await part.harness.files.write(
      TASK_PATH,
      taskFileText({ tasks: [task({ prompt: 'Triage the backlog.' })] }),
    );
    await settle();
    const handEdited = spawnIdOf(part.lastPending()?.[0]);
    expect(handEdited).not.toBe(first);

    await part.harness.invoke(
      'saveTask',
      draftOf(task({ prompt: 'Triage the inbox.' })),
    );
    await settle();
    expect(spawnIdOf(part.lastPending()?.[0])).not.toBe(handEdited);
  });

  it('runNow_Press_QueuesAtNow', async () => {
    const part = startPart();
    await settle();

    part.harness.invoke('runNow', TASK_ID);
    await settle();

    expect(part.lastPending()?.[0]).toMatchObject({
      at: TODAY_12,
      record: { occurrence: TODAY_12 },
    });
  });

  it("runNow_Press_QueuesAtNow: another task's due prepare throws", async () => {
    // Listed first, so its prepare takes the error; edited yesterday, so its 09:00 is due.
    const due = task({
      id: OTHER_ID,
      name: 'Nightly check',
      updatedAt: YESTERDAY_10,
    });
    const part = startPart({ tasks: [due, task()] });
    await settle();
    const before = part.host.pendingLists.length;

    // The instruction change drops the kept launches, so the press's plan prepares both tasks again.
    part.prepareErrors.push('no folder /home/me/dev/a');
    part.changeInstructions();
    part.harness.invoke('runNow', TASK_ID);
    await settle();

    expect(part.host.pendingLists[before]).toMatchObject([
      { at: TOMORROW_09, record: { taskId: OTHER_ID } },
      { at: TODAY_12, record: { taskId: TASK_ID, occurrence: TODAY_12 } },
    ]);
    expect(await part.historyFile()).toMatchObject([
      { taskId: OTHER_ID, outcome: 'failed' },
    ]);
  });

  it.each<{ case: string; options: StartOptions; id: string; text: string }>([
    {
      case: 'the dev app',
      options: { isDev: true },
      id: TASK_ID,
      text: NEVER_FIRES,
    },
    {
      case: 'an unknown id',
      options: {},
      id: 'ffffffff',
      text: 'No scheduled task ffffffff.',
    },
    {
      case: 'a paused task',
      options: { tasks: [task({ paused: true })] },
      id: TASK_ID,
      text: 'Morning triage is paused.',
    },
  ])('runNow_Refused_Throws: $case', async ({ options, id, text }) => {
    const part = startPart(options);
    await settle();

    expect(() => part.harness.invoke('runNow', id)).toThrow(text);
  });

  it('rows_FinishAndView_TrackUnviewedAndAlerts', async () => {
    const part = startPart();
    await settle();
    await part.push(hostedRun());
    part.selection.set('row-elsewhere');

    part.harness.emit('chat.turnFinished', {
      sessionId: 'row-run',
      how: 'idle',
    });
    await settle();
    expect(part.state()?.unviewedRows).toEqual(['row-run']);
    expect(part.alerts.at(-1)).toEqual({ count: 1, noun: ALERT_NOUN });

    await part.harness.restart();
    await settle();
    expect(part.state()?.unviewedRows).toEqual(['row-run']);
    expect(part.alerts.at(-1)?.count).toBe(1);

    part.selection.set('row-run');
    await settle();
    expect(part.state()?.unviewedRows).toEqual([]);
    expect(part.alerts.at(-1)?.count).toBe(0);

    await part.push(secondRun());
    part.selection.set('row-run-2');
    part.harness.emit('chat.turnFinished', {
      sessionId: 'row-run-2',
      how: 'idle',
    });
    await settle();
    expect(part.state()?.runRows).toEqual(['row-run', 'row-run-2']);
    expect(part.state()?.unviewedRows).toEqual([]);
  });

  it('rows_RunRowCloses_IsFinishedAndLeavesRunRows', async () => {
    const part = startPart();
    await settle();
    await part.push(hostedRun());
    expect(part.state()?.runRows).toEqual(['row-run']);

    part.rows.delete('row-run');
    await settle();

    expect(part.state()?.runRows).toEqual([]);
    expect((await part.historyFile())[0]?.outcome).toBe('finished');
  });

  it.each<{ case: string; change: Partial<ScheduledTask>; text: string }>([
    {
      case: 'an unknown profile',
      change: { profile: 'nobody' },
      text: 'No profile nobody.',
    },
    {
      case: 'an unknown project',
      change: { target: { project: 'ghost' } },
      text: 'No project ghost.',
    },
    {
      case: "another profile than the project's own",
      change: { target: { project: 'games' }, profile: 'work' },
      text: 'Project games runs under its own profile personal.',
    },
  ])(
    'saveTask_UnknownProfileOrProject_Rejects: $case',
    async ({ change, text }) => {
      const part = startPart();
      await settle();
      const before = await part.taskFile();

      await expect(
        part.harness.invoke('saveTask', draftOf(task(change))),
      ).rejects.toThrow(text);
      expect(await part.taskFile()).toBe(before);
    },
  );

  it('editorChoices_ReadsChatAndTheHarness', async () => {
    const part = startPart();
    await settle();

    expect(part.harness.invoke('editorChoices')).toEqual({
      profiles: ['work', 'personal'],
      projects: ['games'],
      controls: START_CONTROLS,
    });
  });

  it('editorChoices_UnlistedHarnessRegisteredFirst_LeftOut', async () => {
    const demo = {
      id: 'demo',
      info: () => ({
        profiles: [{ name: 'demo', configDir: '/demo' }],
        unlisted: true,
      }),
      startControls: () => [{ ...START_CONTROLS[0], id: 'demo-mode' }],
    } as unknown as AgentHarness;
    const part = startPart({ harnessesFirst: [demo] });
    await settle();

    expect(part.harness.invoke('editorChoices')).toEqual({
      profiles: ['work', 'personal'],
      projects: ['games'],
      controls: START_CONTROLS,
    });
  });

  it.each<{ stop: PartStop; clears: boolean }>([
    { stop: 'end', clears: true },
    { stop: 'restart', clears: false },
    { stop: 'quit', clears: false },
  ])('dispose_Stop_ClearsQueueOnlyOnEnd: $stop', async ({ stop, clears }) => {
    const part = startPart();
    await settle();

    await part.harness.stop(stop);

    expect(part.lastPending()).toHaveLength(clears ? 0 : 1);
    expect(part.loginStart.calls).toEqual(clears ? [true, false] : [true]);
  });

  // Breaks if a later step's error replaces the first, or a throw skips the
  // steps after it.
  it('runs every stop step and rejects with the first error when several throw', async () => {
    const part = startPart();
    await settle();
    part.unsubscribeError = 'unsubscribe refused';
    const setLoginStart = vi
      .spyOn(part.loginStart, 'set')
      .mockRejectedValue(new Error('login start refused'));

    await expect(part.harness.stop('end')).rejects.toThrow(
      'unsubscribe refused',
    );

    expect(part.lastPending()).toHaveLength(0);
    expect(setLoginStart).toHaveBeenCalledWith(false);
  });

  it('tools_AreContributedMainAgentOnly', async () => {
    const part = startPart();
    await settle();

    expect(
      part.contributions.map(({ tools, options }) => ({ tools, options })),
    ).toEqual([{ tools: TASK_TOOLS, options: { mainAgentOnly: true } }]);
  });
});

describe('demo tasks', () => {
  const DEMO_TASK_TEXT =
    'Demo tasks are samples: they never run and are never saved.';

  it('never plans, saves or fires a demo task', async () => {
    const part = startPart();
    await settle();
    const before = await part.taskFile();

    await part.enterStep();
    part.changeInstructions();
    await settle();

    expect(
      part
        .lastPending()
        ?.map((entry) => (entry.record as ScheduledRunRecord).taskId),
    ).toEqual([TASK_ID]);
    expect(await part.taskFile()).toBe(before);
    expect(part.state()?.tasks.map((view) => view.task.id)).toEqual([
      TASK_ID,
      DEMO_TASK_IDS.triage,
      DEMO_TASK_IDS.sweep,
      DEMO_TASK_IDS.dependencies,
    ]);
  });

  it.each<{
    call: 'saveTask' | 'runNow' | 'removeTask';
    args: unknown[];
  }>([
    {
      call: 'saveTask',
      args: [draftOf(task({ id: DEMO_TASK_IDS.sweep }))],
    },
    { call: 'runNow', args: [DEMO_TASK_IDS.triage] },
    { call: 'removeTask', args: [DEMO_TASK_IDS.triage] },
  ])('refuses $call of a demo task', async ({ call, args }) => {
    const part = startPart();
    await settle();
    await part.enterStep();
    await settle();
    const before = await part.taskFile();

    await expect(
      Promise.resolve().then(() => part.harness.invoke(call, ...args)),
    ).rejects.toThrow(DEMO_TASK_TEXT);
    await settle();
    expect(await part.taskFile()).toBe(before);
    expect(await part.historyFile()).toEqual([]);
  });

  it('leaves the demo tasks at dispose', async () => {
    const part = startPart();
    await settle();

    const stage = await part.enterStep();
    await settle();

    stage.dispose();
    await settle();
    expect(part.state()?.tasks.map((view) => view.task.id)).toEqual([TASK_ID]);
  });

  it('pauses a demo task through the channel without the task store', async () => {
    const part = startPart();
    await settle();
    await part.enterStep();
    await settle();
    const before = await part.taskFile();

    await part.harness.invoke('setPaused', DEMO_TASK_IDS.triage, true);
    await settle();

    expect(
      part.state()?.tasks.find((view) => view.task.id === DEMO_TASK_IDS.triage),
    ).toMatchObject({ task: { paused: true }, nextRun: null });
    expect(await part.taskFile()).toBe(before);
  });
});
