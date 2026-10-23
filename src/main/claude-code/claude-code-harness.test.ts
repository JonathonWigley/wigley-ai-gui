import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentProcessEvents,
  AgentStart,
  LogInEvents,
} from '../../contracts/agent';
import { createMemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
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
    command: () => '/bin/claude',
    permissionTool: 'tool',
    env: {},
    log: (source, message) => logged.push([source, message]),
    spawn,
    files: createMemoryFiles(),
    homeDir: '/Users/u',
    paths: posixPaths,
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

    run.agent.send({ text: 'hi', images: [] });
    await settle();

    const message = userMessage({ text: 'hi', images: [] });
    expect(run.written).toEqual([message]);
    expect(run.heard).toEqual([
      [
        'entry',
        { kind: 'user', id: 'user-1', text: 'hi', images: [], raw: [message] },
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
    expect(run.written[2]).toEqual({
      type: 'control_request',
      request_id: 'wigley-1',
      request: { subtype: 'interrupt' },
    });
  });

  it('send_TwoMessagesOneResult_StaysWorking', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    run.agent.send({ text: 'two', images: [] });

    writeLine(run.stdout, successResult('1'));
    await settle();

    expect(lastActivity(run.heard)).toBe('working');
  });

  it('send_TwoMessagesTwoResults_GoesIdle', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    run.agent.send({ text: 'two', images: [] });

    writeLine(run.stdout, successResult('1'));
    writeLine(run.stdout, successResult('2'));
    await settle();

    expect(lastActivity(run.heard)).toBe('idle');
  });

  it('interrupt_WhileQueuedTurnRuns_WritesRequest', async () => {
    const run = await startedQuiet();
    run.agent.send({ text: 'one', images: [] });
    run.agent.send({ text: 'two', images: [] });
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
    run.agent.send({ text: 'one', images: [] });
    run.agent.send({ text: '/effort high', images: [] });

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

    run.agent.send({ text: '/effort auto', images: [] });
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
    expect(() => run.agent.send({ text: 'hi', images: [] })).toThrow(
      'Claude Code process has ended',
    );
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
  function authHarness(children: ReturnType<typeof authChild>[]) {
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

    await expect(status).rejects.toThrow(
      'claude was not found at /bin/claude; set claude.command',
    );
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

  it('logIn_ExitsStillSignedOut_EndsWithLastStderrLine', async () => {
    const before = authChild();
    const login = authChild();
    const status = authChild();
    const { harness } = authHarness([before, login, status]);
    const { heard, events } = recordingLogIn();

    harness.logIn(null, events);
    await exitWith(before, signedOutStatus, 0);
    login.stderr.write('Starting sign-in\nInvalid code\n');
    await settle();
    login.emitter.emit('close', 1, null);
    await exitWith(status, signedOutStatus, 0);

    expect(heard).toEqual([
      [
        'ended',
        { status: { signedIn: false, account: null }, error: 'Invalid code' },
      ],
    ]);
  });

  it('logIn_ExitsStillSignedOutNoStderr_EndsWithExitCode', async () => {
    const before = authChild();
    const login = authChild();
    const status = authChild();
    const { harness } = authHarness([before, login, status]);
    const { heard, events } = recordingLogIn();

    harness.logIn(null, events);
    await exitWith(before, signedOutStatus, 0);
    login.emitter.emit('close', 3, null);
    await exitWith(status, signedOutStatus, 0);

    expect(heard).toEqual([
      [
        'ended',
        {
          status: { signedIn: false, account: null },
          error: 'claude auth login exited with code 3',
        },
      ],
    ]);
  });

  it('logIn_SignedInProfileFailsSameAccount_EndsWithError', async () => {
    const before = authChild();
    const login = authChild();
    const status = authChild();
    const { harness } = authHarness([before, login, status]);
    const { heard, events } = recordingLogIn();

    harness.logIn(null, events);
    await exitWith(before, signedInStatus, 0);
    login.emitter.emit('close', 1, null);
    await exitWith(status, signedInStatus, 0);

    expect(heard).toEqual([
      [
        'ended',
        {
          status: { signedIn: true, account: 'jo@example.com · Claude max' },
          error: 'claude auth login exited with code 1',
        },
      ],
    ]);
  });

  it('logIn_SignedInProfileFailsOtherAccount_EndsSignedIn', async () => {
    const before = authChild();
    const login = authChild();
    const status = authChild();
    const { harness } = authHarness([before, login, status]);
    const { heard, events } = recordingLogIn();
    const otherAccount = JSON.stringify({
      loggedIn: true,
      email: 'sam@example.com',
    });

    harness.logIn(null, events);
    await exitWith(before, signedInStatus, 0);
    login.emitter.emit('close', 1, null);
    await exitWith(status, otherAccount, 0);

    expect(heard).toEqual([
      [
        'ended',
        { status: { signedIn: true, account: 'sam@example.com' }, error: null },
      ],
    ]);
  });

  it('logOut_NonZeroExit_RejectsWithStderr', async () => {
    const child = authChild();
    const { harness } = authHarness([child]);

    const rejected = expect(harness.logOut(null)).rejects.toThrow(
      'claude auth logout exited with code 2: not signed in',
    );
    child.stderr.write('not signed in\n');
    await exitWith(child, '', 2);

    await rejected;
  });

  it('accountStatus_NonZeroExit_RejectsWithStderr', async () => {
    const child = authChild();
    const { harness } = authHarness([child]);

    const rejected = expect(harness.accountStatus(null)).rejects.toThrow(
      'claude auth status exited with code 1: config unreadable',
    );
    child.stderr.write('config unreadable\n');
    await exitWith(child, '', 1);

    await rejected;
  });
});
