import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  AgentProcessEvents,
  AgentStart,
  LogInEvents,
} from '../../contracts/agent';
import type { Clock } from '../../contracts/ambient';
import { createMemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import type { Files } from '../../contracts/files';
import {
  createClaudeCodeHarness,
  type ClaudeSpawn,
  PLAN_USAGE_TIMEOUT_MS,
} from './claude-code-harness';
import { controlMessage, userMessage } from './claude-controls';

const request: AgentStart = {
  processId: 'p-1',
  sessionId: 's-1',
  resume: false,
  projectDir: '/proj',
  profileDir: null,
  controls: {},
  instructions: [],
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

const clock = { now: () => 1000 };

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
    messageDropped: (entryId) => hear('messageDropped', entryId),
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
  '{"type":"control_response","response":{"subtype":"success","request_id":"wigley-1","response":{"autoCompactThreshold":967000,"autocompactSource":"model-default","maxTokens":1000000,"rawMaxTokens":1000000,"isAutoCompactEnabled":true}}}';

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

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function started(
  fake = fakeChild(),
  files: Files = createMemoryFiles(),
  harnessClock: Clock = clock,
  startRequest: AgentStart = request,
) {
  const logged: [string, string][] = [];
  const spawn: ClaudeSpawn = () => fake.child;
  let uuidCount = 0;
  const harness = createClaudeCodeHarness({
    command: () => '/bin/claude',
    permissionTool: 'tool',
    env: {},
    log: (source, message) => logged.push([source, message]),
    spawn,
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

describe('createClaudeCodeHarness', () => {
  it('start_EmitsNullControlsThenIdle', async () => {
    const run = started();
    expect(run.heard).toEqual([]);

    await settle();

    expect(run.heard[0][0]).toBe('controls');
    const controls = run.heard[0][1] as { id: string; value: unknown }[];
    expect(controls.map((control) => [control.id, control.value])).toEqual([
      ['mode', null],
      ['effort', null],
      ['model', null],
    ]);
    expect(run.heard[1]).toEqual(['activity', 'idle']);
  });

  it('start_RequestControls_SeedStartingValues', async () => {
    const run = started(fakeChild(), createMemoryFiles(), clock, {
      ...request,
      controls: { model: 'sonnet' },
    });

    await settle();

    expect(run.heard[0][0]).toBe('controls');
    const controls = run.heard[0][1] as { id: string; value: unknown }[];
    expect(controls.map((control) => [control.id, control.value])).toEqual([
      ['mode', null],
      ['effort', null],
      ['model', 'sonnet'],
    ]);
  });

  it('send_WritesUserMessageAndEmitsWorking', async () => {
    const run = await startedQuiet();

    run.agent.send({ text: 'hi', images: [] });
    await settle();

    const message = userMessage({ text: 'hi', images: [] }, 'uuid-1');
    expect(run.written).toEqual([contextUsageRequest('wigley-1'), message]);
    expect(run.heard).toEqual([['activity', 'working']]);
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
        ['messageDropped', 'user-1'],
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
        request_id: 'wigley-2',
        response: { mode: 'plan' },
      },
    });
    await settle();

    expect(run.written).toEqual([
      contextUsageRequest('wigley-1'),
      controlMessage('mode', 'plan', 'wigley-2'),
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
      contextUsageRequest('wigley-1'),
      controlMessage('effort', 'high', 'uuid-1'),
      contextUsageRequest('wigley-2'),
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
    expect(run.written[4]).toEqual({
      type: 'control_request',
      request_id: 'wigley-3',
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
    writeLine(run.stdout, contextReply('wigley-2', 200_000, 167_000));
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
      contextUsageRequest('wigley-1'),
      userMessage({ text: 'hi', images: [] }, 'uuid-1'),
      contextUsageRequest('wigley-2'),
    ]);
  });

  describe('usage reads', () => {
    const SAVED_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
    const TRANSCRIPT = `/Users/u/.claude/projects/-proj/${SAVED_ID}.jsonl`;
    const resumeRequest: AgentStart = {
      ...request,
      sessionId: SAVED_ID,
      resume: true,
    };
    const SAVED_USER_LINE = JSON.stringify({
      type: 'user',
      timestamp: '2026-10-27T16:07:00.000Z',
      message: { role: 'user', content: 'hi' },
    });
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
        request_id: 'wigley-2',
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

    expect(run.written[4]).toEqual({
      type: 'control_request',
      request_id: 'wigley-3',
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

  it('send_EffortValueNotAChoice_LeavesEffortUnknown', async () => {
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
            request_id: 'wigley-2',
            response: { still_queued: [] },
          },
        }
      : {
          type: 'control_response',
          response: { subtype: 'error', request_id: 'wigley-2', error },
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
          error: expect.stringMatching(/\/bin\/claude.*\/proj/),
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
    env: NodeJS.ProcessEnv,
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
      env,
      log: () => {},
      spawn: () => fakeChild().child,
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
    const spawned: {
      args: readonly string[];
      options: { cwd: string; env: NodeJS.ProcessEnv };
    }[] = [];
    const queue = [...children];
    const harness = createClaudeCodeHarness({
      command: () => '/bin/claude',
      permissionTool: 'tool',
      env: { HOME: '/Users/u', CLAUDECODE: '1' },
      log: () => {},
      spawn: (_command, args, options) => {
        spawned.push({ args, options });
        const next = queue.shift();
        if (next === undefined) {
          throw new Error('no child left to spawn');
        }
        return next.child;
      },
      files: createMemoryFiles(),
      homeDir: '/Users/u',
      paths: posixPaths,
      clock: harnessClock,
      randomUuid: () => 'uuid-1',
    });
    return { harness, spawned };
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
      reason: 'claude was not found at /bin/claude; set claude.command',
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
