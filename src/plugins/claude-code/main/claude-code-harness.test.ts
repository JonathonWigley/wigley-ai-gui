import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough, type Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  AgentProcess,
  AgentProcessEvents,
  AgentStart,
  ChatEntry,
  HarnessProfile,
  LogInEvents,
} from '../../../contracts/agent';
import type { Clock } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import type {
  HostedExit,
  PipeDirection,
  PipeLine,
  SessionHost,
} from '../../../contracts/session-host';
import {
  createFakeSessionHost,
  type FakeSessionHost,
} from '../../../shared/fake-session-host';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  ProcessRunner,
  SpawnedProcess,
  SpawnEvents,
  SpawnExit,
} from '../../../contracts/processes';
import {
  CLAUDE_IDLE_RULE,
  createClaudeCodeHarness,
  PLAN_USAGE_TIMEOUT_MS,
} from './claude-code-harness';
import { controlMessage, controlOf, userMessage } from './claude-controls';
import {
  appCommandUuid,
  createSessionFoldState,
  replayPipeLog,
} from './session-fold';

const request: AgentStart = {
  processId: 'p-1',
  sessionId: 's-1',
  resume: false,
  projectDir: '/proj',
  profileDir: null,
  controls: {},
  instructions: [],
  idleCompactMinTokens: null,
  rowId: 'row-1',
};

// A child with `PassThrough` stdio that records its signals and stdin lines.
function fakeChild() {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const signals: string[] = [];
  const written: unknown[] = [];
  let stdinEnded = false;
  stdin.on('data', (chunk: Buffer) => {
    for (const text of chunk.toString().split('\n').filter(Boolean)) {
      written.push(JSON.parse(text));
    }
  });
  stdin.on('finish', () => {
    stdinEnded = true;
  });
  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    pid: 1,
    kill(signal: string) {
      signals.push(signal);
      return true;
    },
  });
  return {
    child: child as unknown as ChildProcessWithoutNullStreams,
    emitter,
    stdout,
    stderr,
    signals,
    written,
    isStdinEnded: () => stdinEnded,
  };
}

// `child` as a `SpawnedProcess` over `events`: its stdout and stderr `data` as
// UTF-8 text, its first `close` or `error` as the one `closed`, and `write`,
// `endInput` and `kill` passed to it.
function spawnedChild(
  child: ChildProcessWithoutNullStreams,
  events: SpawnEvents,
): SpawnedProcess {
  let hasClosed = false;
  const close = (exit: SpawnExit) => {
    if (!hasClosed) {
      hasClosed = true;
      events.closed(exit);
    }
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => events.stdout(chunk));
  child.stderr.on('data', (chunk: string) => events.stderr(chunk));
  child.on('close', (code: number | null, signal: string | null) =>
    close({ code, signal, startError: null }),
  );
  child.on('error', (error: NodeJS.ErrnoException) =>
    close({
      code: null,
      signal: null,
      startError: { message: error.message, notFound: error.code === 'ENOENT' },
    }),
  );
  return {
    write: (text) => {
      child.stdin.write(text);
    },
    endInput: () => {
      child.stdin.end();
    },
    kill: (signal = 'SIGTERM') => {
      child.kill(signal);
    },
  };
}

// A `ProcessRunner` whose `spawn` hands out `children` in order, recording each
// spawn's arguments, folder and environment in `spawned`; `run` and
// `startDetached` throw, since the harness never calls them.
function childProcesses(children: ChildProcessWithoutNullStreams[]) {
  const spawned: {
    args: readonly string[];
    options: { cwd: string; env: Readonly<Record<string, string>> };
  }[] = [];
  const queue = [...children];
  const processes: ProcessRunner & { spawned: typeof spawned } = {
    spawned,
    run: () => {
      throw new Error('the harness reached processes.run');
    },
    startDetached: () => {
      throw new Error('the harness reached processes.startDetached');
    },
    spawn(_command, args, options) {
      spawned.push({ args, options: { cwd: options.cwd, env: options.env } });
      const next = queue.shift();
      if (next === undefined) {
        throw new Error('no child left to spawn');
      }
      return spawnedChild(next, options.events);
    },
  };
  return processes;
}

const clock = { now: () => 1000 };

// A `SessionHost` whose one process is the fake child: `seq` counts over stdout
// and stderr together; `closed` fires once, on an `error` event at once.
function childHost(
  fake: ReturnType<typeof fakeChild>,
  hostClock: Clock,
  log: Log,
): SessionHost {
  return {
    spawn(hostedRequest, events) {
      const { child } = fake;
      let seq = 0;
      let hasClosed = false;
      let isDetached = false;
      const readLines = (input: Readable, dir: 'out' | 'err') => {
        createInterface({ input }).on('line', (text) => {
          seq += 1;
          if (!isDetached) {
            events.line({ seq, dir, at: hostClock.now(), text });
          }
        });
      };
      const close = (exit: HostedExit) => {
        if (hasClosed || isDetached) {
          return;
        }
        hasClosed = true;
        events.closed(exit);
      };
      readLines(child.stdout, 'out');
      readLines(child.stderr, 'err');
      child.stdin.on('error', (error) => log('claude', error.message));
      child.on('close', (code: number | null, signal: string | null) =>
        close({ code, signal, error: null }),
      );
      child.on('error', (error: Error) =>
        close({ code: null, signal: null, error: error.message }),
      );
      return {
        id: hostedRequest.id,
        pid: null,
        write(text) {
          if (!isDetached) {
            child.stdin.write(`${text}\n`);
          }
        },
        endInput() {
          if (!isDetached) {
            child.stdin.end();
          }
        },
        kill(signal) {
          if (!isDetached) {
            child.kill(signal);
          }
        },
        detach() {
          isDetached = true;
        },
      };
    },
    attach: async () => null,
    list: async () => [],
    setKeepIdleMinutes() {},
    stopAll: async () => {},
  };
}

// Every event the process emits, as `[event name, payload]`, in emit order,
// except the agent events other than `usage`, which `agentEvents` holds.
// `timeline` holds every event, those included, in emit order.
function recordingEvents() {
  const heard: [string, unknown][] = [];
  const agentEvents: AgentEvent[] = [];
  const timeline: [string, unknown][] = [];
  const hear = (name: string, payload: unknown) => {
    heard.push([name, payload]);
    timeline.push([name, payload]);
  };
  const events: AgentProcessEvents = {
    entry: (entry) => hear('entry', entry),
    controls: (controls) => hear('controls', controls),
    activity: (activity) => hear('activity', activity),
    pid: (pid) => hear('pid', pid),
    commands: (names) => hear('commands', names),
    planUsage: (update) => hear('planUsage', update),
    agentEvent: (event) => {
      if (event.type === 'usage') {
        hear('agentEvent', event);
        return;
      }
      agentEvents.push(event);
      timeline.push(['agentEvent', event]);
    },
    messageDropped: (entryId, message) =>
      hear('messageDropped', { entryId, message }),
    ended: (end) => hear('ended', end),
  };
  return { heard, agentEvents, timeline, events };
}

// Measured lines, docs/features/agent-chat/claude-stream.md § Usage and § Other events.
const REPORT_LINE =
  '{"type":"assistant","message":{"id":"msg_usage","type":"message","role":"assistant","content":[{"type":"text","text":"usage"}]},"usage_report":{"session":{"total_cost_usd":0,"model_usage":{}},"rate_limits":{"limits":[{"kind":"session","group":"session","percent":35,"resets_at":"2026-10-31T08:09:59.607264+00:00","scope":null,"severity":"normal","is_active":false},{"kind":"weekly_all","group":"weekly","percent":97,"resets_at":"2026-10-31T05:59:59.607290+00:00","scope":null,"severity":"critical","is_active":true},{"kind":"weekly_scoped","group":"weekly","percent":0,"resets_at":"2026-10-31T06:00:00+00:00","scope":{"model":{"display_name":"Fable"},"surface":null},"severity":"normal","is_active":false}],"extra_usage":{"is_enabled":false,"monthly_limit":null,"used_credits":null,"utilization":null,"currency":null}}}}';
const RATE_LIMIT_LINE =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1793426400,"rateLimitType":"seven_day","utilization":0.95,"overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.12,"resetsAt":1793434200,"status":"allowed"},"seven_day":{"utilization":0.95,"resetsAt":1793426400,"status":"allowed_warning","surpassedThreshold":0.75}},"overageEnabled":false}}';
const REPLY_LINE =
  '{"type":"assistant","message":{"model":"claude-opus-5-5","id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"stop_reason":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":2000,"cache_read_input_tokens":40000,"output_tokens":120,"cache_creation":{"ephemeral_1h_input_tokens":2000,"ephemeral_5m_input_tokens":0}}},"parent_tool_use_id":null}';
const RESULT_LINE =
  '{"type":"result","subtype":"success","is_error":false,"result":"ok","stop_reason":"end_turn","total_cost_usd":0.25,"duration_ms":1850,"num_turns":1,"modelUsage":{"claude-opus-5-5":{"contextWindow":1000000,"maxOutputTokens":64000,"costUSD":0.25,"costBasis":"list"}}}';
const CONTEXT_REPLY_LINE =
  '{"type":"control_response","response":{"subtype":"success","request_id":"wigley-2","response":{"autoCompactThreshold":967000,"autocompactSource":"model-default","maxTokens":1000000,"rawMaxTokens":1000000,"isAutoCompactEnabled":true}}}';

// A `get_context_usage` reply to `requestId` reporting `maxTokens` and `autoCompactThreshold`.
const contextReply = (
  requestId: string,
  maxTokens: number,
  autoCompactThreshold: number,
) => ({
  type: 'control_response',
  response: {
    subtype: 'success',
    request_id: requestId,
    response: { autoCompactThreshold, maxTokens },
  },
});

const contextUsageRequest = (requestId: string) => ({
  type: 'control_request',
  request_id: requestId,
  request: { subtype: 'get_context_usage' },
});

const settingsRequest = (requestId: string) => ({
  type: 'control_request',
  request_id: requestId,
  request: { subtype: 'get_settings' },
});

// A `get_settings` reply to `requestId`, its values nested as the CLI nests them.
const settingsReply = (
  requestId: string,
  applied: { model: string; effort: string | null },
) => ({
  type: 'control_response',
  response: {
    subtype: 'success',
    request_id: requestId,
    response: { effective: {}, sources: [], applied },
  },
});

const initializeRequest = (requestId: string) => ({
  type: 'control_request',
  request_id: requestId,
  request: { subtype: 'initialize' },
});

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function started(
  fake = fakeChild(),
  files: Files = createMemoryFiles(),
  harnessClock: Clock = clock,
  startRequest: AgentStart = request,
) {
  const logged: [string, string][] = [];
  let uuidCount = 0;
  const log: Log = (source, message) => logged.push([source, message]);
  const harness = createClaudeCodeHarness({
    command: () => '/bin/claude',
    permissionTool: 'tool',
    profiles: () => [],
    env: {},
    log,
    host: childHost(fake, harnessClock, log),
    processes: childProcesses([fake.child]),
    files,
    homeDir: '/Users/u',
    paths: posixPaths,
    clock: harnessClock,
    randomUuid: () => {
      uuidCount += 1;
      return `uuid-${uuidCount}`;
    },
  });
  const { heard, agentEvents, timeline, events } = recordingEvents();
  const agent = harness.start(startRequest, events);
  return { ...fake, agent, heard, agentEvents, timeline, logged };
}

// A started process with its start events settled and cleared.
async function startedQuiet() {
  const run = started();
  await settle();
  run.heard.length = 0;
  return run;
}

function writeLine(stream: PassThrough, event: object) {
  stream.write(`${JSON.stringify(event)}\n`);
}

const errorResult = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  result: 'boom',
};

// A success `result`; `uuids` name the messages its turn took in, the opener
// first.
function successResult(result: string, uuids: string[] = []) {
  const taken =
    uuids.length === 0
      ? {}
      : { user_message_uuid: uuids[0], user_message_uuids: uuids };
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    total_cost_usd: 0,
    num_turns: 0,
    ...taken,
  };
}

const lifecycleInit = {
  type: 'system',
  subtype: 'init',
  capabilities: ['msg_lifecycle_v1'],
};

// An init from a Claude Code version with no message lifecycle.
const plainInit = { type: 'system', subtype: 'init' };

const lifecycle = (uuid: string, state: string) => ({
  type: 'command_lifecycle',
  command_uuid: uuid,
  state,
});

const ownTurnResult = {
  ...successResult('background done'),
  origin: { kind: 'task-notification' },
};

const GRACE_NOTICE =
  'Claude did not stop within 5 s; showing the session idle.';

function noticeTexts(heard: [string, unknown][]) {
  return heard
    .map(([, payload]) => payload as { kind?: string; text?: string })
    .filter((entry) => entry.kind === 'notice')
    .map((entry) => entry.text);
}

function activities(heard: [string, unknown][]) {
  return heard.filter(([name]) => name === 'activity').map(([, a]) => a);
}

function interruptRequests(written: unknown[]) {
  return written.filter(
    (line) =>
      (line as { request?: { subtype?: string } }).request?.subtype ===
      'interrupt',
  );
}

function lastActivity(heard: [string, unknown][]) {
  return heard.filter(([name]) => name === 'activity').at(-1)?.[1];
}

// The effort value the last `controls` emission reported.
function effortValue(heard: [string, unknown][]) {
  const controls = heard.filter(([name]) => name === 'controls').at(-1)?.[1] as
    | { id: string; value: string | null }[]
    | undefined;
  return controls?.find((control) => control.id === 'effort')?.value ?? null;
}

function resultEntries(heard: [string, unknown][]) {
  return heard.filter(
    ([name, payload]) =>
      name === 'entry' && (payload as { kind: string }).kind === 'result',
  );
}

afterEach(() => {
  vi.useRealTimers();
});

const SAVED_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const TRANSCRIPT = `/Users/u/.claude/projects/-proj/${SAVED_ID}.jsonl`;
const resumeRequest: AgentStart = {
  ...request,
  sessionId: SAVED_ID,
  resume: true,
};
// A saved main reply of 12123 tokens that wrote the 1 h cache.
const SAVED_REPLY_LINE = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-10-27T16:07:09.193Z',
  message: {
    model: 'claude-opus-5-5',
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: {
      input_tokens: 3,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 10000,
      output_tokens: 120,
      cache_creation: { ephemeral_1h_input_tokens: 2000 },
    },
  },
});

// A harness that starts no process, for its declarations and file reads.
function idleHarness(
  homeDir = '/Users/u',
  files: Files = createMemoryFiles(),
  log: Log = () => {},
  profiles: () => readonly HarnessProfile[] = () => [],
) {
  return createClaudeCodeHarness({
    command: () => '/bin/claude',
    permissionTool: 'tool',
    profiles,
    env: { CLAUDE_CONFIG_DIR: '/c' },
    log,
    host: createFakeSessionHost(clock),
    processes: childProcesses([fakeChild().child]),
    files,
    homeDir,
    paths: posixPaths,
    clock,
    randomUuid: () => 'uuid-1',
  });
}

describe('createClaudeCodeHarness declarations', () => {
  it('info_DeclaresCapabilitiesAliasesAndProjectFolder', () => {
    const work = [{ name: 'work', configDir: '~/.claude' }];
    const harness = idleHarness(undefined, undefined, undefined, () => work);

    expect(harness.info()).toEqual({
      label: 'Claude Code',
      capabilities: {
        interrupt: true,
        resume: true,
        images: true,
        midTurnSend: true,
      },
      clearAliases: ['reset', 'new'],
      projectConfigFolder: '.claude',
      profiles: [{ name: 'work', configDir: '~/.claude' }],
    });
  });

  it('info_Profiles_ReadAtEachCall', () => {
    let profiles: readonly HarnessProfile[] = [];
    const harness = idleHarness(undefined, undefined, undefined, () => profiles);
    expect(harness.info().profiles).toEqual([]);

    profiles = [{ name: 'lab', configDir: '~/.lab' }];

    expect(harness.info().profiles).toEqual([
      { name: 'lab', configDir: '~/.lab' },
    ]);
  });

  it('controls_BeforeStart_DeclaresClaudesControls', () => {
    const controls = idleHarness().controls(null);

    expect(
      controls.map(({ id, label, role, value }) => ({
        id,
        label,
        role,
        value,
      })),
    ).toEqual([
      { id: 'mode', label: 'Mode', role: 'permissionMode', value: 'auto' },
      { id: 'effort', label: 'Effort', role: 'effort', value: null },
      { id: 'model', label: 'Model', role: 'model', value: null },
    ]);
    for (const control of controls) {
      expect(control.choices).toEqual(controlOf(control.id)?.choices);
    }
  });

  it.each<{ meta: Record<string, unknown> | null; expected: string | null }>([
    { meta: { 'claudecode/toolUseId': 'toolu_1' }, expected: 'toolu_1' },
    { meta: null, expected: null },
    { meta: {}, expected: null },
    { meta: { 'claudecode/toolUseId': 7 }, expected: null },
  ])('toolUseIdOf_ReadsClaudesMetaKey ($meta)', ({ meta, expected }) => {
    expect(idleHarness().toolUseIdOf(meta)).toBe(expected);
  });

  it.each([
    { profileDir: '~/work-claude', configDir: '/home/u/work-claude' },
    { profileDir: '/abs/dir', configDir: '/abs/dir' },
    { profileDir: null, configDir: '/home/u/.claude' },
  ])(
    'configRoots_ResolvesTheProfileFolder ($profileDir)',
    ({ profileDir, configDir }) => {
      expect(idleHarness('/home/u').configRoots(profileDir)).toEqual({
        configDir,
        pluginCacheDirs: [`${configDir}/plugins/cache`],
      });
    },
  );

  it('installedPlugins_ReadsTheProfilesFile', async () => {
    const files = createMemoryFiles();
    const installed = '/home/u/work-claude/plugins/installed_plugins.json';
    await files.write(
      installed,
      [
        '{',
        '  "plugins": {',
        '    "p@m": [',
        '      { "scope": "user", "installPath": "/cache/p/1.0", "version": "1.0" },',
        '      { "scope": "project", "projectPath": "/repo", "installPath": "/cache/p/2.0" }',
        '    ]',
        '  }',
        '}',
      ].join('\n'),
    );
    const harness = idleHarness('/home/u', files);

    expect(await harness.installedPlugins('~/work-claude')).toEqual([
      {
        key: 'p@m',
        installDir: '/cache/p/1.0',
        version: '1.0',
        listedAt: { path: installed, line: 3 },
      },
      {
        key: 'p@m',
        installDir: '/cache/p/2.0',
        version: null,
        listedAt: { path: installed, line: 3 },
      },
    ]);
    expect(await harness.installedPlugins(null)).toEqual([]);
  });
});

describe('createClaudeCodeHarness', () => {
  it('start_EmitsLaunchedControlsThenIdle', async () => {
    const run = started();
    expect(run.heard).toEqual([]);

    await settle();

    expect(run.heard[0][0]).toBe('controls');
    const controls = run.heard[0][1] as { id: string; value: unknown }[];
    expect(controls.map((control) => [control.id, control.value])).toEqual([
      ['mode', 'auto'],
      ['effort', null],
      ['model', null],
    ]);
    expect(run.heard[1]).toEqual(['activity', 'idle']);
  });

  it.each([
    {
      case: 'a resume holding no mode',
      resume: true,
      controls: {},
      seeded: { mode: 'auto', effort: null, model: null },
    },
    {
      case: 'a held model',
      resume: false,
      controls: { model: 'sonnet' },
      seeded: { mode: 'auto', effort: null, model: 'sonnet' },
    },
    {
      case: 'a held mode',
      resume: false,
      controls: { mode: 'plan', effort: 'low' },
      seeded: { mode: 'plan', effort: 'low', model: null },
    },
  ] as {
    case: string;
    resume: boolean;
    controls: Record<string, string>;
    seeded: Record<string, string | null>;
  }[])(
    'start_RequestControls_SeedStartingValues ($case)',
    async ({ resume, controls, seeded }) => {
      const run = started(fakeChild(), createMemoryFiles(), clock, {
        ...request,
        resume,
        controls,
      });

      await settle();

      expect(run.heard[0][0]).toBe('controls');
      const heard = run.heard[0][1] as { id: string; value: unknown }[];
      expect(
        Object.fromEntries(heard.map(({ id, value }) => [id, value])),
      ).toEqual(seeded);
    },
  );

  it('start_Opens_WritesInitializeThenContextThenSettingsRequest', async () => {
    const run = await startedQuiet();

    expect(run.written).toEqual([
      initializeRequest('wigley-1'),
      contextUsageRequest('wigley-2'),
      settingsRequest('wigley-3'),
    ]);
  });

  it('send_WritesUserMessageAndEmitsWorking', async () => {
    const run = await startedQuiet();

    run.agent.send({ text: 'hi', images: [] });
    await settle();

    const message = userMessage({ text: 'hi', images: [] }, 'uuid-1');
    expect(run.written).toEqual([
      initializeRequest('wigley-1'),
      contextUsageRequest('wigley-2'),
      settingsRequest('wigley-3'),
      message,
    ]);
    expect(run.heard).toEqual([['activity', 'working']]);
  });

  it('send_Now_WritesThePriorityNowMessage', async () => {
    const run = await startedQuiet();

    run.agent.send({ text: 'hi', images: [] }, { now: true });
    await settle();

    expect(run.written.at(-1)).toEqual({
      ...(userMessage({ text: 'hi', images: [] }, 'uuid-1') as object),
      priority: 'now',
    });
  });

  // The timeline's user entries, user-message and skill events, drops and
  // activity, each as a short tuple.
  function sendTimeline(timeline: [string, unknown][]): unknown[][] {
    return timeline.flatMap(([name, payload]) => {
      const event = payload as {
        kind?: string;
        type?: string;
        id?: string;
        at?: number;
        skill?: string;
      };
      if (name === 'entry' && event.kind === 'user') {
        return [['entry', event.id, event.at]];
      }
      if (name === 'agentEvent' && event.type === 'userMessage') {
        return [['userMessage', event.at]];
      }
      if (name === 'agentEvent' && event.type === 'skillStarted') {
        return [['skillStarted', event.skill, event.at]];
      }
      if (name === 'messageDropped' || name === 'activity') {
        return [[name, payload]];
      }
      return [];
    });
  }

  // `abandon` interrupts and lets the grace run out; `close` ends the process.
  type SendStep = object | 'abandon' | 'close';

  // `init` is the line read before the sends, null for none; one message is
  // sent per text.
  it.each<{
    name: string;
    init: object | null;
    texts: string[];
    after: SendStep[];
    atWrite: unknown[][];
    expected: unknown[][];
  }>([
    {
      name: 'lifecycle, started',
      init: lifecycleInit,
      texts: ['hi'],
      after: [lifecycle('uuid-1', 'queued'), lifecycle('uuid-1', 'started')],
      atWrite: [],
      expected: [
        ['entry', 'user-1', 2000],
        ['userMessage', 2000],
      ],
    },
    {
      name: 'lifecycle, typed skill, started',
      init: lifecycleInit,
      texts: ['/wigley:feature'],
      after: [lifecycle('uuid-1', 'started')],
      atWrite: [],
      expected: [
        ['entry', 'user-1', 2000],
        ['userMessage', 2000],
        ['skillStarted', 'wigley:feature', 2000],
      ],
    },
    ...['cancelled', 'discarded', 'refused'].map((state) => ({
      name: `lifecycle, ${state} before started`,
      init: lifecycleInit,
      texts: ['hi'],
      after: [
        successResult('turn'),
        lifecycle('uuid-1', 'queued'),
        lifecycle('uuid-1', state),
      ],
      atWrite: [],
      expected: [
        [
          'messageDropped',
          { entryId: 'user-1', message: { text: 'hi', images: [] } },
        ],
        ['activity', 'idle'],
      ],
    })),
    {
      name: 'lifecycle, started after the interrupt grace',
      init: lifecycleInit,
      texts: ['hi'],
      after: ['abandon', lifecycle('uuid-1', 'started')],
      atWrite: [],
      expected: [
        ['activity', 'idle'],
        ['entry', 'user-1', 2000],
        ['userMessage', 2000],
      ],
    },
    {
      name: 'lifecycle, process ends holding the message',
      init: lifecycleInit,
      texts: ['hi'],
      after: ['close', lifecycle('uuid-1', 'started')],
      atWrite: [],
      expected: [['activity', 'idle']],
    },
    {
      name: 'fallback',
      init: plainInit,
      texts: ['hi'],
      after: [],
      atWrite: [
        ['entry', 'user-1', 1000],
        ['userMessage', 1000],
      ],
      expected: [],
    },
    ...[
      [lifecycle('uuid-1', 'started'), lifecycleInit],
      [lifecycleInit, lifecycle('uuid-1', 'started')],
    ].map((after, index) => ({
      name: `before any init, lifecycle, started ${index === 0 ? 'before' : 'after'} the init`,
      init: null,
      texts: ['hi'],
      after,
      atWrite: [['activity', 'working']],
      expected: [
        ['entry', 'user-1', 2000],
        ['userMessage', 2000],
      ],
    })),
    {
      name: 'before any init, fallback',
      init: null,
      texts: ['hi', 'there'],
      after: [plainInit],
      atWrite: [['activity', 'working']],
      expected: [
        ['entry', 'user-1', 2000],
        ['userMessage', 2000],
        ['entry', 'user-2', 2000],
        ['userMessage', 2000],
      ],
    },
  ])(
    'send_DuringATurn_EmitsTheUserEntryWhenTakenIn ($name)',
    async ({ init, texts, after, atWrite, expected }) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let now = 1000;
      const run = started(fakeChild(), createMemoryFiles(), {
        now: () => now,
      });
      if (init !== null) {
        writeLine(run.stdout, init);
      }
      await settle();
      run.timeline.length = 0;

      const entryIds = texts.map((text) =>
        run.agent.send({ text, images: [] }),
      );
      await settle();
      const heardAtWrite = sendTimeline(run.timeline);
      run.timeline.length = 0;
      now = 2000;
      for (const step of after) {
        if (step === 'abandon') {
          run.agent.interrupt();
          vi.advanceTimersByTime(5000);
        } else if (step === 'close') {
          run.emitter.emit('close', 0, null);
        } else {
          writeLine(run.stdout, step);
        }
        await settle();
      }

      expect(entryIds).toEqual(texts.map((_, index) => `user-${index + 1}`));
      expect(heardAtWrite).toEqual(atWrite);
      expect(sendTimeline(run.timeline)).toEqual(expected);
    },
  );

  it('setControl_Mode_WritesRequestAndReportsOnResponse', async () => {
    const run = await startedQuiet();

    run.agent.setControl('mode', 'plan');
    writeLine(run.stdout, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'wigley-4',
        response: { mode: 'plan' },
      },
    });
    await settle();

    expect(run.written).toEqual([
      initializeRequest('wigley-1'),
      contextUsageRequest('wigley-2'),
      settingsRequest('wigley-3'),
      controlMessage('mode', 'plan', 'wigley-4'),
    ]);
    const [name, controls] = run.heard[run.heard.length - 1];
    expect(name).toBe('controls');
    expect(controls).toContainEqual(
      expect.objectContaining({ id: 'mode', value: 'plan' }),
    );
  });

  it('setControl_EffortWhileWorking_Throws', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'hi', images: [] });

    expect(() => run.agent.setControl('effort', 'high')).toThrow(
      'Claude is working; change Effort when the turn ends',
    );
  });

  it('setControl_Effort_SetsValueOnCommandResult', async () => {
    const run = await startedQuiet();

    run.agent.setControl('effort', 'high');
    writeLine(run.stdout, {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Set effort level to high',
      total_cost_usd: 0,
      num_turns: 0,
    });
    await settle();

    expect(run.written).toEqual([
      initializeRequest('wigley-1'),
      contextUsageRequest('wigley-2'),
      settingsRequest('wigley-3'),
      controlMessage('effort', 'high', '00000000-1'),
      contextUsageRequest('wigley-4'),
      settingsRequest('wigley-5'),
    ]);
    expect(
      run.heard.some(
        ([, payload]) => (payload as { kind?: string }).kind === 'result',
      ),
    ).toBe(false);
    const controls = run.heard.find(([name]) => name === 'controls')?.[1];
    expect(controls).toContainEqual(
      expect.objectContaining({ id: 'effort', value: 'high' }),
    );
    expect(run.heard[run.heard.length - 1]).toEqual(['activity', 'idle']);
  });

  it('setControl_ModelFromInitialize_WritesTheCommand', async () => {
    const run = await startedQuiet();
    writeLine(run.stdout, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'wigley-1',
        response: {
          commands: [],
          models: [
            { value: 'opus[1m]', displayName: 'Opus 1M', description: '' },
          ],
        },
      },
    });
    await settle();

    run.agent.setControl('model', 'opus[1m]');
    await settle();

    expect(run.written.at(-1)).toEqual(
      controlMessage('model', 'opus[1m]', '00000000-1'),
    );
    expect(() => run.agent.setControl('model', 'nope')).toThrow(
      'Claude Code control model has no choice nope',
    );
  });

  it('interrupt_AfterErrorResult_UsesDistinctNoticeIds', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    writeLine(run.stdout, errorResult);
    await settle();
    run.agent.send({ text: 'two', images: [] });

    run.agent.interrupt();
    await settle();

    const noticeIds = run.heard
      .map(([, payload]) => payload as { kind?: string; id?: string })
      .filter((entry) => entry.kind === 'notice')
      .map((entry) => entry.id);
    expect(noticeIds).toEqual(['notice-1', 'control-notice-1']);
    expect(run.written[7]).toEqual({
      type: 'control_request',
      request_id: 'wigley-6',
      request: { subtype: 'interrupt' },
    });
  });

  it('start_Turn_EmitsUsageEventsAndAsksContextUsage', async () => {
    const files = createMemoryFiles();
    await files.write(
      '/Users/u/.claude/settings.json',
      '{"env":{"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE":"30"}}',
    );
    const run = started(fakeChild(), files);
    await settle();
    run.agent.send({ text: 'hi', images: [] });

    for (const text of [CONTEXT_REPLY_LINE, REPLY_LINE, RESULT_LINE]) {
      run.stdout.write(`${text}\n`);
    }
    writeLine(run.stdout, contextReply('wigley-4', 200_000, 167_000));
    await settle();

    // A new session knows its context from the start: the settings read and
    // the start's `get_context_usage` reply each report 0 tokens.
    const settingsRead = {
      type: 'usage',
      agentId: 'main',
      at: 1000,
      contextTokens: 0,
      contextWindow: null,
      autocompact: { configured: null, reported: null },
      cacheExpiresAt: null,
      spendUsd: null,
    };
    const contextReplied = {
      ...settingsRead,
      contextWindow: 1000000,
      autocompact: { configured: 300000, reported: 967000 },
    };
    const first = {
      ...contextReplied,
      contextTokens: 42123,
      cacheExpiresAt: 3601000,
    };
    const second = { ...first, spendUsd: 0.25 };
    const third = {
      ...second,
      contextWindow: 200000,
      autocompact: { configured: 60000, reported: 167000 },
    };
    expect(
      run.heard
        .filter(([name]) => name === 'agentEvent')
        .map(([, event]) => event),
    ).toEqual([settingsRead, contextReplied, first, second, third]);
    expect(run.written).toEqual([
      initializeRequest('wigley-1'),
      contextUsageRequest('wigley-2'),
      settingsRequest('wigley-3'),
      userMessage({ text: 'hi', images: [] }, 'uuid-1'),
      contextUsageRequest('wigley-4'),
      settingsRequest('wigley-5'),
    ]);
  });

  describe('usage reads', () => {
    const SAVED_USER_LINE = JSON.stringify({
      type: 'user',
      timestamp: '2026-10-27T16:07:00.000Z',
      message: { role: 'user', content: 'hi' },
    });
    const seeded = (contextTokens: number, cacheExpiresAt: number | null) => ({
      type: 'usage',
      agentId: 'main',
      at: 1000,
      contextTokens,
      contextWindow: null,
      autocompact: { configured: null, reported: null },
      cacheExpiresAt,
      spendUsd: null,
    });

    // Memory files holding `text` at `heldPath`, whose read of that path waits
    // for `release`.
    async function heldRead(heldPath: string, text: string) {
      const stored = createMemoryFiles();
      await stored.write(heldPath, text);
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const files: Files = {
        ...stored,
        read: async (path) => {
          if (path === heldPath) {
            await gate;
          }
          return stored.read(path);
        },
      };
      return { files, release: () => release() };
    }

    const usageEvents = (heard: [string, unknown][]) =>
      heard.filter(([name]) => name === 'agentEvent').map(([, event]) => event);

    it.each([
      {
        name: 'MainReplies_SeedsTheirContext',
        lines: [SAVED_USER_LINE, SAVED_REPLY_LINE],
        expected: [seeded(12123, 1793120829193)],
      },
      {
        name: 'NoMainReply_ZeroTokens',
        lines: [SAVED_USER_LINE],
        expected: [seeded(0, null)],
      },
    ])('start_Resumed_$name', async ({ lines, expected }) => {
      const files = createMemoryFiles();
      await files.write(TRANSCRIPT, lines.join('\n'));

      const run = started(fakeChild(), files, clock, resumeRequest);
      await settle();

      expect(usageEvents(run.heard)).toEqual(expected);
    });

    it('start_ResumedLiveReplyBeforeTheRead_KeepsTheLiveContext', async () => {
      const held = await heldRead(TRANSCRIPT, SAVED_REPLY_LINE);
      const run = started(fakeChild(), held.files, clock, resumeRequest);
      await settle();

      run.stdout.write(`${REPLY_LINE}\n`);
      await settle();
      held.release();
      await settle();

      expect(usageEvents(run.heard)).toEqual([seeded(42123, 3601000)]);
    });

    it('start_ResumedReadRejects_LogsAndEmitsNothingBeforeAReply', async () => {
      const run = started(
        fakeChild(),
        createMemoryFiles(),
        clock,
        resumeRequest,
      );
      await settle();

      run.stdout.write(`${CONTEXT_REPLY_LINE}\n`);
      await settle();

      expect(usageEvents(run.heard)).toEqual([]);
      expect(run.logged).toContainEqual([
        'claude',
        expect.stringMatching(/^saved usage not read: .*\.jsonl/),
      ]);
    });

    const SETTINGS = '/Users/u/.claude/settings.json';
    const spawnError = new Error('spawn /bin/claude ENOENT');
    it.each([
      {
        name: 'start_ResumedReadSettlesAfterClose_EmitsNothing',
        startRequest: resumeRequest,
        heldPath: TRANSCRIPT,
        heldText: SAVED_REPLY_LINE,
        pid: 1,
        end: (emitter: EventEmitter) => emitter.emit('close', 0, null),
      },
      {
        name: 'start_ResumedReadSettlesAfterSpawnedChildError_EmitsNothing',
        startRequest: resumeRequest,
        heldPath: TRANSCRIPT,
        heldText: SAVED_REPLY_LINE,
        pid: 1,
        end: (emitter: EventEmitter) => emitter.emit('error', spawnError),
      },
      {
        name: 'start_NewSettingsReadSettlesAfterClose_EmitsNothing',
        startRequest: request,
        heldPath: SETTINGS,
        heldText: '{}',
        pid: 1,
        end: (emitter: EventEmitter) => emitter.emit('close', 0, null),
      },
      {
        name: 'start_NewSettingsReadSettlesAfterSpawnNotFound_EmitsNothing',
        startRequest: request,
        heldPath: SETTINGS,
        heldText: '{}',
        pid: undefined,
        end: (emitter: EventEmitter) => emitter.emit('error', spawnError),
      },
    ])('$name', async ({ startRequest, heldPath, heldText, pid, end }) => {
      const held = await heldRead(heldPath, heldText);
      const fake = fakeChild();
      (fake.child as { pid: number | undefined }).pid = pid;
      const run = started(fake, held.files, clock, startRequest);
      await settle();

      end(run.emitter);
      held.release();
      await settle();

      expect(usageEvents(run.heard)).toEqual([]);
    });
  });

  it('controlResponse_OwnContextUsageReply_StaysOutOfTurnEvents', async () => {
    const run = await startedQuiet();
    run.agent.setControl('mode', 'plan');
    const modeReply = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'wigley-4',
        response: { mode: 'plan' },
      },
    };

    run.stdout.write(`${CONTEXT_REPLY_LINE}\n`);
    writeLine(run.stdout, modeReply);
    await settle();

    const raws = run.heard
      .filter(([name]) => name === 'entry')
      .flatMap(([, entry]) => (entry as { raw: unknown[] }).raw);
    expect(raws).toEqual([modeReply]);
  });

  it('start_RateLimitEvent_EmitsPlanUsage', async () => {
    const run = await startedQuiet();

    run.stdout.write(`${RATE_LIMIT_LINE}\n`);
    await settle();

    expect(run.heard.filter(([name]) => name === 'planUsage')).toEqual([
      [
        'planUsage',
        {
          rows: [
            {
              kind: 'session',
              percent: 12,
              resetsAt: 1793434200000,
              severity: 'normal',
            },
            {
              kind: 'weekly_all',
              percent: 95,
              resetsAt: 1793426400000,
              severity: 'warning',
            },
          ],
          at: 1000,
        },
      ],
    ]);
  });

  describe('interrupt with background tasks', () => {
    const tasksChanged = (taskIds: string[]) => ({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: taskIds.map((task_id) => ({ task_id, task_type: 'local_bash' })),
    });
    const stopRequests = (written: unknown[]) =>
      written
        .map((line) => (line as { request?: Record<string, unknown> }).request)
        .filter((request) => request?.subtype === 'stop_task')
        .map((request) => request?.task_id);

    it.each([
      { given: 'idle', isWorking: false },
      { given: 'working', isWorking: true },
    ])(
      'interrupt_TasksRunning_InterruptsThenStopsEachTask ($given)',
      async ({ isWorking }) => {
        const run = await startedQuiet();
        writeLine(run.stdout, tasksChanged(['a1', 'b1']));
        await settle();
        if (isWorking) {
          run.agent.send({ text: 'one', images: [] });
        }
        const before = run.written.length;

        run.agent.interrupt();

        const written = run.written.slice(before);
        expect(
          (written[0] as { request: { subtype: string } }).request.subtype,
        ).toBe('interrupt');
        expect(stopRequests(written)).toEqual(['a1', 'b1']);
      },
    );

    it('interrupt_TasksAllEnded_WritesNothingWhileIdle', async () => {
      const run = await startedQuiet();
      writeLine(run.stdout, tasksChanged(['b1']));
      writeLine(run.stdout, tasksChanged([]));
      await settle();
      const before = run.written.length;

      run.agent.interrupt();

      expect(run.written.slice(before)).toEqual([]);
    });
  });

  it('send_TwoMessages_StaysWorkingUntilTheSecondResult', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    run.agent.send({ text: 'two', images: [] });

    writeLine(run.stdout, lifecycleInit);
    writeLine(run.stdout, successResult('1', ['uuid-1']));
    await settle();
    expect(lastActivity(run.heard)).toBe('working');

    writeLine(run.stdout, lifecycleInit);
    writeLine(run.stdout, successResult('2', ['uuid-2']));
    await settle();
    expect(lastActivity(run.heard)).toBe('idle');
  });

  it('interrupt_WhileQueuedTurnRuns_WritesRequest', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    run.agent.send({ text: 'two', images: [] });
    writeLine(run.stdout, lifecycleInit);
    writeLine(run.stdout, successResult('1', ['uuid-1']));
    await settle();

    run.agent.interrupt();

    expect(run.written[7]).toEqual({
      type: 'control_request',
      request_id: 'wigley-6',
      request: { subtype: 'interrupt' },
    });
  });

  it('send_ControlCommandQueuedBehindTurn_TakesItsOwnResult', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    run.agent.send({ text: '/effort high', images: [] });

    writeLine(run.stdout, lifecycleInit);
    writeLine(run.stdout, successResult('1', ['uuid-1']));
    await settle();
    expect(effortValue(run.heard)).toBeNull();
    expect(resultEntries(run.heard)).toHaveLength(1);

    writeLine(run.stdout, lifecycleInit);
    writeLine(
      run.stdout,
      successResult('Set effort level to high', ['uuid-2']),
    );
    await settle();

    expect(effortValue(run.heard)).toBe('high');
    expect(resultEntries(run.heard)).toHaveLength(1);
    expect(lastActivity(run.heard)).toBe('idle');
  });

  it.each([
    { kind: 'peer', from: 'a5d2bf79d0e109653', handback: true },
    { kind: 'task-notification', producer: 'session-task' },
  ])(
    'send_UnrequestedResultWhileCommandPending_CommandTakesItsOwnResult (origin $kind)',
    async (origin) => {
      const run = await startedQuiet();
      run.agent.send({ text: '/effort high', images: [] });

      writeLine(run.stdout, lifecycleInit);
      writeLine(run.stdout, { ...successResult('done'), origin });
      await settle();
      expect(lastActivity(run.heard)).toBe('working');
      expect(effortValue(run.heard)).toBeNull();
      expect(resultEntries(run.heard)).toHaveLength(1);

      writeLine(run.stdout, lifecycleInit);
      writeLine(
        run.stdout,
        successResult('Set effort level to high', ['uuid-1']),
      );
      await settle();
      expect(effortValue(run.heard)).toBe('high');
      expect(resultEntries(run.heard)).toHaveLength(1);
      expect(lastActivity(run.heard)).toBe('idle');
    },
  );

  it('send_EffortAuto_ClearsEffort', async () => {
    const run = await startedQuiet();
    run.agent.setControl('effort', 'high');
    writeLine(run.stdout, successResult('Set effort level to high'));
    await settle();
    expect(effortValue(run.heard)).toBe('high');

    run.agent.send({ text: '/effort auto', images: [] });
    writeLine(run.stdout, successResult('Set effort level to auto'));
    await settle();

    expect(effortValue(run.heard)).toBeNull();
  });

  it.each([
    { mode: 'lifecycle', init: lifecycleInit, withLifecycle: true },
    { mode: 'fallback', init: plainInit, withLifecycle: false },
  ])(
    'activity_MessageFoldedIntoClaudesOwnTurn_EndsIdle ($mode)',
    async ({ init, withLifecycle }) => {
      const run = await startedQuiet();
      run.agent.send({ text: 'one', images: [] });
      writeLine(run.stdout, init);
      writeLine(run.stdout, successResult('1', ['uuid-1']));
      await settle();
      expect(lastActivity(run.heard)).toBe('idle');

      run.agent.send({ text: 'two', images: [] });
      writeLine(run.stdout, init);
      if (withLifecycle) {
        for (const state of ['queued', 'started', 'completed']) {
          writeLine(run.stdout, lifecycle('uuid-2', state));
        }
      }
      writeLine(run.stdout, ownTurnResult);
      await settle();

      expect(lastActivity(run.heard)).toBe('idle');
    },
  );

  it('activity_ClaudesOwnTurn_ShowsWorkingThenIdle', async () => {
    const run = await startedQuiet();

    writeLine(run.stdout, lifecycleInit);
    await settle();
    expect(lastActivity(run.heard)).toBe('working');

    writeLine(run.stdout, ownTurnResult);
    await settle();
    expect(lastActivity(run.heard)).toBe('idle');
  });

  // The interrupted turn's result, naming the first message as its opener.
  const interruptedResult = {
    ...errorResult,
    user_message_uuid: 'uuid-1',
    user_message_uuids: ['uuid-1'],
  };

  const interruptReply = (error: string | null) =>
    error === null
      ? {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: 'wigley-4',
            response: { still_queued: [] },
          },
        }
      : {
          type: 'control_response',
          response: { subtype: 'error', request_id: 'wigley-4', error },
        };

  it.each([
    {
      name: 'no turn, success',
      turnOpen: false,
      error: null,
      notice: null,
    },
    {
      name: 'no turn, error',
      turnOpen: false,
      error: 'busy',
      notice: 'Could not interrupt: busy',
    },
    { name: 'turn open', turnOpen: true, error: null, notice: null },
  ])(
    'interrupt_Answered_EndsIdleOnlyWhenNoTurnIsOpen ($name)',
    async ({ turnOpen, error, notice }) => {
      const run = await startedQuiet();
      if (turnOpen) {
        writeLine(run.stdout, lifecycleInit);
        await settle();
      }
      run.agent.send({ text: 'one', images: [] });

      run.agent.interrupt();
      writeLine(run.stdout, interruptReply(error));
      await settle();

      if (notice !== null) {
        expect(noticeTexts(run.heard)).toContain(notice);
      }
      if (!turnOpen) {
        expect(lastActivity(run.heard)).toBe('idle');
        return;
      }
      expect(lastActivity(run.heard)).toBe('working');
      writeLine(run.stdout, interruptedResult);
      await settle();
      expect(lastActivity(run.heard)).toBe('idle');
    },
  );

  it.each([
    { advanceMs: 5000, activity: 'idle', hasNotice: true },
    { advanceMs: 4999, activity: 'working', hasNotice: false },
  ])(
    'interrupt_UnansweredForTheGrace_ShowsIdleWithNotice ($advanceMs ms)',
    async ({ advanceMs, activity, hasNotice }) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = await startedQuiet();
      run.agent.send({ text: 'one', images: [] });
      run.agent.interrupt();
      await settle();

      vi.advanceTimersByTime(advanceMs);
      await settle();

      expect(lastActivity(run.heard)).toBe(activity);
      expect(noticeTexts(run.heard).includes(GRACE_NOTICE)).toBe(hasNotice);
    },
  );

  it.each<{
    name: string;
    texts: string[];
    lines: object[];
    activities: string[];
  }>([
    {
      name: 'the only message',
      texts: ['one'],
      lines: [errorResult],
      activities: ['working', 'idle'],
    },
    {
      name: 'a message queued behind',
      texts: ['one', 'two'],
      lines: [lifecycleInit, interruptedResult],
      activities: ['working'],
    },
  ])(
    'interrupt_AnsweredWithinTheGrace_PostsNoGraceNotice ($name)',
    async ({ texts, lines, activities: expected }) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = await startedQuiet();
      for (const text of texts) {
        run.agent.send({ text, images: [] });
      }
      run.agent.interrupt();
      for (const turnLine of lines) {
        writeLine(run.stdout, turnLine);
      }
      await settle();

      vi.advanceTimersByTime(5000);
      await settle();

      expect(noticeTexts(run.heard)).not.toContain(GRACE_NOTICE);
      expect(activities(run.heard)).toEqual(expected);
    },
  );

  it.each<{
    name: string;
    texts: string[];
    lines: object[];
    textsAfter: string[];
    isKilled: boolean;
  }>([
    {
      name: 'unanswered',
      texts: ['one'],
      lines: [],
      textsAfter: [],
      isKilled: true,
    },
    {
      name: 'first answered',
      texts: ['one'],
      lines: [errorResult],
      textsAfter: ['two'],
      isKilled: false,
    },
    {
      name: 'answered with nothing running',
      texts: ['one'],
      lines: [interruptReply(null)],
      textsAfter: ['two'],
      isKilled: false,
    },
    {
      name: 'first turn ended, a message queued behind',
      texts: ['one', 'two'],
      lines: [lifecycleInit, interruptedResult],
      textsAfter: [],
      isKilled: false,
    },
  ])(
    'interrupt_SecondWhileWorking_KillsTheProcess ($name)',
    async ({ texts, lines, textsAfter, isKilled }) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = await startedQuiet();
      for (const text of texts) {
        run.agent.send({ text, images: [] });
      }
      run.agent.interrupt();
      for (const turnLine of lines) {
        writeLine(run.stdout, turnLine);
      }
      await settle();
      for (const text of textsAfter) {
        run.agent.send({ text, images: [] });
      }

      run.agent.interrupt();
      await settle();

      expect(run.signals).toEqual(isKilled ? ['SIGTERM'] : []);
      const killNotice = 'Interrupted again; ending the Claude process.';
      expect(noticeTexts(run.heard).includes(killNotice)).toBe(isKilled);
      expect(interruptRequests(run.written)).toHaveLength(isKilled ? 1 : 2);
    },
  );

  it('activity_RepeatedWorkingLines_EmitsOnlyChanges', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    writeLine(run.stdout, lifecycleInit);
    writeLine(run.stdout, lifecycle('uuid-1', 'started'));
    await settle();

    expect(activities(run.heard)).toEqual(['working']);
  });

  it('start_InitWithoutLifecycleCapability_PostsOneNotice', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });

    writeLine(run.stdout, plainInit);
    writeLine(run.stdout, plainInit);
    await settle();

    const notice =
      'This Claude Code version reports no message lifecycle; the working state follows turn results only.';
    expect(noticeTexts(run.heard).filter((text) => text === notice)).toEqual([
      notice,
    ]);
    const missing =
      'msg_lifecycle_v1 missing from init capabilities; tracking turns by results';
    expect(run.logged.filter(([, message]) => message === missing)).toEqual([
      ['claude', missing],
    ]);
  });

  it('activity_LineAfterClose_EmitsNothingAfterEnded', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    await settle();

    run.emitter.emit('close', 0, null);
    writeLine(run.stdout, lifecycleInit);
    await settle();

    const names = run.heard.map(([name]) => name);
    const endedAt = names.indexOf('ended');
    expect(endedAt).toBeGreaterThan(-1);
    expect(names.slice(endedAt)).not.toContain('activity');
  });

  it('stderrAndExit_LogsAndEnds', async () => {
    const run = await startedQuiet();

    run.stderr.write('oops\n');
    await settle();
    run.emitter.emit('close', 1, null);
    await settle();

    expect(run.logged).toEqual([['claude', 'oops']]);
    expect(run.heard).toEqual([
      ['ended', { code: 1, error: expect.stringContaining('oops') }],
    ]);
    expect(() => run.agent.send({ text: 'hi', images: [] })).toThrow();
  });

  it('spawnNotFound_EndsWithHint', async () => {
    const fake = fakeChild();
    (fake.child as { pid: number | undefined }).pid = undefined;
    const run = started(fake);

    run.emitter.emit(
      'error',
      Object.assign(new Error('spawn /bin/claude ENOENT'), { code: 'ENOENT' }),
    );
    await settle();

    expect(run.heard.filter(([name]) => name === 'ended')).toEqual([
      [
        'ended',
        {
          code: null,
          error: expect.stringMatching(
            /\/bin\/claude.*\/proj.*set claude-code\.command$/,
          ),
        },
      ],
    ]);
    await expect(run.agent.end()).resolves.toBeUndefined();
  });

  it('end_EscalatesToSigtermThenSigkill', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = await startedQuiet();
    let hasResolved = false;

    const ending = run.agent.end().then(() => {
      hasResolved = true;
    });
    await settle();
    expect(run.isStdinEnded()).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(run.signals).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(3000);
    expect(run.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(hasResolved).toBe(false);
    run.emitter.emit('close', null, 'SIGKILL');
    await ending;

    expect(run.heard).toEqual([['ended', { code: null, error: null }]]);
  });

  it.each([
    { case: 'no late line', lateLine: null },
    { case: 'a late line', lateLine: lifecycleInit },
  ])('end_ThenClose_ClearsEveryTimer ($case)', async ({ lateLine }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    run.agent.interrupt();
    const ending = run.agent.end();
    await settle();

    run.emitter.emit('close', 0, null);
    if (lateLine !== null) {
      writeLine(run.stdout, lateLine);
    }
    await ending;
    await settle();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10000);
    await settle();
    const names = run.heard.map(([name]) => name);
    expect(names.at(-1)).toBe('ended');
    expect(noticeTexts(run.heard)).not.toContain(GRACE_NOTICE);
  });

  it('replayPipeLog_RecordedLiveSession_EqualsTheLiveRun', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let at = 1000;
    const recorded: PipeLine[] = [];
    const record = (dir: PipeDirection, text: string) => {
      recorded.push({ seq: recorded.length + 1, dir, at, text });
    };
    const fake = fakeChild();
    const { stdin } = fake.child;
    const writeStdin = stdin.write.bind(stdin) as (text: string) => boolean;
    stdin.write = ((text: string) => {
      record('in', text.trimEnd());
      return writeStdin(text);
    }) as typeof stdin.write;
    const run = started(fake, createMemoryFiles(), { now: () => at });
    await settle();
    const startedAt = at;
    const step = async (action: () => void) => {
      at += 1000;
      action();
      await settle();
    };
    const out = (line: object | string) =>
      step(() => {
        const text = typeof line === 'string' ? line : JSON.stringify(line);
        record('out', text);
        run.stdout.write(`${text}\n`);
      });

    await out(contextReply('wigley-2', 1000000, 967000));
    await out(
      settingsReply('wigley-3', { model: 'claude-opus-5-5', effort: 'medium' }),
    );
    await step(() => run.agent.send({ text: 'hi', images: [] }));
    await out(lifecycleInit);
    await out(lifecycle('uuid-1', 'started'));
    await out(REPLY_LINE);
    await out(successResult('ok', ['uuid-1']));
    await step(() => run.agent.setControl('mode', 'plan'));
    await out({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'wigley-6' },
    });
    await step(() => run.agent.setControl('effort', 'high'));
    await out(successResult('Set effort level to high', ['00000000-2']));
    await out(
      settingsReply('wigley-8', { model: 'claude-opus-5-5', effort: 'high' }),
    );
    await step(() => run.agent.send({ text: 'two', images: [] }));
    await out(lifecycleInit);
    await out(lifecycle('uuid-3', 'started'));
    await step(() => run.agent.interrupt());
    const interruptedAt = at;
    await step(() => {
      record('err', 'warn');
      run.stderr.write('warn\n');
    });
    at = interruptedAt + 5000;
    vi.advanceTimersByTime(5000);
    await settle();

    const state = createSessionFoldState(request);
    const replay = replayPipeLog(state, recorded, at, null);

    const lastVersions = (entries: readonly ChatEntry[]) => {
      const byId = new Map<string, ChatEntry>();
      for (const entry of entries) {
        byId.set(entry.id, entry);
      }
      return [...byId.values()];
    };
    const liveEntries = lastVersions(
      run.timeline.flatMap(([name, payload]) =>
        name === 'entry' ? [payload as ChatEntry] : [],
      ),
    );
    const replayEntries = replay.flatMap((effect) =>
      effect.kind === 'entry' ? [effect.entry] : [],
    );
    expect(replayEntries).toEqual(liveEntries);
    const ids = replayEntries.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'user-1',
        'user-2',
        'control-notice-1',
        'control-notice-2',
      ]),
    );
    for (const entries of [liveEntries, replayEntries]) {
      expect(entries.find((entry) => entry.id === 'control-notice-2')?.at).toBe(
        interruptedAt + 5000,
      );
    }

    const liveEvents = run.timeline.flatMap(([name, payload]) =>
      name === 'agentEvent' ? [payload as AgentEvent] : [],
    );
    const settingsRead: AgentEvent = {
      type: 'usage',
      agentId: 'main',
      at: startedAt,
      contextTokens: 0,
      contextWindow: null,
      autocompact: { configured: null, reported: null },
      cacheExpiresAt: null,
      spendUsd: null,
    };
    expect(liveEvents).toContainEqual(settingsRead);
    expect(
      replay.flatMap((effect) =>
        effect.kind === 'agentEvent' ? [effect.event] : [],
      ),
    ).toEqual(
      liveEvents.filter(
        (event) => JSON.stringify(event) !== JSON.stringify(settingsRead),
      ),
    );

    const liveControls = run.heard
      .filter(([name]) => name === 'controls')
      .at(-1)?.[1];
    expect(replay.find((effect) => effect.kind === 'controls')).toEqual({
      kind: 'controls',
      controls: liveControls,
    });
    expect(liveControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mode', value: 'plan' }),
        expect.objectContaining({ id: 'effort', value: 'high' }),
        expect.objectContaining({ id: 'model', value: 'opus' }),
      ]),
    );
    expect(lastActivity(run.heard)).toBe('idle');
    expect(replay.at(-1)).toEqual({ kind: 'activity', activity: 'idle' });

    const highestRequest = Math.max(
      ...run.written.flatMap((line) => {
        const id = (line as { request_id?: string }).request_id;
        return id === undefined ? [] : [Number(id.replace('wigley-', ''))];
      }),
    );
    expect(state).toMatchObject({
      sendCount: 2,
      requestCount: highestRequest,
      lastStderr: 'warn',
      graceDeadline: null,
      isContextRequestOwed: false,
    });
  });

  it('start_AgentEvents_StampedAtTheClockAndBracketedBySession', async () => {
    let at = 1000;
    const run = started(fakeChild(), createMemoryFiles(), { now: () => at });
    writeLine(run.stdout, plainInit);
    await settle();
    run.agent.send({ text: 'hi', images: [] });
    await settle();

    at = 2000;
    writeLine(run.stdout, {
      type: 'assistant',
      message: {
        model: 'claude-haiku-5-5',
        id: 'msg_1',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Read',
            input: { file_path: 'notes.txt' },
          },
        ],
      },
      parent_tool_use_id: null,
    });
    await settle();
    run.emitter.emit('close', 0, null);
    await settle();

    expect(run.agentEvents).toEqual([
      { type: 'sessionStarted', at: 1000 },
      { type: 'turnStarted', at: 1000 },
      { type: 'userMessage', at: 1000 },
      {
        type: 'toolStarted',
        at: 2000,
        agentId: 'main',
        toolUseId: 't1',
        tool: 'Read',
        summary: 'notes.txt',
      },
      { type: 'sessionEnded', at: 2000 },
    ]);
  });

  it('start_AgentDefinition_ReachesTheSpawn', async () => {
    const files = createMemoryFiles();
    await files.write(
      '/proj/.claude/agents/mapper.md',
      '---\nname: mapper\nmodel: sonnet\neffort: high\n---\nYou map.\n',
    );
    const run = started(fakeChild(), files);
    await settle();

    writeLine(run.stdout, {
      type: 'assistant',
      message: {
        model: 'claude-opus-5-5',
        id: 'msg_1',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'a1',
            name: 'Agent',
            input: { description: 'map', subagent_type: 'mapper', prompt: 'x' },
          },
        ],
      },
      parent_tool_use_id: null,
    });
    await settle();

    expect(
      run.agentEvents.filter((event) => event.type === 'agentSpawned'),
    ).toEqual([
      {
        type: 'agentSpawned',
        at: 1000,
        agentId: 'a1',
        parentAgentId: 'main',
        agentType: 'mapper',
        description: 'map',
        name: 'mapper',
        model: 'sonnet',
        effort: 'high',
      },
    ]);
  });

  it.each([
    {
      case: 'skill with args',
      text: '/wigley:make /p/plan-y',
      expected: [
        { type: 'userMessage', at: 1000 },
        {
          type: 'skillStarted',
          at: 1000,
          agentId: 'main',
          skill: 'wigley:make',
          args: '/p/plan-y',
        },
      ],
    },
    {
      case: 'skill alone',
      text: '/wigley:feature',
      expected: [
        { type: 'userMessage', at: 1000 },
        {
          type: 'skillStarted',
          at: 1000,
          agentId: 'main',
          skill: 'wigley:feature',
          args: '',
        },
      ],
    },
    {
      case: 'plain message',
      text: 'hi',
      expected: [{ type: 'userMessage', at: 1000 }],
    },
    {
      case: 'control command',
      text: '/effort high',
      expected: [{ type: 'userMessage', at: 1000 }],
    },
    {
      case: 'compact command',
      text: '/compact',
      expected: [
        { type: 'userMessage', at: 1000 },
        {
          type: 'skillStarted',
          at: 1000,
          agentId: 'main',
          skill: 'compact',
          args: '',
        },
      ],
    },
  ])('send_SlashText_EmitsSkillStarted ($case)', async ({ text, expected }) => {
    const run = started();
    writeLine(run.stdout, plainInit);
    await settle();
    run.agentEvents.length = 0;

    run.agent.send({ text, images: [] });
    await settle();

    expect(run.agentEvents).toEqual(expected);
  });

  it('kill_SendsSigtermAtOnceAndEndsClean', async () => {
    const run = await startedQuiet();

    run.agent.kill();
    expect(run.signals).toEqual(['SIGTERM']);
    run.emitter.emit('close', null, 'SIGTERM');
    await settle();

    expect(run.heard).toEqual([['ended', { code: null, error: null }]]);
    expect(() => run.agent.send({ text: 'hi', images: [] })).toThrow(
      'Claude Code process has ended',
    );
    expect(() => run.agent.compact()).toThrow('Claude Code process has ended');
  });

  describe('compaction', () => {
    const compactingStatus = {
      type: 'system',
      subtype: 'status',
      status: 'compacting',
    };
    const compactBoundary = {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'manual',
        pre_tokens: 37559,
        post_tokens: 9023,
        duration_ms: 8303,
      },
    };
    const compactFailed = {
      type: 'system',
      subtype: 'status',
      status: null,
      compact_result: 'failed',
      compact_error: 'Not enough messages to compact.',
    };
    // The first app command's uuid: `randomUuid`'s `uuid-1` as `appCommandUuid`
    // writes it.
    const APP_UUID = appCommandUuid('uuid-1');
    const TYPED_UUID = 'uuid-1';
    const mainReply = (id: string) => ({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        model: 'claude-opus-5-5',
        id,
        type: 'message',
        role: 'assistant',
        content: [],
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 909,
          cache_read_input_tokens: 38019,
          output_tokens: 5,
        },
      },
    });
    const STARTED = (trigger: string, at = 1000) => ({
      type: 'compactionStarted',
      at,
      trigger,
    });
    const DONE = (trigger: string, at = 1000) => ({
      type: 'compactionEnded',
      at,
      trigger,
      outcome: 'done',
      beforeTokens: 37559,
      durationMs: 8303,
    });
    const NEVER_RAN = (trigger: string, outcome: string, at = 1000) => ({
      type: 'compactionEnded',
      at,
      trigger,
      outcome,
      beforeTokens: null,
      durationMs: null,
    });
    const compactionEvents = (events: AgentEvent[]) =>
      events.filter((event) => event.type.startsWith('compaction'));
    const compactionEntries = (heard: [string, unknown][]) =>
      heard.flatMap(([name, payload]) =>
        name === 'entry' && (payload as ChatEntry).kind === 'compaction'
          ? [payload as ChatEntry]
          : [],
      );
    const writeLines = async (
      run: { stdout: PassThrough },
      lines: readonly object[],
    ) => {
      for (const line of lines) {
        writeLine(run.stdout, line);
      }
      await settle();
    };

    it('compact_WritesTheCommandWithNoUserEntry', async () => {
      const run = await startedQuiet();

      run.agent.compact();
      await writeLines(run, [lifecycle(APP_UUID, 'started')]);

      expect(run.written.at(-1)).toEqual(
        userMessage({ text: '/compact', images: [] }, APP_UUID),
      );
      expect(
        run.heard.filter(
          ([name, payload]) =>
            name === 'entry' && (payload as ChatEntry).kind === 'user',
        ),
      ).toEqual([]);
      expect(
        run.agentEvents.filter(
          (event) =>
            event.type === 'userMessage' || event.type === 'skillStarted',
        ),
      ).toEqual([]);
      expect(lastActivity(run.heard)).toBe('working');
    });

    it('compact_WhileATurnRuns_Throws', async () => {
      const run = await startedQuiet();

      run.agent.send({ text: 'hi', images: [] });

      expect(() => run.agent.compact()).toThrow(
        'Claude is working; compact when the turn ends',
      );
    });

    it.each<{
      name: string;
      act: (agent: AgentProcess) => void;
      lines: object[];
      expected: string;
    }>([
      {
        name: 'app',
        act: (agent) => agent.compact(),
        lines: [lifecycle(APP_UUID, 'started'), compactingStatus],
        expected: 'app',
      },
      {
        name: 'typed',
        act: (agent) => agent.send({ text: '/compact', images: [] }),
        lines: [lifecycle(TYPED_UUID, 'started'), compactingStatus],
        expected: 'manual',
      },
      {
        name: 'typed with instructions',
        act: (agent) =>
          agent.send({ text: '/compact keep the plan', images: [] }),
        lines: [lifecycle(TYPED_UUID, 'started'), compactingStatus],
        expected: 'manual',
      },
      {
        name: 'a model turn',
        act: (agent) => agent.send({ text: 'hi', images: [] }),
        lines: [
          lifecycle(TYPED_UUID, 'started'),
          lifecycleInit,
          compactingStatus,
        ],
        expected: 'harness',
      },
      {
        name: 'a longer command name',
        act: (agent) => agent.send({ text: '/compactor', images: [] }),
        lines: [lifecycle(TYPED_UUID, 'started'), compactingStatus],
        expected: 'harness',
      },
      {
        name: 'fallback, the oldest armed command',
        act: (agent) => {
          agent.send({ text: '/compact', images: [] });
          agent.send({ text: '/compact again', images: [] });
        },
        lines: [plainInit, compactingStatus],
        expected: 'manual',
      },
    ])(
      'compaction_Trigger_FromWhatStartedIt ($name)',
      async ({ act, lines, expected }) => {
        const run = await startedQuiet();

        act(run.agent);
        await writeLines(run, [...lines, compactBoundary]);

        expect(compactionEvents(run.agentEvents)).toEqual([
          STARTED(expected),
          DONE(expected),
        ]);
      },
    );

    it.each<{
      name: string;
      lines: object[];
      expected: object[];
    }>([
      {
        name: 'repeated statuses',
        lines: [compactingStatus, compactingStatus, compactBoundary],
        expected: [DONE('app', 4000)],
      },
      {
        name: 'failed status',
        lines: [compactFailed],
        expected: [
          {
            type: 'compactionEnded',
            at: 4000,
            trigger: 'app',
            outcome: 'failed',
            beforeTokens: null,
            durationMs: 3000,
          },
        ],
      },
      {
        name: "the command's result",
        lines: [{ ...errorResult, user_message_uuid: APP_UUID }],
        expected: [
          {
            type: 'compactionEnded',
            at: 4000,
            trigger: 'app',
            outcome: 'failed',
            beforeTokens: null,
            durationMs: 3000,
          },
        ],
      },
      {
        name: 'the end by a terminal lifecycle frame',
        lines: [lifecycle(APP_UUID, 'cancelled')],
        expected: [
          {
            type: 'compactionEnded',
            at: 4000,
            trigger: 'app',
            outcome: 'failed',
            beforeTokens: null,
            durationMs: 3000,
          },
        ],
      },
    ])('compaction_EndsOncePerStart ($name)', async ({ lines, expected }) => {
      let at = 1000;
      const run = started(fakeChild(), createMemoryFiles(), {
        now: () => at,
      });
      await settle();
      run.agent.compact();
      await writeLines(run, [lifecycle(APP_UUID, 'started'), compactingStatus]);
      at = 4000;

      await writeLines(run, [
        ...lines,
        successResult('', [APP_UUID]),
        lifecycle(APP_UUID, 'completed'),
      ]);

      expect(compactionEvents(run.agentEvents)).toEqual([
        STARTED('app'),
        ...expected,
      ]);
    });

    it('compaction_ProcessCloses_EndsBeforeSessionEnded', async () => {
      let at = 1000;
      const run = started(fakeChild(), createMemoryFiles(), { now: () => at });
      await settle();
      run.agent.compact();
      await writeLines(run, [lifecycle(APP_UUID, 'started'), compactingStatus]);
      at = 4000;

      run.emitter.emit('close', 0, null);
      await settle();

      const endings = run.agentEvents.slice(-2);
      expect(endings).toEqual([
        {
          type: 'compactionEnded',
          at: 4000,
          trigger: 'app',
          outcome: 'failed',
          beforeTokens: null,
          durationMs: 3000,
        },
        { type: 'sessionEnded', at: 4000 },
      ]);
    });

    it.each<{
      name: string;
      isInterrupted: boolean;
      outcome: string;
    }>([
      {
        name: 'a command that never ran',
        isInterrupted: false,
        outcome: 'failed',
      },
      {
        name: 'a command an interrupt caught',
        isInterrupted: true,
        outcome: 'interrupted',
      },
    ])(
      'compaction_ProcessClosesBeforeAnyStatus_StillPairs ($name)',
      async ({ isInterrupted, outcome }) => {
        const run = await startedQuiet();
        run.agent.compact();
        if (isInterrupted) {
          run.agent.interrupt();
        }

        run.emitter.emit('close', 0, null);
        await settle();

        expect(compactionEvents(run.agentEvents)).toEqual([
          STARTED('app'),
          NEVER_RAN('app', outcome),
        ]);
      },
    );

    it('compaction_AppCommandBehindAnAbandonedTurn_StillPairs', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = await startedQuiet();
      run.agent.compact();
      await writeLines(run, [lifecycleInit]);

      run.agent.interrupt();
      vi.advanceTimersByTime(5000);
      await settle();

      expect(compactionEvents(run.agentEvents)).toEqual([
        STARTED('app', 6000),
        NEVER_RAN('app', 'failed', 6000),
      ]);
    });

    it.each<{ name: string; act?: 'hi'; lines: object[]; expected: object[] }>([
      {
        name: 'a boundary with no start',
        act: 'hi',
        lines: [lifecycleInit, compactBoundary],
        expected: [STARTED('harness'), DONE('harness')],
      },
      {
        name: 'a harness end on a bare result',
        act: 'hi',
        lines: [lifecycleInit, compactingStatus, successResult('ok')],
        expected: [
          STARTED('harness'),
          {
            type: 'compactionEnded',
            at: 1000,
            trigger: 'harness',
            outcome: 'failed',
            beforeTokens: null,
            durationMs: 0,
          },
        ],
      },
      {
        name: 'a harness end on an unrequested result',
        lines: [lifecycleInit, compactingStatus, ownTurnResult],
        expected: [
          STARTED('harness'),
          {
            type: 'compactionEnded',
            at: 1000,
            trigger: 'harness',
            outcome: 'failed',
            beforeTokens: null,
            durationMs: 0,
          },
        ],
      },
      {
        name: 'a failed attempt, then a new compaction in one turn',
        act: 'hi',
        lines: [
          lifecycleInit,
          compactingStatus,
          {
            type: 'system',
            subtype: 'status',
            status: null,
            compact_result: 'failed',
            compact_error: 'too_few_groups',
          },
          mainReply('m1'),
          compactingStatus,
          compactBoundary,
        ],
        expected: [
          STARTED('harness'),
          {
            type: 'compactionEnded',
            at: 1000,
            trigger: 'harness',
            outcome: 'failed',
            beforeTokens: null,
            durationMs: 0,
          },
          STARTED('harness'),
          DONE('harness'),
        ],
      },
    ])(
      'compaction_InAHarnessTurn ($name)',
      async ({ act, lines, expected }) => {
        const run = await startedQuiet();
        if (act !== undefined) {
          run.agent.send({ text: act, images: [] });
        }

        await writeLines(run, lines);

        expect(compactionEvents(run.agentEvents)).toEqual(expected);
      },
    );

    it.each<{
      name: string;
      act: (agent: AgentProcess) => void;
      lines: object[];
      expected: object[];
    }>([
      {
        name: 'app',
        act: (agent) => agent.compact(),
        lines: [
          lifecycle(APP_UUID, 'started'),
          { ...errorResult, user_message_uuid: APP_UUID },
          lifecycle(APP_UUID, 'completed'),
        ],
        expected: [STARTED('app'), NEVER_RAN('app', 'failed')],
      },
      {
        name: 'typed, refused with no compaction line',
        act: (agent) => agent.send({ text: '/compact', images: [] }),
        lines: [
          lifecycle(TYPED_UUID, 'started'),
          successResult('Not enough', [TYPED_UUID]),
          lifecycle(TYPED_UUID, 'completed'),
        ],
        expected: [STARTED('manual'), NEVER_RAN('manual', 'failed')],
      },
      {
        name: 'fallback, on a result',
        act: (agent) => agent.compact(),
        lines: [plainInit, successResult('Not enough')],
        expected: [STARTED('app'), NEVER_RAN('app', 'failed')],
      },
    ])(
      'compaction_CommandEndsWithoutCompacting_StartsAndFails ($name)',
      async ({ act, lines, expected }) => {
        const run = await startedQuiet();

        act(run.agent);
        await writeLines(run, lines);

        expect(compactionEvents(run.agentEvents)).toEqual(expected);
      },
    );

    it('compaction_RefusedAsMeasured_OneStartOneFailedEnd', async () => {
      const run = await startedQuiet();

      run.agent.send({ text: '/compact', images: [] });
      await writeLines(run, [
        lifecycle(TYPED_UUID, 'started'),
        compactingStatus,
        compactFailed,
        lifecycleInit,
        successResult('Not enough messages to compact.', [TYPED_UUID]),
        lifecycle(TYPED_UUID, 'completed'),
      ]);

      expect(compactionEvents(run.agentEvents)).toEqual([
        STARTED('manual'),
        {
          type: 'compactionEnded',
          at: 1000,
          trigger: 'manual',
          outcome: 'failed',
          beforeTokens: null,
          durationMs: 0,
        },
      ]);
    });

    it('compaction_FallbackAnyResult_EndsTheCompaction', async () => {
      const run = await startedQuiet();

      run.agent.compact();
      await writeLines(run, [plainInit, compactingStatus, successResult('ok')]);

      expect(compactionEvents(run.agentEvents)).toEqual([
        STARTED('app'),
        {
          type: 'compactionEnded',
          at: 1000,
          trigger: 'app',
          outcome: 'failed',
          beforeTokens: null,
          durationMs: 0,
        },
      ]);
    });

    it('compaction_Boundary_EmitsEntryThenItsAfterSize', async () => {
      let at = 1000;
      const run = started(fakeChild(), createMemoryFiles(), { now: () => at });
      await settle();

      run.agent.compact();
      await writeLines(run, [
        lifecycle(APP_UUID, 'started'),
        compactingStatus,
        compactBoundary,
      ]);
      const entry = {
        kind: 'compaction',
        id: 'compaction-1',
        at: 1000,
        trigger: 'app',
        beforeTokens: 37559,
        afterTokens: null,
        durationMs: 8303,
        raw: [compactBoundary],
      };
      expect(compactionEntries(run.heard)).toEqual([entry]);

      at = 2000;
      await writeLines(run, [mainReply('m1'), mainReply('m2')]);

      expect(compactionEntries(run.heard)).toEqual([
        entry,
        { ...entry, afterTokens: 38935 },
      ]);
    });

    it.each<{
      name: string;
      act: (agent: AgentProcess) => void;
      uuid: string;
      results: number;
    }>([
      {
        name: 'app',
        act: (agent) => agent.compact(),
        uuid: APP_UUID,
        results: 0,
      },
      {
        name: 'typed',
        act: (agent) => agent.send({ text: '/compact', images: [] }),
        uuid: TYPED_UUID,
        results: 1,
      },
    ])(
      'compaction_AppResult_ShowsNoResultEntry ($name)',
      async ({ act, uuid, results }) => {
        const run = await startedQuiet();

        act(run.agent);
        await writeLines(run, [
          lifecycleInit,
          lifecycle(uuid, 'started'),
          compactingStatus,
          compactBoundary,
          { ...successResult('', [uuid]), local_command: 'compact' },
          lifecycle(uuid, 'completed'),
        ]);

        expect(resultEntries(run.heard)).toHaveLength(results);
      },
    );

    const INTERRUPTED = {
      type: 'compactionEnded',
      trigger: 'app',
      outcome: 'interrupted',
    };

    it.each<{
      name: string;
      steps: (object | number)[];
      ended: object[];
      entries?: number;
    }>([
      {
        name: 'no line within the grace',
        steps: [5000],
        ended: [INTERRUPTED],
      },
      { name: 'just before the grace', steps: [4999], ended: [] },
      {
        name: 'the reply idles the session',
        steps: [
          {
            type: 'control_response',
            response: {
              subtype: 'success',
              request_id: 'wigley-4',
              response: { still_queued: [] },
            },
          },
          5000,
        ],
        ended: [INTERRUPTED],
      },
      {
        name: 'the boundary within the grace',
        steps: [compactBoundary, 5000],
        ended: [{ type: 'compactionEnded', outcome: 'done' }],
        entries: 1,
      },
      {
        name: 'the boundary after the grace',
        steps: [5000, compactBoundary],
        ended: [INTERRUPTED],
        entries: 1,
      },
      {
        name: "the command's result within the grace",
        steps: [{ ...errorResult, user_message_uuid: APP_UUID }, 5000],
        ended: [INTERRUPTED],
      },
      {
        name: 'a failed status within the grace',
        steps: [compactFailed, 5000],
        ended: [INTERRUPTED],
      },
      {
        name: 'the plain interrupt as measured',
        steps: [
          {
            type: 'system',
            subtype: 'status',
            status: null,
            compact_result: 'failed',
            compact_error: 'API Error: Request was aborted.',
          },
          lifecycleInit,
          { ...successResult('', [APP_UUID]), local_command: 'compact' },
          lifecycle(APP_UUID, 'cancelled'),
          5000,
        ],
        ended: [INTERRUPTED],
      },
    ])(
      'compaction_Interrupted_EndsOnceWithinTheGrace ($name)',
      async ({ steps, ended, entries = 0 }) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const run = await startedQuiet();
        run.agent.compact();
        await writeLines(run, [
          lifecycle(APP_UUID, 'started'),
          compactingStatus,
        ]);
        run.agent.interrupt();

        for (const step of steps) {
          if (typeof step === 'number') {
            vi.advanceTimersByTime(step);
            await settle();
          } else {
            await writeLines(run, [step]);
          }
        }

        expect(
          run.agentEvents.filter((event) => event.type === 'compactionEnded'),
        ).toEqual(ended.map((end) => expect.objectContaining(end)));
        expect(compactionEntries(run.heard)).toHaveLength(entries);
      },
    );

    it('compaction_InterruptBeforeTheFirstStatus_EndsAtTheGrace', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = await startedQuiet();

      run.agent.compact();
      run.agent.interrupt();
      vi.advanceTimersByTime(5000);
      await settle();

      expect(compactionEvents(run.agentEvents)).toEqual([
        STARTED('app', 6000),
        NEVER_RAN('app', 'interrupted', 6000),
      ]);
    });

    it('compaction_InterruptBeforeTheFirstStatus_ItsStatusStillTakesTheCommand', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = await startedQuiet();

      run.agent.compact();
      run.agent.interrupt();
      await writeLines(run, [
        {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: 'wigley-4',
            response: { still_queued: [] },
          },
        },
        compactingStatus,
        compactFailed,
      ]);
      vi.advanceTimersByTime(5000);
      await settle();

      expect(compactionEvents(run.agentEvents)).toEqual([
        STARTED('app'),
        {
          type: 'compactionEnded',
          at: 1000,
          trigger: 'app',
          outcome: 'interrupted',
          beforeTokens: null,
          durationMs: 0,
        },
      ]);
    });

    it('compaction_StaleArmedUuidAfterAbandon_NextStatusIsHarness', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = await startedQuiet();

      run.agent.send({ text: '/compact', images: [] });
      run.agent.send({ text: '/compact again', images: [] });
      run.agent.interrupt();
      vi.advanceTimersByTime(5000);
      await settle();
      await writeLines(run, [compactingStatus]);

      expect(compactionEvents(run.agentEvents)).toEqual([
        STARTED('manual', 6000),
        NEVER_RAN('manual', 'interrupted', 6000),
        STARTED('harness'),
      ]);
    });

    it('compaction_StatusAfterAGraceEndedCompaction_StartsANewOne', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = await startedQuiet();

      run.agent.compact();
      await writeLines(run, [lifecycle(APP_UUID, 'started'), compactingStatus]);
      run.agent.interrupt();
      vi.advanceTimersByTime(5000);
      await settle();
      await writeLines(run, [compactingStatus]);

      expect(
        run.agentEvents.filter((event) => event.type === 'compactionStarted'),
      ).toEqual([STARTED('app'), STARTED('harness')]);
    });
  });
});

describe('createClaudeCodeHarness past sessions', () => {
  const sessionId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const transcript = JSON.stringify({
    type: 'user',
    uuid: 'u1',
    cwd: '/w/app',
    message: { role: 'user', content: 'hello' },
  });

  // The ids `listSessions` finds with one transcript saved in `configFolder`.
  async function listedFrom(
    configFolder: string,
    env: Readonly<Record<string, string>>,
    profileDir: string | null,
  ) {
    const files = createMemoryFiles();
    await files.write(
      `${configFolder}/projects/-w-app/${sessionId}.jsonl`,
      transcript,
    );
    const harness = createClaudeCodeHarness({
      command: () => '/bin/claude',
      permissionTool: 'tool',
      profiles: () => [],
      env,
      log: () => {},
      host: createFakeSessionHost(clock),
      processes: childProcesses([fakeChild().child]),
      files,
      homeDir: '/Users/u',
      paths: posixPaths,
      clock,
      randomUuid: () => 'uuid-1',
    });
    const sessions = await harness.listSessions('/w/app', profileDir);
    return sessions.map((session) => session.sessionId);
  }

  it('listSessions_ProfileOrEnvOrHomeConfigFolder', async () => {
    expect(await listedFrom('/Users/u/.claude', {}, null)).toEqual([sessionId]);
    expect(await listedFrom('/c', { CLAUDE_CONFIG_DIR: '/c' }, null)).toEqual([
      sessionId,
    ]);
    expect(await listedFrom('/p', { CLAUDE_CONFIG_DIR: '/c' }, '/p')).toEqual([
      sessionId,
    ]);
    expect(
      await listedFrom('/Users/u/.claude', { CLAUDE_CONFIG_DIR: '/c' }, null),
    ).toEqual([]);
    expect(
      await listedFrom('/Users/u/.claude', { CLAUDE_CONFIG_DIR: '' }, null),
    ).toEqual([sessionId]);
  });

  it.each([
    { profileDir: null, folder: '/Users/u/.claude' },
    { profileDir: '~/.claude-personal', folder: '/Users/u/.claude-personal' },
    { profileDir: '/p', folder: '/p' },
  ])(
    'configFolder_$profileDir_IgnoresTheAppsConfigDir',
    ({ profileDir, folder }) => {
      const harness = createClaudeCodeHarness({
        command: () => '/bin/claude',
        permissionTool: 'tool',
        profiles: () => [],
        env: { CLAUDE_CONFIG_DIR: '/c' },
        log: () => {},
        host: createFakeSessionHost(clock),
        processes: childProcesses([fakeChild().child]),
        files: createMemoryFiles(),
        homeDir: '/Users/u',
        paths: posixPaths,
        clock,
        randomUuid: () => 'uuid-1',
      });

      expect(harness.configFolder(profileDir)).toBe(folder);
    },
  );
});

describe('createClaudeCodeHarness accounts', () => {
  const signedInStatus = JSON.stringify({
    loggedIn: true,
    email: 'jo@example.com',
    subscriptionType: 'max',
  });

  // A `claude auth` child: stdin kept as raw lines, since a pasted code is not
  // JSON.
  function authChild() {
    const emitter = new EventEmitter();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const lines: string[] = [];
    const signals: string[] = [];
    stdin.on('data', (chunk: Buffer) => {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
    });
    const child = Object.assign(emitter, {
      stdin,
      stdout,
      stderr,
      pid: 1 as number | undefined,
      kill(signal = 'SIGTERM') {
        signals.push(signal);
        return true;
      },
    });
    return {
      child: child as unknown as ChildProcessWithoutNullStreams,
      emitter,
      stdout,
      stderr,
      lines,
      signals,
      setPid(pid: number | undefined) {
        child.pid = pid;
      },
    };
  }

  // A harness whose spawns hand out `children` in order, recording each
  // spawn's arguments and options.
  function authHarness(
    children: ReturnType<typeof authChild>[],
    harnessClock = clock,
  ) {
    const processes = childProcesses(children.map((child) => child.child));
    const harness = createClaudeCodeHarness({
      command: () => '/bin/claude',
      permissionTool: 'tool',
      profiles: () => [],
      env: { HOME: '/Users/u', CLAUDECODE: '1' },
      log: () => {},
      host: createFakeSessionHost(harnessClock),
      processes,
      files: createMemoryFiles(),
      homeDir: '/Users/u',
      paths: posixPaths,
      clock: harnessClock,
      randomUuid: () => 'uuid-1',
    });
    return { harness, spawned: processes.spawned };
  }

  // Ends `child` as a run that printed `stdout` and exited with `code`.
  async function exitWith(
    child: ReturnType<typeof authChild>,
    stdout: string,
    code: number,
  ) {
    child.stdout.write(stdout);
    await settle();
    child.emitter.emit('close', code, null);
    await settle();
  }

  const signedOutStatus = JSON.stringify({ loggedIn: false });

  function recordingLogIn() {
    const heard: [string, unknown][] = [];
    const events: LogInEvents = {
      link: (url) => heard.push(['link', url]),
      ended: (end) => heard.push(['ended', end]),
    };
    return { heard, events };
  }

  it('accountStatus_SpawnFails_RejectsWithCommandHint', async () => {
    const child = authChild();
    child.setPid(undefined);
    const { harness } = authHarness([child]);

    const status = harness.accountStatus(null);
    child.emitter.emit(
      'error',
      Object.assign(new Error('spawn /bin/claude ENOENT'), { code: 'ENOENT' }),
    );

    await expect(status).rejects.toThrow(/\/bin\/claude/);
  });

  it('accountStatus_SignedIn_ReadsStatusWithProfileEnv', async () => {
    const child = authChild();
    const { harness, spawned } = authHarness([child]);

    const status = harness.accountStatus('~/.claude-work');
    child.stdout.write(`${signedInStatus}\n`);
    await settle();
    child.emitter.emit('close', 0, null);

    expect(await status).toEqual({
      signedIn: true,
      account: 'jo@example.com · Claude max',
    });
    expect(spawned).toEqual([
      {
        args: ['auth', 'status', '--json'],
        options: {
          cwd: '/Users/u',
          env: { HOME: '/Users/u', CLAUDE_CONFIG_DIR: '/Users/u/.claude-work' },
        },
      },
    ]);
  });

  it('logIn_ProcessExitsSignedIn_EndsWithStatus', async () => {
    const before = authChild();
    const login = authChild();
    const status = authChild();
    const { harness, spawned } = authHarness([before, login, status]);
    const { heard, events } = recordingLogIn();
    const url = 'https://claude.ai/oauth/authorize?code=true';

    harness.logIn(null, events);
    await exitWith(before, signedOutStatus, 0);
    login.stdout.write(
      `Opening browser to sign in…\nIf the browser didn't open, visit: \x1b]8;;${url}\x07${url}\x1b]8;;\x07\n`,
    );
    await settle();
    login.emitter.emit('close', 0, null);
    await exitWith(status, signedInStatus, 0);

    expect(heard).toEqual([
      ['link', url],
      [
        'ended',
        {
          status: { signedIn: true, account: 'jo@example.com · Claude max' },
          error: null,
        },
      ],
    ]);
    expect(spawned.map((spawn) => spawn.args)).toEqual([
      ['auth', 'status', '--json'],
      ['auth', 'login'],
      ['auth', 'status', '--json'],
    ]);
  });

  it('logIn_Cancel_EndsOnceCancelled', async () => {
    const before = authChild();
    const login = authChild();
    const { harness, spawned } = authHarness([before, login]);
    const { heard, events } = recordingLogIn();

    const process = harness.logIn(null, events);
    process.cancel();
    process.cancel();
    login.emitter.emit('close', null, 'SIGTERM');
    await settle();

    expect(heard).toEqual([
      ['ended', { status: null, error: 'Sign-in cancelled' }],
    ]);
    expect(login.signals).toEqual(['SIGTERM']);
    expect(spawned.map((spawn) => spawn.args)).toEqual([
      ['auth', 'status', '--json'],
      ['auth', 'login'],
    ]);
  });

  it('logIn_SendCode_WritesCodeLine', async () => {
    const before = authChild();
    const login = authChild();
    const { harness } = authHarness([before, login]);

    harness.logIn(null, recordingLogIn().events).sendCode('abc#123');
    await settle();

    expect(login.lines).toEqual(['abc#123']);
  });

  it('logIn_LinkOnStderrSplitAcrossChunks_LinksOnce', async () => {
    const before = authChild();
    const login = authChild();
    const { harness } = authHarness([before, login]);
    const { heard, events } = recordingLogIn();

    harness.logIn(null, events);
    login.stderr.write('visit: https://claude.ai/oau');
    await settle();
    login.stderr.write('th/authorize\n');
    await settle();
    login.stderr.write('visit: https://claude.ai/other\n');
    await settle();

    expect(heard).toEqual([['link', 'https://claude.ai/oauth/authorize']]);
  });

  it('logIn_StderrChunkBetweenStdoutHalves_LinksStdoutLine', async () => {
    const before = authChild();
    const login = authChild();
    const { harness } = authHarness([before, login]);
    const { heard, events } = recordingLogIn();

    harness.logIn(null, events);
    login.stdout.write('visit: https://claude.ai/oau');
    await settle();
    login.stderr.write('warning: slow network\n');
    await settle();
    login.stdout.write('th/authorize\n');
    await settle();

    expect(heard).toEqual([['link', 'https://claude.ai/oauth/authorize']]);
  });

  const otherAccountStatus = JSON.stringify({
    loggedIn: true,
    email: 'sam@example.com',
  });
  // No email reads as `account: null`, the same account a signed-out status
  // carries.
  const signedInNoAccountStatus = JSON.stringify({ loggedIn: true });

  it.each([
    {
      name: 'still signed out ends with the last stderr line',
      before: { stdout: signedOutStatus, code: 0 },
      login: { stderr: 'Starting sign-in\nInvalid code\n', code: 1 },
      after: signedOutStatus,
      status: { signedIn: false, account: null },
      error: 'Invalid code',
    },
    {
      name: 'still signed out with no stderr ends naming the exit code',
      before: { stdout: signedOutStatus, code: 0 },
      login: { stderr: '', code: 3 },
      after: signedOutStatus,
      status: { signedIn: false, account: null },
      error: expect.stringMatching(/\b3\b/),
    },
    {
      name: 'a failed exit on the same signed-in account ends with an error',
      before: { stdout: signedInStatus, code: 0 },
      login: { stderr: '', code: 4 },
      after: signedInStatus,
      status: { signedIn: true, account: 'jo@example.com · Claude max' },
      error: expect.stringMatching(/\b4\b/),
    },
    {
      name: 'a failed exit that switched account ends signed in',
      before: { stdout: signedInStatus, code: 0 },
      login: { stderr: '', code: 1 },
      after: otherAccountStatus,
      status: { signedIn: true, account: 'sam@example.com' },
      error: null,
    },
    {
      name: 'a zero exit on the same account ends signed in',
      before: { stdout: signedInStatus, code: 0 },
      login: { stderr: '', code: 0 },
      after: signedInStatus,
      status: { signedIn: true, account: 'jo@example.com · Claude max' },
      error: null,
    },
    {
      name: 'a failed status before and signed in after ends signed in',
      before: { stdout: '', code: 1 },
      login: { stderr: '', code: 1 },
      after: signedInStatus,
      status: { signedIn: true, account: 'jo@example.com · Claude max' },
      error: null,
    },
    {
      name: 'signed out before and signed in with no account after ends signed in',
      before: { stdout: signedOutStatus, code: 0 },
      login: { stderr: '', code: 1 },
      after: signedInNoAccountStatus,
      status: { signedIn: true, account: null },
      error: null,
    },
  ])('logIn: $name', async ({ before, login, after, status, error }) => {
    const beforeChild = authChild();
    const loginChild = authChild();
    const statusChild = authChild();
    const { harness } = authHarness([beforeChild, loginChild, statusChild]);
    const { heard, events } = recordingLogIn();

    harness.logIn(null, events);
    await exitWith(beforeChild, before.stdout, before.code);
    if (login.stderr) {
      loginChild.stderr.write(login.stderr);
      await settle();
    }
    loginChild.emitter.emit('close', login.code, null);
    await exitWith(statusChild, after, 0);

    expect(heard).toEqual([['ended', { status, error }]]);
  });

  it('logOut_NonZeroExit_RejectsWithStderr', async () => {
    const child = authChild();
    const { harness } = authHarness([child]);

    const rejected = expect(harness.logOut(null)).rejects.toThrow(
      /2.*not signed in/,
    );
    child.stderr.write('not signed in\n');
    await exitWith(child, '', 2);

    await rejected;
  });

  it('planUsage_MeasuredReport_ResolvesWithProfileEnv', async () => {
    const child = authChild();
    let now = 1000;
    const { harness, spawned } = authHarness([child], { now: () => now });
    let isStdinEnded = false;
    child.child.stdin.on('finish', () => {
      isStdinEnded = true;
    });

    const usage = harness.planUsage('~/.claude-personal');
    now = 4000;
    await exitWith(child, `${REPORT_LINE}\n`, 0);

    const resolved = await usage;
    expect(resolved.rows.map((row) => row.label)).toEqual([
      '5h',
      'Week',
      'Fable',
    ]);
    expect(resolved.at).toBe(1000);
    expect(isStdinEnded).toBe(true);
    expect(spawned).toEqual([
      {
        args: [
          '-p',
          '/usage',
          '--output-format',
          'stream-json',
          '--verbose',
          '--no-session-persistence',
        ],
        options: {
          cwd: '/Users/u',
          env: {
            HOME: '/Users/u',
            CLAUDE_CONFIG_DIR: '/Users/u/.claude-personal',
          },
        },
      },
    ]);
  });

  it.each([
    {
      name: 'SpawnNotFound',
      finish: async (child: ReturnType<typeof authChild>) => {
        child.setPid(undefined);
        child.emitter.emit(
          'error',
          Object.assign(new Error('spawn /bin/claude ENOENT'), {
            code: 'ENOENT',
          }),
        );
      },
      reason: 'claude was not found at /bin/claude; set claude-code.command',
    },
    {
      name: 'NotSignedIn',
      finish: async (child: ReturnType<typeof authChild>) => {
        child.stderr.write('Not logged in\n');
        await exitWith(child, '', 1);
      },
      reason: 'exited with code 1: Not logged in',
    },
    {
      name: 'NoReport',
      finish: (child: ReturnType<typeof authChild>) =>
        exitWith(child, '{}\n', 0),
      reason: 'printed no usage report',
    },
  ])('planUsage_Fails_$name', async ({ finish, reason }) => {
    const child = authChild();
    const { harness } = authHarness([child]);

    const rejected = expect(harness.planUsage(null)).rejects.toThrow(reason);
    await finish(child);

    await rejected;
  });

  it('planUsage_NoAnswer_KillsAndRejectsAfterTimeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = authChild();
    const { harness } = authHarness([child]);
    let failure: unknown = null;

    harness.planUsage(null).catch((error: unknown) => {
      failure = error;
    });
    vi.advanceTimersByTime(PLAN_USAGE_TIMEOUT_MS - 1);
    await settle();
    expect(child.signals).toEqual([]);
    expect(failure).toBeNull();
    vi.advanceTimersByTime(1);
    await settle();

    expect(child.signals).toEqual(['SIGKILL']);
    expect((failure as Error).message).toBe(
      'claude -p /usage gave no answer in 20 s',
    );
  });

  it('accountStatus_NonZeroExit_RejectsWithStderr', async () => {
    const child = authChild();
    const { harness } = authHarness([child]);

    const rejected = expect(harness.accountStatus(null)).rejects.toThrow(
      /1.*config unreadable/,
    );
    child.stderr.write('config unreadable\n');
    await exitWith(child, '', 1);

    await rejected;
  });
});

describe('createClaudeCodeHarness on the session host', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // A harness on `host`; `processes.spawn` throws, since no session may reach it.
  function hostHarness(
    host: SessionHost,
    harnessClock: Clock,
    overrides: {
      env?: Readonly<Record<string, string>>;
      paths?: Paths;
      files?: Files;
    } = {},
  ) {
    let uuidCount = 0;
    return createClaudeCodeHarness({
      command: () => '/bin/claude',
      permissionTool: 'tool',
      profiles: () => [],
      env: overrides.env ?? {},
      log: () => {},
      host,
      processes: childProcesses([]),
      files: overrides.files ?? createMemoryFiles(),
      homeDir: '/Users/u',
      paths: overrides.paths ?? posixPaths,
      clock: harnessClock,
      randomUuid: () => {
        uuidCount += 1;
        return `uuid-${uuidCount}`;
      },
    });
  }

  const asText = (line: object | string) =>
    typeof line === 'string' ? line : JSON.stringify(line);

  // Pipe lines one second apart from 1000, unless a row gives its `at`.
  function logOf(
    lines: readonly {
      dir: PipeDirection;
      line: object | string;
      at?: number;
    }[],
  ): PipeLine[] {
    return lines.map(({ dir, line, at }, index) => ({
      seq: index + 1,
      dir,
      at: at ?? 1000 * (index + 1),
      text: asText(line),
    }));
  }

  const SEND_LINE = userMessage({ text: 'hi', images: [] }, 'uuid-1');
  const interruptRequest = (requestId: string) => ({
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'interrupt' },
  });
  // A send and its turn up to its `started`.
  const WORKING_LOG = [
    { dir: 'in', line: SEND_LINE },
    { dir: 'out', line: lifecycleInit },
    { dir: 'out', line: lifecycle('uuid-1', 'started') },
  ] as const;
  const ENDED_TURN_LOG = [
    ...WORKING_LOG,
    { dir: 'out', line: successResult('ok', ['uuid-1']) },
  ] as const;
  const running = (log: PipeLine[]) => ({
    id: 'p-1',
    startedAt: 1000,
    current: true,
    log,
  });
  const entriesOf = (timeline: [string, unknown][]) =>
    timeline.flatMap(([name, payload]) =>
      name === 'entry' ? [payload as ChatEntry] : [],
    );

  it('start_SpawnsThroughTheHost', () => {
    const host = createFakeSessionHost(clock);

    hostHarness(host, clock).start(request, recordingEvents().events);

    expect(host.processes[0].request).toEqual({
      id: 'p-1',
      command: '/bin/claude',
      args: [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--session-id',
        's-1',
        '--permission-mode',
        'auto',
        '--permission-prompt-tool',
        'tool',
      ],
      cwd: '/proj',
      env: { WIGLEY_SESSION_ROW: 'row-1' },
      idleRule: {
        key: 'type',
        value: 'result',
        busyStdoutValues: expect.arrayContaining(['assistant', 'stream_event']),
        busyStdinValues: expect.arrayContaining(['user']),
      },
      droppedOutKeys: [
        ['response', 'response', 'effective'],
        ['response', 'response', 'sources'],
      ],
    });
    expect(host.processes[0].writes[0]).toBe(
      JSON.stringify(initializeRequest('wigley-1')),
    );
  });

  it('idleRule_LinesBetweenTurns_AreNotBusy', () => {
    // `user` on stdout: a `set_model` acknowledgement prints one with no turn.
    const stdoutBetweenTurns = [
      'system',
      'command_lifecycle',
      'control_response',
      'user',
    ];
    const stdinBetweenTurns = ['control_request', 'control_response'];

    expect(
      CLAUDE_IDLE_RULE.busyStdoutValues.filter((value) =>
        stdoutBetweenTurns.includes(value),
      ),
    ).toEqual([]);
    expect(
      CLAUDE_IDLE_RULE.busyStdinValues.filter((value) =>
        stdinBetweenTurns.includes(value),
      ),
    ).toEqual([]);
  });

  it.each([
    {
      via: 'start',
      run: async (host: FakeSessionHost, events: AgentProcessEvents) => {
        hostHarness(host, clock).start(request, events);
        host.spawned('p-1', 4321);
        await settle();
      },
    },
    {
      via: 'attach',
      run: async (host: FakeSessionHost, events: AgentProcessEvents) => {
        host.addRunning({ ...running(logOf(ENDED_TURN_LOG)), pid: 4321 });
        await hostHarness(host, clock).attach(request, events);
      },
    },
  ])('pid_FromTheHost_ReachesTheEvents: via $via', async ({ run }) => {
    const host = createFakeSessionHost(clock);
    const { heard, events } = recordingEvents();

    await run(host, events);

    expect(heard.filter(([name]) => name === 'pid')).toEqual([['pid', 4321]]);
  });

  it('start_HostSpawnFails_EndsWithHint', async () => {
    const host = createFakeSessionHost(clock);
    host.failNextSpawn('spawn /bin/claude ENOENT');
    const { heard, events } = recordingEvents();

    hostHarness(host, clock).start(request, events);
    await settle();

    const ended = heard.filter(([name]) => name === 'ended');
    expect(ended).toEqual([
      [
        'ended',
        { code: null, error: expect.stringMatching(/\/bin\/claude.*\/proj/) },
      ],
    ]);
  });

  it('attach_RecordedLiveSession_EqualsTheLiveRun', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let at = 1000;
    const stepClock = { now: () => at };
    const host = createFakeSessionHost(stepClock);
    const a = recordingEvents();
    const agent = hostHarness(host, stepClock).start(request, a.events);
    await settle();
    const startedAt = at;
    const step = async (action: () => void) => {
      at += 1000;
      action();
      await settle();
    };
    const out = (line: object | string) =>
      step(() => host.output('p-1', 'out', asText(line)));

    await out({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'wigley-1',
        response: {
          commands: [{ name: 'compact', description: 'Compact the context' }],
        },
      },
    });
    await out(contextReply('wigley-2', 1000000, 967000));
    await out(
      settingsReply('wigley-3', { model: 'claude-opus-5-5', effort: 'medium' }),
    );
    await step(() => agent.send({ text: 'hi', images: [] }));
    await out(lifecycleInit);
    await out(lifecycle('uuid-1', 'started'));
    await out(REPLY_LINE);
    await out(successResult('ok', ['uuid-1']));
    await step(() => agent.setControl('mode', 'plan'));
    await out({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'wigley-6' },
    });
    await step(() => agent.setControl('effort', 'high'));
    await out(successResult('Set effort level to high', ['00000000-2']));
    await out(
      settingsReply('wigley-8', { model: 'claude-opus-5-5', effort: 'high' }),
    );
    await step(() => agent.send({ text: 'two', images: [] }));
    await out(lifecycleInit);
    await out(lifecycle('uuid-3', 'started'));
    await step(() => agent.interrupt());
    const interruptedAt = at;
    await step(() => host.output('p-1', 'err', 'warn'));
    at = interruptedAt + 5000;
    vi.advanceTimersByTime(5000);
    await settle();
    const record = host.processes[0];
    const writesBeforeAttach = record.writes.length;

    const b = recordingEvents();
    const attached = await hostHarness(host, stepClock).attach(
      request,
      b.events,
    );
    const replayedTimeline = [...b.timeline];

    const lastVersions = (entries: readonly ChatEntry[]) => {
      const byId = new Map<string, ChatEntry>();
      for (const entry of entries) {
        byId.set(entry.id, entry);
      }
      return [...byId.values()];
    };
    const agentEventsOf = (timeline: [string, unknown][]) =>
      timeline.flatMap(([name, payload]) =>
        name === 'agentEvent' ? [payload as AgentEvent] : [],
      );
    const lastOf = (name: string) =>
      a.timeline.filter(([heardName]) => heardName === name).at(-1);
    const settingsRead: AgentEvent = {
      type: 'usage',
      agentId: 'main',
      at: startedAt,
      contextTokens: 0,
      contextWindow: null,
      autocompact: { configured: null, reported: null },
      cacheExpiresAt: null,
      spendUsd: null,
    };

    expect(replayedTimeline[0]).toEqual([
      'agentEvent',
      { type: 'sessionStarted', at: record.log[0].at },
    ]);
    expect(entriesOf(replayedTimeline)).toEqual(
      lastVersions(entriesOf(a.timeline)),
    );
    expect(agentEventsOf(a.timeline)).toContainEqual(settingsRead);
    expect(agentEventsOf(replayedTimeline)).toEqual(
      agentEventsOf(a.timeline).filter(
        (event) => JSON.stringify(event) !== JSON.stringify(settingsRead),
      ),
    );
    expect(replayedTimeline.slice(-3)).toEqual([
      lastOf('controls'),
      lastOf('commands'),
      lastOf('activity'),
    ]);
    expect(lastOf('controls')?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mode', value: 'plan' }),
        expect.objectContaining({ id: 'effort', value: 'high' }),
        expect.objectContaining({ id: 'model', value: 'opus' }),
      ]),
    );

    await settle();
    expect(b.timeline).toEqual(replayedTimeline);
    expect(record.writes).toHaveLength(writesBeforeAttach);

    const highestRequest = Math.max(
      ...record.log.flatMap((line) => {
        const id = /"request_id":"wigley-(\d+)"/.exec(line.text)?.[1];
        return line.dir === 'in' && id !== undefined ? [Number(id)] : [];
      }),
    );
    expect(attached?.send({ text: 'three', images: [] })).toBe('user-3');
    attached?.interrupt();
    expect(record.writes.at(-1)).toBe(
      JSON.stringify(interruptRequest(`wigley-${highestRequest + 1}`)),
    );
  });

  const HOST_REQUEST_OUT = {
    dir: 'out',
    line: {
      type: 'control_request',
      request_id: 'r-1',
      request: { subtype: 'can_use_tool' },
    },
  } as const;
  const REFUSAL = {
    type: 'control_response',
    response: {
      subtype: 'error',
      request_id: 'r-1',
      error: 'wigley-ai-gui answers no can_use_tool requests',
    },
  };
  const CONTEXT_REQUEST_IN = {
    dir: 'in',
    line: contextUsageRequest('wigley-1'),
  } as const;
  it.each([
    {
      case: 'turn ended while away',
      goesOn: [],
      closes: false,
      written: [contextUsageRequest('wigley-1'), settingsRequest('wigley-2')],
    },
    {
      case: 'context request already written',
      goesOn: [CONTEXT_REQUEST_IN],
      closes: false,
      written: [settingsRequest('wigley-2')],
    },
    {
      case: 'closed during attach',
      goesOn: [HOST_REQUEST_OUT],
      closes: true,
      written: [],
    },
    {
      case: 'host request unanswered while away',
      goesOn: [CONTEXT_REQUEST_IN, HOST_REQUEST_OUT],
      closes: false,
      written: [REFUSAL, settingsRequest('wigley-2')],
    },
    {
      case: 'host request and context request both owed',
      goesOn: [HOST_REQUEST_OUT],
      closes: false,
      written: [
        REFUSAL,
        contextUsageRequest('wigley-1'),
        settingsRequest('wigley-2'),
      ],
    },
    {
      case: 'host request already refused',
      goesOn: [
        HOST_REQUEST_OUT,
        { dir: 'in', line: REFUSAL },
        CONTEXT_REQUEST_IN,
      ],
      closes: false,
      written: [settingsRequest('wigley-2')],
    },
  ] as {
    case: string;
    goesOn: { dir: PipeDirection; line: object }[];
    closes: boolean;
    written: object[];
  }[])(
    'attach_OwedWhileDetached_WritesEachOnce ($case)',
    async ({ goesOn, closes, written }) => {
      const host = createFakeSessionHost(clock);
      const record = host.addRunning(
        running(logOf([...ENDED_TURN_LOG, ...goesOn])),
      );

      const attaching = hostHarness(host, clock).attach(
        request,
        recordingEvents().events,
      );
      if (closes) {
        host.close('p-1', { code: 0, signal: null, error: null });
      }
      await attaching;
      await settle();

      expect(record.writes).toEqual(
        written.map((line) => JSON.stringify(line)),
      );
    },
  );

  it('attach_WritesNoInitialize', async () => {
    const host = createFakeSessionHost(clock);
    const record = host.addRunning(running(logOf([])));

    await hostHarness(host, clock).attach(request, recordingEvents().events);
    await settle();

    expect(record.writes).toEqual([
      JSON.stringify(settingsRequest('wigley-1')),
    ]);
  });

  it.each([
    {
      case: 'a log holding the request and its reply',
      goesOn: [
        { dir: 'in', line: settingsRequest('wigley-1') },
        {
          dir: 'out',
          line: settingsReply('wigley-1', {
            model: 'claude-sonnet-5-5',
            effort: 'low',
          }),
        },
      ],
      written: [],
      controls: { mode: 'auto', effort: 'low', model: 'sonnet' },
    },
    {
      case: 'a log with no request',
      goesOn: [],
      written: [settingsRequest('wigley-1')],
      controls: { mode: 'auto', effort: null, model: null },
    },
    {
      case: 'a log holding the request with its reply still to come',
      goesOn: [
        { dir: 'in', line: contextUsageRequest('wigley-1') },
        { dir: 'in', line: settingsRequest('wigley-2') },
      ],
      written: [],
      controls: { mode: 'auto', effort: null, model: null },
      live: {
        reply: settingsReply('wigley-2', {
          model: 'claude-sonnet-5-5',
          effort: 'low',
        }),
        controls: { mode: 'auto', effort: 'low', model: 'sonnet' },
      },
    },
  ] as {
    case: string;
    goesOn: { dir: PipeDirection; line: object }[];
    written: object[];
    controls: Record<string, string | null>;
    live?: { reply: object; controls: Record<string, string | null> };
  }[])(
    'attach_SettingsRequest_RebuiltOrWritten ($case)',
    async ({ goesOn, written, controls, live }) => {
      const host = createFakeSessionHost(clock);
      const record = host.addRunning(running(logOf(goesOn)));
      const { heard, timeline, events } = recordingEvents();
      const heardControls = () => {
        const replayed = heard
          .filter(([name]) => name === 'controls')
          .at(-1)?.[1];
        return Object.fromEntries(
          (replayed as { id: string; value: string | null }[]).map(
            ({ id, value }) => [id, value],
          ),
        );
      };

      await hostHarness(host, clock).attach(request, events);
      await settle();

      expect(record.writes).toEqual(
        written.map((line) => JSON.stringify(line)),
      );
      expect(heardControls()).toEqual(controls);
      if (live !== undefined) {
        host.output('p-1', 'out', asText(live.reply));
        await settle();
        expect(heardControls()).toEqual(live.controls);
      }
      expect(entriesOf(timeline)).toEqual([]);
    },
  );

  it.each([
    {
      case: 'saved replies read',
      transcript: SAVED_REPLY_LINE,
      cacheExpiresAt: 9000 + 3_600_000,
    },
    { case: 'transcript missing', transcript: null, cacheExpiresAt: null },
  ])(
    'attach_ResumedProcess_SavedRepliesFoldBeforeTheLog ($case)',
    async ({ transcript, cacheExpiresAt }) => {
      const cacheReadReply = {
        type: 'assistant',
        message: {
          model: 'claude-opus-5-5',
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          usage: {
            input_tokens: 3,
            cache_read_input_tokens: 40000,
            output_tokens: 120,
          },
        },
        parent_tool_use_id: null,
      };
      const host = createFakeSessionHost(clock);
      host.addRunning(
        running(logOf([{ dir: 'out', line: cacheReadReply, at: 9000 }])),
      );
      const files = createMemoryFiles();
      if (transcript !== null) {
        await files.write(TRANSCRIPT, transcript);
      }
      const { heard, events } = recordingEvents();

      const attached = await hostHarness(host, clock, { files }).attach(
        resumeRequest,
        events,
      );

      expect(attached).not.toBeNull();
      expect(heard.filter(([name]) => name === 'agentEvent').at(-1)).toEqual([
        'agentEvent',
        expect.objectContaining({
          type: 'usage',
          at: 9000,
          contextTokens: 40123,
          cacheExpiresAt,
        }),
      ]);
    },
  );

  it('attach_LoggedSubagent_DecodesWithItsDefinition', async () => {
    const files = createMemoryFiles();
    await files.write(
      '/proj/.claude/agents/mapper.md',
      '---\nname: mapper\nmodel: sonnet\neffort: high\n---\nYou map.\n',
    );
    const host = createFakeSessionHost(clock);
    host.addRunning(
      running(
        logOf([
          {
            dir: 'out',
            line: {
              type: 'assistant',
              message: {
                model: 'claude-opus-5-5',
                id: 'msg_1',
                role: 'assistant',
                content: [
                  {
                    type: 'tool_use',
                    id: 'a1',
                    name: 'Agent',
                    input: {
                      description: 'map',
                      subagent_type: 'mapper',
                      prompt: 'x',
                    },
                  },
                ],
              },
              parent_tool_use_id: null,
            },
          },
        ]),
      ),
    );
    const { agentEvents, events } = recordingEvents();

    await hostHarness(host, clock, { files }).attach(request, events);

    expect(
      agentEvents.filter((event) => event.type === 'agentSpawned'),
    ).toEqual([expect.objectContaining({ model: 'sonnet', effort: 'high' })]);
  });

  it('attach_DefinitionsReject_DetachesTheHostedProcess', async () => {
    const host = createFakeSessionHost(clock);
    const record = host.addRunning(running(logOf(ENDED_TURN_LOG)));
    const paths: Paths = {
      ...posixPaths,
      join(...parts) {
        if (parts.join('/') === '/proj/.claude/agents') {
          throw new Error('no join');
        }
        return posixPaths.join(...parts);
      },
    };
    const { timeline, events } = recordingEvents();

    await expect(
      hostHarness(host, clock, { paths }).attach(request, events),
    ).rejects.toThrow('no join');
    host.output('p-1', 'out', REPLY_LINE);
    await settle();

    expect(record.detaches).toBe(1);
    expect(timeline).toEqual([]);
  });

  it.each([
    { case: 'no record', arrange: () => {} },
    {
      case: 'not current',
      arrange: (host: FakeSessionHost) =>
        host.addRunning({ ...running([]), current: false }),
    },
    {
      case: 'closed',
      arrange: (host: FakeSessionHost) => {
        host.addRunning(running([]));
        host.close('p-1', { code: 0, signal: null, error: null });
      },
    },
  ])('attach_Cases_ResolvesByHostState ($case)', async ({ arrange }) => {
    const host = createFakeSessionHost(clock);
    arrange(host);
    const { timeline, events } = recordingEvents();

    const attached = await hostHarness(host, clock).attach(request, events);
    await settle();

    expect(attached).toBeNull();
    expect(timeline).toEqual([]);
  });

  describe('attach_GraceAcrossTheBoundary', () => {
    const graceLog = [
      { dir: 'in', line: SEND_LINE, at: 100 },
      { dir: 'out', line: lifecycleInit, at: 200 },
      { dir: 'out', line: lifecycle('uuid-1', 'started'), at: 300 },
      { dir: 'in', line: interruptRequest('wigley-1'), at: 1000 },
    ] as const;
    const graceNotices = (timeline: [string, unknown][]) =>
      entriesOf(timeline).filter(
        (entry) => entry.kind === 'notice' && entry.text === GRACE_NOTICE,
      );

    it('attach_GraceAcrossTheBoundary (expired while away)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const at60 = { now: () => 60000 };
      const host = createFakeSessionHost(at60);
      host.addRunning(running(logOf(graceLog)));
      const { heard, timeline, events } = recordingEvents();

      await hostHarness(host, at60).attach(request, events);

      expect(graceNotices(timeline).map((entry) => entry.at)).toEqual([6000]);
      expect(lastActivity(heard)).toBe('idle');
      const heardAtResolve = timeline.length;
      await settle();
      vi.advanceTimersByTime(10000);
      await settle();
      // The log holds no usage event, so the settings read reports its first.
      expect(
        timeline
          .slice(heardAtResolve)
          .map(([name, payload]) =>
            name === 'agentEvent' ? (payload as AgentEvent).type : name,
          ),
      ).toEqual(['usage']);
    });

    it('attach_GraceAcrossTheBoundary (still pending)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const at3 = { now: () => 3000 };
      const host = createFakeSessionHost(at3);
      host.addRunning(running(logOf(graceLog)));
      const { heard, timeline, events } = recordingEvents();

      await hostHarness(host, at3).attach(request, events);

      expect(graceNotices(timeline)).toEqual([]);
      expect(lastActivity(heard)).toBe('working');
      await settle();
      vi.advanceTimersByTime(2999);
      await settle();
      expect(graceNotices(timeline)).toEqual([]);
      vi.advanceTimersByTime(1);
      await settle();
      expect(graceNotices(timeline).map((entry) => entry.at)).toEqual([6000]);
      expect(lastActivity(heard)).toBe('idle');
    });
  });

  it('attach_LineDuringAttach_FoldsOnce', async () => {
    const host = createFakeSessionHost(clock);
    host.addRunning(running(logOf(ENDED_TURN_LOG)));
    const lateLine = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'late' }],
      },
      parent_tool_use_id: null,
    });
    const deliversDuringAttach: SessionHost = {
      ...host,
      async attach(id, hostedEvents) {
        const result = await host.attach(id, hostedEvents);
        const lastLine = result?.log.at(-1);
        if (lastLine !== undefined) {
          hostedEvents.line(lastLine);
        }
        host.output(id, 'out', lateLine);
        return result;
      },
    };
    const { timeline, agentEvents, events } = recordingEvents();

    await hostHarness(deliversDuringAttach, clock).attach(request, events);

    expect(
      agentEvents.filter((event) => event.type === 'turnEnded'),
    ).toHaveLength(1);
    expect(
      entriesOf(timeline).filter(
        (entry) => entry.kind === 'assistant' && entry.text === 'late',
      ),
    ).toHaveLength(1);
  });

  it.each([
    {
      case: 'taken in while away',
      logged: [lifecycle('uuid-1', 'started')],
      live: [],
      closes: true,
      drops: 0,
    },
    {
      case: 'dropped while away',
      logged: [lifecycle('uuid-1', 'cancelled')],
      live: [],
      closes: true,
      drops: 1,
    },
    {
      case: 'dropped once live',
      logged: [],
      live: [lifecycle('uuid-1', 'cancelled')],
      closes: true,
      drops: 1,
    },
    {
      case: 'still held when the process closes',
      logged: [],
      live: [],
      closes: true,
      drops: 1,
    },
    {
      case: 'still held, process running',
      logged: [],
      live: [],
      closes: false,
      drops: 0,
    },
  ])(
    'attach_MessageWrittenBeforeIt_ReportedOnceIfDropped ($case)',
    async ({ logged, live, closes, drops }) => {
      const host = createFakeSessionHost(clock);
      host.addRunning(
        running(
          logOf([
            {
              dir: 'in',
              line: userMessage({ text: 'hi', images: [] }, 'uuid-1'),
            },
            { dir: 'out', line: lifecycleInit },
            ...logged.map((line) => ({ dir: 'out' as const, line })),
          ]),
        ),
      );
      const { timeline, events } = recordingEvents();

      await hostHarness(host, clock).attach(request, events);
      for (const line of live) {
        host.output('p-1', 'out', asText(line));
      }
      if (closes) {
        host.close('p-1', { code: 0, signal: null, error: null });
      }
      await settle();

      const names = timeline.map(([name]) => name);
      expect(timeline.filter(([name]) => name === 'messageDropped')).toEqual(
        Array.from({ length: drops }, () => [
          'messageDropped',
          { entryId: 'user-1', message: { text: 'hi', images: [] } },
        ]),
      );
      if (drops === 1) {
        expect(names.indexOf('messageDropped')).toBeLessThan(
          closes ? names.indexOf('ended') : names.length,
        );
      }
    },
  );

  it('attach_ClosedDuringAttach_EndsAfterTheReplay', async () => {
    const host = createFakeSessionHost(clock);
    host.addRunning(running(logOf(ENDED_TURN_LOG)));
    const { timeline, events } = recordingEvents();

    const attaching = hostHarness(host, clock).attach(request, events);
    host.close('p-1', { code: 0, signal: null, error: null });
    await attaching;
    await settle();

    expect(timeline[0]).toEqual([
      'agentEvent',
      { type: 'sessionStarted', at: 1000 },
    ]);
    expect(timeline.slice(-4)).toEqual([
      ['activity', 'idle'],
      [
        'entry',
        expect.objectContaining({ id: 'user-1', delivery: 'notReceived' }),
      ],
      ['agentEvent', { type: 'sessionEnded', at: 1000 }],
      ['ended', { code: 0, error: null }],
    ]);
  });

  describe('detach', () => {
    async function startedOnHost() {
      const host = createFakeSessionHost(clock);
      const recording = recordingEvents();
      const agent = hostHarness(host, clock).start(request, recording.events);
      await settle();
      const forgetHeard = () => {
        recording.heard.length = 0;
        recording.agentEvents.length = 0;
        recording.timeline.length = 0;
      };
      forgetHeard();
      return {
        host,
        agent,
        record: host.processes[0],
        forgetHeard,
        ...recording,
      };
    }

    it('detach_ThenOutputAndClose_FiresNothing', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { host, agent, record, timeline, forgetHeard } =
        await startedOnHost();
      agent.send({ text: 'hi', images: [] });
      agent.interrupt();
      await settle();
      forgetHeard();

      agent.detach();
      agent.detach();
      host.output('p-1', 'out', REPLY_LINE);
      host.close('p-1', { code: 0, signal: null, error: null });
      await settle();

      expect(timeline).toEqual([]);
      expect(record.detaches).toBe(1);
      expect(record.kills).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      expect(() => agent.send({ text: 'x', images: [] })).toThrow(
        'Claude Code process has detached',
      );
      expect(() => agent.interrupt()).toThrow(
        'Claude Code process has detached',
      );
      expect(() => agent.setControl('mode', 'plan')).toThrow(
        'Claude Code process has detached',
      );
      await agent.end();
      agent.kill();
      expect(record.kills).toEqual([]);
    });

    it('detach_PendingEnd_Settles', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { agent, record, heard } = await startedOnHost();

      const ending = agent.end();
      agent.detach();
      await ending;
      vi.advanceTimersByTime(6000);
      await settle();

      expect(heard.filter(([name]) => name === 'ended')).toEqual([]);
      expect(record.kills).toEqual([]);
    });

    it('detach_QueuedEmission_Dropped', async () => {
      const { host, agent, timeline } = await startedOnHost();

      host.output('p-1', 'out', REPLY_LINE);
      agent.detach();
      await settle();

      expect(timeline).toEqual([]);
    });

    it('attach_AfterDetach_ReplaysAgain', async () => {
      const { host, agent } = await startedOnHost();
      agent.send({ text: 'hi', images: [] });
      for (const line of [
        lifecycleInit,
        lifecycle('uuid-1', 'started'),
        successResult('ok', ['uuid-1']),
      ]) {
        host.output('p-1', 'out', asText(line));
      }
      await settle();
      agent.detach();
      const { timeline, events } = recordingEvents();

      await hostHarness(host, clock).attach(request, events);

      expect(timeline[0]).toEqual([
        'agentEvent',
        { type: 'sessionStarted', at: 1000 },
      ]);
      expect(entriesOf(timeline).map((entry) => entry.id)).toContain('user-1');
    });
  });
});
