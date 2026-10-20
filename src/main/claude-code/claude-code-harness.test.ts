import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentProcessEvents, AgentStart } from '../../contracts/agent';
import {
  createClaudeCodeHarness,
  type ClaudeSpawn,
} from './claude-code-harness';
import { controlMessage, userMessage } from './claude-controls';

const request: AgentStart = {
  sessionId: 's-1',
  resume: false,
  projectDir: '/proj',
  profileDir: null,
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

// Every event the process emits, as `[event name, payload]`, in emit order.
function recordingEvents() {
  const heard: [string, unknown][] = [];
  const events: AgentProcessEvents = {
    entry: (entry) => heard.push(['entry', entry]),
    controls: (controls) => heard.push(['controls', controls]),
    activity: (activity) => heard.push(['activity', activity]),
    commands: (names) => heard.push(['commands', names]),
    ended: (end) => heard.push(['ended', end]),
  };
  return { heard, events };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function started(fake = fakeChild()) {
  const logged: [string, string][] = [];
  const spawn: ClaudeSpawn = () => fake.child;
  const harness = createClaudeCodeHarness({
    command: '/bin/claude',
    permissionTool: 'tool',
    env: {},
    log: (source, message) => logged.push([source, message]),
    spawn,
  });
  const { heard, events } = recordingEvents();
  const agent = harness.start(request, events);
  return { ...fake, agent, heard, logged };
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

function successResult(result: string) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    total_cost_usd: 0,
    num_turns: 0,
  };
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

  it('send_WritesUserMessageAndEmitsWorking', async () => {
    const run = await startedQuiet();

    run.agent.send('hi');
    await settle();

    expect(run.written).toEqual([userMessage('hi')]);
    expect(run.heard).toEqual([
      [
        'entry',
        { kind: 'user', id: 'user-1', text: 'hi', raw: [userMessage('hi')] },
      ],
      ['activity', 'working'],
    ]);
  });

  it('setControl_Mode_WritesRequestAndReportsOnResponse', async () => {
    const run = await startedQuiet();

    run.agent.setControl('mode', 'plan');
    writeLine(run.stdout, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'wigley-1',
        response: { mode: 'plan' },
      },
    });
    await settle();

    expect(run.written).toEqual([controlMessage('mode', 'plan', 'wigley-1')]);
    const [name, controls] = run.heard[run.heard.length - 1];
    expect(name).toBe('controls');
    expect(controls).toContainEqual(
      expect.objectContaining({ id: 'mode', value: 'plan' }),
    );
  });

  it('setControl_EffortWhileWorking_Throws', async () => {
    const run = await startedQuiet();
    run.agent.send('hi');

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

    expect(run.written).toEqual([controlMessage('effort', 'high', '')]);
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
    run.agent.send('one');
    writeLine(run.stdout, errorResult);
    await settle();
    run.agent.send('two');

    run.agent.interrupt();
    await settle();

    const noticeIds = run.heard
      .map(([, payload]) => payload as { kind?: string; id?: string })
      .filter((entry) => entry.kind === 'notice')
      .map((entry) => entry.id);
    expect(noticeIds).toEqual(['notice-1', 'control-notice-1']);
    expect(run.written[2]).toEqual({
      type: 'control_request',
      request_id: 'wigley-1',
      request: { subtype: 'interrupt' },
    });
  });

  it('send_TwoMessagesOneResult_StaysWorking', async () => {
    const run = await startedQuiet();
    run.agent.send('one');
    run.agent.send('two');

    writeLine(run.stdout, successResult('1'));
    await settle();

    expect(lastActivity(run.heard)).toBe('working');
  });

  it('send_TwoMessagesTwoResults_GoesIdle', async () => {
    const run = await startedQuiet();
    run.agent.send('one');
    run.agent.send('two');

    writeLine(run.stdout, successResult('1'));
    writeLine(run.stdout, successResult('2'));
    await settle();

    expect(lastActivity(run.heard)).toBe('idle');
  });

  it('interrupt_WhileQueuedTurnRuns_WritesRequest', async () => {
    const run = await startedQuiet();
    run.agent.send('one');
    run.agent.send('two');
    writeLine(run.stdout, successResult('1'));
    await settle();

    run.agent.interrupt();

    expect(run.written[2]).toEqual({
      type: 'control_request',
      request_id: 'wigley-1',
      request: { subtype: 'interrupt' },
    });
  });

  it('send_ControlCommandQueuedBehindTurn_TakesItsOwnResult', async () => {
    const run = await startedQuiet();
    run.agent.send('one');
    run.agent.send('/effort high');

    writeLine(run.stdout, successResult('1'));
    await settle();
    expect(effortValue(run.heard)).toBeNull();
    expect(resultEntries(run.heard)).toHaveLength(1);

    writeLine(run.stdout, successResult('Set effort level to high'));
    await settle();

    expect(effortValue(run.heard)).toBe('high');
    expect(resultEntries(run.heard)).toHaveLength(1);
    expect(lastActivity(run.heard)).toBe('idle');
  });

  it('send_EffortValueNotAChoice_LeavesEffortUnknown', async () => {
    const run = await startedQuiet();
    run.agent.setControl('effort', 'high');
    writeLine(run.stdout, successResult('Set effort level to high'));
    await settle();
    expect(effortValue(run.heard)).toBe('high');

    run.agent.send('/effort auto');
    writeLine(run.stdout, successResult('Set effort level to auto'));
    await settle();

    expect(effortValue(run.heard)).toBeNull();
  });

  it('stderrAndExit_LogsAndEnds', async () => {
    const run = await startedQuiet();

    run.stderr.write('oops\n');
    await settle();
    run.emitter.emit('close', 1, null);
    await settle();

    expect(run.logged).toEqual([['claude', 'oops']]);
    expect(run.heard).toEqual([
      ['ended', { code: 1, error: 'claude exited with code 1: oops' }],
    ]);
    expect(() => run.agent.send('hi')).toThrow('Claude Code process has ended');
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
          error:
            'claude was not found at /bin/claude, or the project folder /proj does not exist; set claude.command',
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
});
