import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../contracts/ambient';
import type { ProcessRunner } from '../../contracts/processes';
import type {
  HostedExit,
  HostedProcessEvents,
  HostedRun,
  HostedSpawn,
  PendingSpawn,
  PipeLine,
  SessionHost,
} from '../../contracts/session-host';
import {
  type ClientMessage,
  HOST_END_GRACE_MS,
  type HostMessage,
  hostRecordFile,
  type ListedProcess,
  SESSION_HOST_PROTOCOL,
  type SubscribeMessage,
  type TermAttachMessage,
  type TermAttachReply,
} from '../../contracts/session-host-protocol';
import type {
  TerminalEvents,
  TerminalExit,
  TerminalInfo,
  TerminalSpawn,
} from '../../contracts/terminals';
import { channelPath } from '../../shared/local-channel/channel-path';
import { jsonLine, readLines } from '../../shared/local-channel/line-framing';
import {
  type ChannelServer,
  listenOnChannel,
} from '../../shared/local-channel/local-channel';
import { FakeProcesses } from '../../shared/fake-processes';
import { osPlatform } from '../../shared/os-platform';
import {
  createSessionHostClient,
  sessionHostLaunch,
} from './session-host-client';

const POLL_MS = 100;
const REPLY_LIMIT_MS = 1000;
const START_LIMIT_MS = 10_000;
const EXITED = 'the session host exited';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function tempFolder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'session-host-client-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function testChannel(dir: string, suffix: string): string {
  return channelPath(
    osPlatform(process.platform),
    dir,
    'u',
    'wigley-ai-gui',
    suffix,
    dir,
  );
}

interface ManualTimers extends Timers {
  fire(ms: number): void;
  pending(ms?: number): number;
  delays(): number[];
}

function manualTimers(): ManualTimers {
  const armed = new Map<number, { run: () => void; ms: number }>();
  let lastHandle = 0;
  return {
    set(run, ms) {
      lastHandle += 1;
      armed.set(lastHandle, { run, ms });
      return lastHandle;
    },
    clear(handle) {
      armed.delete(handle);
    },
    fire(ms) {
      for (const [handle, timer] of Array.from(armed)) {
        if (timer.ms === ms) {
          armed.delete(handle);
          timer.run();
        }
      }
    },
    pending(ms) {
      return [...armed.values()].filter(
        (timer) => ms === undefined || timer.ms === ms,
      ).length;
    },
    delays() {
      return [...armed.values()].map((timer) => timer.ms);
    },
  };
}

interface HostScript {
  protocol?: number;
  silent?: boolean; // answers nothing at all
  processes?: ListedProcess[];
  listAnswered?: boolean;
  stopAllAnswered?: boolean;
  runs?: HostedRun[]; // what `listRuns` answers
  runsAnswered?: boolean;
  heldHello?: Promise<void>; // each `hello` reply waits for it
  heldList?: Promise<void>; // each `list` reply waits for it
  closesOnDrain?: boolean; // closes the connection that sent `drain`, as an older host exiting on it
  subscribed?(message: SubscribeMessage, host: ScriptedHost): void;
  terminals?: TerminalInfo[]; // what `termList` answers
  termListAnswered?: boolean;
  termAttached?(message: TermAttachMessage, host: ScriptedHost): void;
}

// Writes `reply` once `held` has settled, or at once with none.
function writeAfter(socket: Socket, reply: string, held?: Promise<void>) {
  if (held === undefined) {
    socket.write(reply);
    return;
  }
  void held.then(() => {
    if (socket.writable) {
      socket.write(reply);
    }
  });
}

interface ScriptedHost {
  got: ClientMessage[];
  sockets: Socket[];
  push(message: HostMessage): void;
  // Writes every message's line in one socket write, so the client reads them in one chunk.
  pushTogether(messages: HostMessage[]): void;
  stop(): Promise<void>;
}

async function startScriptedHost(
  channel: string,
  script: HostScript = {},
): Promise<ScriptedHost> {
  const sockets: Socket[] = [];
  const got: ClientMessage[] = [];
  let server: ChannelServer | null = null;
  const host: ScriptedHost = {
    got,
    sockets,
    push(message) {
      for (const socket of sockets) {
        socket.write(jsonLine(message));
      }
    },
    pushTogether(messages) {
      for (const socket of sockets) {
        socket.write(messages.map((message) => jsonLine(message)).join(''));
      }
    },
    stop: async () => {
      await server?.close();
    },
  };
  const answer = (socket: Socket, message: ClientMessage) => {
    got.push(message);
    if (script.silent || socket.destroyed) {
      return;
    }
    if (message.type === 'hello') {
      const reply = jsonLine({
        type: 'hello',
        requestId: message.requestId,
        protocol: script.protocol ?? SESSION_HOST_PROTOCOL,
      });
      writeAfter(socket, reply, script.heldHello);
    } else if (message.type === 'listRuns' && script.runsAnswered !== false) {
      socket.write(
        jsonLine({
          type: 'listRuns',
          requestId: message.requestId,
          runs: script.runs ?? [],
        }),
      );
    } else if (message.type === 'list' && script.listAnswered !== false) {
      const reply = jsonLine({
        type: 'list',
        requestId: message.requestId,
        processes: script.processes ?? [],
      });
      writeAfter(socket, reply, script.heldList);
    } else if (message.type === 'subscribe') {
      script.subscribed?.(message, host);
    } else if (message.type === 'termAttach') {
      script.termAttached?.(message, host);
    } else if (
      message.type === 'termList' &&
      script.termListAnswered !== false
    ) {
      socket.write(
        jsonLine({
          type: 'termList',
          requestId: message.requestId,
          terminals: script.terminals ?? [],
        }),
      );
    } else if (message.type === 'stopAll' && script.stopAllAnswered !== false) {
      socket.write(jsonLine({ type: 'stopAll', requestId: message.requestId }));
    } else if (message.type === 'drain' && script.closesOnDrain) {
      socket.destroy();
    }
  };
  server = listenOnChannel(channel, {
    connected(socket) {
      sockets.push(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.splice(sockets.indexOf(socket), 1));
      readLines(socket, (line) =>
        answer(socket, JSON.parse(line) as ClientMessage),
      );
    },
    failed(error) {
      throw error;
    },
  });
  await server.listening;
  cleanups.push(host.stop);
  return host;
}

// `spawned` runs at each host start, after the fake records it.
function clientRig(
  folderRoot: string,
  channel: string,
  spawned: () => void = () => {},
) {
  const folder = path.join(folderRoot, 'session-host');
  mkdirSync(folder, { recursive: true });
  const timers = manualTimers();
  const logged: string[] = [];
  const fake = new FakeProcesses();
  let now = 5000;
  const processes: Pick<ProcessRunner, 'startDetached'> = {
    startDetached: (command, args, options) => {
      const started = fake.startDetached(command, args, options);
      spawned();
      return started;
    },
  };
  const create = () =>
    createSessionHostClient({
      folder,
      channel,
      hostScript: '/build/session-host.js',
      execPath: '/app/binary',
      processes,
      clock: { now: () => now },
      timers,
      log: (_source, message) => logged.push(message),
    });
  return {
    folder,
    timers,
    logged,
    fake,
    create,
    moveClock: (ms: number) => {
      now += ms;
    },
  };
}

function recordedEvents() {
  const lines: PipeLine[] = [];
  const closed: HostedExit[] = [];
  const pids: number[] = [];
  const events: HostedProcessEvents = {
    line: (line) => lines.push(line),
    closed: (exit) => closed.push(exit),
    spawned: (pid) => pids.push(pid),
  };
  return {
    events,
    lines,
    closed,
    pids,
    seqs: () => lines.map((line) => line.seq),
    errors: () => closed.map((exit) => exit.error),
  };
}

// `calls` holds each call in order: `data:<chunk>` or `closed:<error>`.
function recordedTerminalEvents() {
  const data: string[] = [];
  const closed: TerminalExit[] = [];
  const calls: string[] = [];
  const events: TerminalEvents = {
    data: (chunk) => {
      data.push(chunk);
      calls.push(`data:${chunk}`);
    },
    closed: (exit) => {
      closed.push(exit);
      calls.push(`closed:${exit.error}`);
    },
  };
  return {
    events,
    data,
    closed,
    calls,
    errors: () => closed.map((exit) => exit.error),
  };
}

function terminalRequest(id: string): TerminalSpawn {
  return {
    id,
    command: '/bin/zsh',
    args: ['-l'],
    cwd: '/work',
    cols: 80,
    rows: 24,
  };
}

function termData(id: string, data: string): HostMessage {
  return { type: 'termData', id, data };
}

function attachReply(
  message: TermAttachMessage,
  terminal: TermAttachReply['terminal'],
): HostMessage {
  return {
    type: 'termAttach',
    requestId: message.requestId,
    id: message.id,
    terminal,
  };
}

// The `term*` messages `host` got, in order.
function termMessages(host: ScriptedHost): ClientMessage[] {
  return host.got.filter((message) => message.type.startsWith('term'));
}

function spawnRequest(id: string): HostedSpawn {
  return {
    id,
    command: 'claude',
    args: [],
    cwd: '/work',
    env: {},
    inheritEnv: false,
    unsetEnv: [],
    stdin: [],
    idleRule: {
      key: 'type',
      value: 'result',
      busyStdoutValues: [],
      busyStdinValues: [],
      sideKey: null,
      messageIdKey: null,
      messageEnd: null,
      turnEndIdsKey: null,
      background: null,
    },
    droppedOutKeys: [],
  };
}

function pipeLine(seq: number): PipeLine {
  return { seq, dir: 'out', at: seq * 10, text: `line ${seq}` };
}

function linePush(id: string, seq: number): HostMessage {
  return { type: 'line', id, line: pipeLine(seq) };
}

function writePipeLog(
  dir: string,
  id: string,
  seqs: number[],
  tail = '',
): string {
  const file = path.join(dir, `${id}.jsonl`);
  writeFileSync(
    file,
    seqs.map((seq) => jsonLine(pipeLine(seq))).join('') + tail,
  );
  return file;
}

function replySubscribed(
  host: ScriptedHost,
  message: SubscribeMessage,
  log: string | null,
  running = log !== null,
  pid = running ? 4321 : null,
) {
  host.push({
    type: 'subscribe',
    requestId: message.requestId,
    id: message.id,
    running,
    log,
    pid,
  });
}

// A host that answers every `subscribe` with the log file of the id.
async function hostWithLogs(channel: string, logs: Record<string, string>) {
  return startScriptedHost(channel, {
    subscribed: (message, host) =>
      replySubscribed(host, message, logs[message.id] ?? null),
  });
}

function writeRecord(folder: string, protocol: number, channel: string) {
  const file = path.join(folder, hostRecordFile(protocol));
  writeFileSync(file, JSON.stringify({ protocol, channel, pid: 1 }));
  return file;
}

function listed(id: string, startedAt: number): ListedProcess {
  return { id, startedAt, running: true, code: null, signal: null, log: '/l' };
}

function sentOfType(host: ScriptedHost, type: ClientMessage['type']) {
  return host.got.filter((message) => message.type === type);
}

function pendingSpawns(...ids: string[]): PendingSpawn[] {
  return ids.map((id, index) => ({
    at: 100 * (index + 1),
    spawn: spawnRequest(id),
    record: { task: id },
    skipWhileBusy: null,
  }));
}

function hostedRun(id: string): HostedRun {
  return {
    id,
    record: { task: id },
    startedAt: 7,
    skipped: false,
    exit: null,
  };
}

// The `setKeepIdle` and `setPending` messages `host` got, in order; a `setPending` as the ids of its entries.
function queueMessages(host: ScriptedHost): (string | string[])[] {
  return host.got.flatMap<string | string[]>((message) => {
    if (message.type === 'setKeepIdle') {
      return ['keepIdle'];
    }
    if (message.type === 'setPending') {
      return [message.entries.map((entry) => entry.spawn.id)];
    }
    return [];
  });
}

// Stops `host` and waits until the client has seen its connection drop.
async function stopAndSeeTheDrop(client: SessionHost, host: ScriptedHost) {
  const sentinel = recordedEvents();
  client.spawn(spawnRequest('sentinel'), sentinel.events);
  await host.stop();
  await vi.waitFor(() => expect(sentinel.errors()).toEqual([EXITED]));
}

interface SetPendingRow {
  name: string;
  before: PendingSpawn[] | null; // set before the first host answers
  connected(client: SessionHost, host: ScriptedHost): void | Promise<void>;
  first: (string | string[])[];
  second: (string | string[])[];
}

const SET_PENDING_ROWS: SetPendingRow[] = [
  {
    name: 'set before the connect',
    before: pendingSpawns('a'),
    connected: () => {},
    first: ['keepIdle', ['a']],
    second: ['keepIdle', ['a']],
  },
  {
    name: 'set while connected',
    before: null,
    connected: (client) => client.setPending(pendingSpawns('a')),
    first: ['keepIdle', ['a']],
    second: ['keepIdle', ['a']],
  },
  {
    name: 'never set',
    before: null,
    connected: () => {},
    first: ['keepIdle'],
    second: ['keepIdle'],
  },
  {
    name: 'set again: the last list only',
    before: pendingSpawns('a'),
    connected: (client) => client.setPending(pendingSpawns('b')),
    first: ['keepIdle', ['a'], ['b']],
    second: ['keepIdle', ['b']],
  },
  {
    name: 'a forgotten run',
    before: pendingSpawns('a', 'b'),
    connected: (client) => client.forgetRuns(['a']),
    first: ['keepIdle', ['a', 'b']],
    second: ['keepIdle', ['b']],
  },
  {
    name: 'a run the host started',
    before: pendingSpawns('a', 'b'),
    connected: async (client, host) => {
      const heard: string[] = [];
      client.onRunStarted((run) => heard.push(run.id));
      host.push({ type: 'runStarted', run: hostedRun('b') });
      await vi.waitFor(() => expect(heard).toEqual(['b']));
    },
    first: ['keepIdle', ['a', 'b']],
    second: ['keepIdle', ['a']],
  },
];

describe('sessionHostLaunch', () => {
  it('sessionHostLaunch_BuildsTheHostCommand', () => {
    expect(
      sessionHostLaunch({
        execPath: '/app/binary',
        hostScript: '/build/session-host.js',
        folder: '/data/session-host',
        channel: '/run/host.sock',
      }),
    ).toEqual({
      command: '/app/binary',
      args: ['/build/session-host.js', '/data/session-host', '/run/host.sock'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});

describe('createSessionHostClient', () => {
  it('create_HostAnswers_ConnectsWithoutSpawning', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();

    await client.list();

    expect(rig.fake.detachedStarts).toEqual([]);
    expect(host.got.slice(0, 2)).toEqual([
      { type: 'hello', requestId: 1 },
      { type: 'setKeepIdle', minutes: 60 },
    ]);
  });

  it('create_SpawnEmitsError_FailsAtOnce', async () => {
    const dir = tempFolder();
    const rig = clientRig(dir, testChannel(dir, ''));
    rig.fake.failDetachedStarts(
      new Error('Could not run /app/binary: spawn x ENOENT'),
    );
    const client = rig.create();
    const queued = recordedEvents();

    client.spawn(spawnRequest('a'), queued.events);

    await vi.waitFor(() =>
      expect(queued.errors()).toEqual([
        'the session host did not start: Could not run /app/binary: spawn x ENOENT',
      ]),
    );
    expect(rig.fake.detachedStarts).toHaveLength(1);
    expect(rig.timers.pending(POLL_MS)).toBe(0);
  });

  it('connect_HostNeverRepliesToHello_CountsAsNoAnswer', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    await startScriptedHost(channel, { silent: true });
    const rig = clientRig(dir, channel);
    rig.create();

    for (let round = 0; round < 3; round += 1) {
      await vi.waitFor(() =>
        expect(rig.timers.pending(REPLY_LIMIT_MS)).toBe(1),
      );
      if (round === 0) {
        expect(rig.fake.detachedStarts).toEqual([]);
      }
      rig.timers.fire(REPLY_LIMIT_MS);
      await vi.waitFor(() => expect(rig.timers.pending(POLL_MS)).toBe(1));
      rig.timers.fire(POLL_MS);
    }

    expect(rig.fake.detachedStarts).toHaveLength(1);
  });

  it('connect_WrongProtocol_CountsAsNoAnswer', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    await startScriptedHost(channel, { protocol: SESSION_HOST_PROTOCOL + 1 });
    const rig = clientRig(dir, channel);
    rig.create();

    await vi.waitFor(() => expect(rig.fake.detachedStarts).toHaveLength(1));
  });

  it('create_NoHost_SpawnsTheHostDetachedThenConnects', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const starting: Promise<ScriptedHost>[] = [];
    const rig = clientRig(dir, channel, () => {
      starting.push(startScriptedHost(channel));
    });
    rig.create();

    await vi.waitFor(() => expect(rig.timers.pending(POLL_MS)).toBe(1));
    const launch = sessionHostLaunch({
      execPath: '/app/binary',
      hostScript: '/build/session-host.js',
      folder: rig.folder,
      channel,
    });
    expect(launch).toEqual({
      command: '/app/binary',
      args: ['/build/session-host.js', rig.folder, channel],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(rig.fake.detachedStarts).toEqual([
      {
        command: launch.command,
        args: launch.args,
        options: { setEnv: launch.env },
      },
    ]);

    const host = await starting[0];
    rig.timers.fire(POLL_MS);

    await vi.waitFor(() =>
      expect(host.got).toContainEqual({ type: 'setKeepIdle', minutes: 60 }),
    );
    expect(rig.fake.detachedStarts).toHaveLength(1);
  });

  it('create_HostNeverAnswers_ClosesQueuedSpawnsWithTheReason', async () => {
    const dir = tempFolder();
    const rig = clientRig(dir, testChannel(dir, ''));
    const client = rig.create();
    const queued = recordedEvents();
    client.spawn(spawnRequest('a'), queued.events);
    const listing = expect(client.list()).rejects.toThrow('did not start');
    const attaching = expect(
      client.attach('b', recordedEvents().events),
    ).rejects.toThrow('did not start');
    const terminal = recordedTerminalEvents();
    client.terminals.spawn(terminalRequest('t'), terminal.events);
    const terminalListing = expect(client.terminals.list()).rejects.toThrow(
      'did not start',
    );
    const terminalAttaching = expect(
      client.terminals.attach('u', recordedTerminalEvents().events),
    ).rejects.toThrow('did not start');

    await vi.waitFor(() => expect(rig.timers.pending(POLL_MS)).toBe(1));
    rig.moveClock(START_LIMIT_MS - 1);
    rig.timers.fire(POLL_MS);
    await vi.waitFor(() => expect(rig.timers.pending(POLL_MS)).toBe(1));
    expect(queued.closed).toEqual([]);

    rig.moveClock(1);
    rig.timers.fire(POLL_MS);

    await vi.waitFor(() => expect(queued.closed).toHaveLength(1));
    expect(queued.errors()[0]).toMatch(/^the session host did not start:/);
    expect(terminal.errors()).toEqual([
      expect.stringMatching(/^the session host did not start:/),
    ]);
    await listing;
    await attaching;
    await terminalListing;
    await terminalAttaching;
    expect(rig.fake.detachedStarts).toHaveLength(1);
  });

  it('process_Messages_ReachTheHostInCallOrderUntilClosed', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const opened = recordedEvents();

    const process = client.spawn(spawnRequest('a'), opened.events);
    process.write('one');
    process.endInput();
    process.kill('SIGTERM');

    await vi.waitFor(() => expect(sentOfType(host, 'kill')).toHaveLength(1));
    expect(host.got.slice(2)).toEqual([
      { type: 'spawn', request: spawnRequest('a') },
      { type: 'write', id: 'a', text: 'one' },
      { type: 'endInput', id: 'a' },
      { type: 'kill', id: 'a', signal: 'SIGTERM' },
    ]);

    const exit: HostedExit = { code: 0, signal: null, error: null };
    host.push({ type: 'closed', id: 'a', exit });
    await vi.waitFor(() => expect(opened.closed).toEqual([exit]));
    process.write('late');
    process.detach();
    host.push({ type: 'closed', id: 'a', exit });
    await client.list();

    expect(opened.closed).toEqual([exit]);
    expect(sentOfType(host, 'write')).toHaveLength(1);
    expect(sentOfType(host, 'unsubscribe')).toEqual([]);
  });

  it.each([
    { name: 'pushed during the read', duringRead: [3, 4], afterFlush: [] },
    {
      name: 'seq 3 pushed after the flush',
      duringRead: [],
      afterFlush: [3, 4],
    },
  ])(
    'attach_LogThenLive_DeliversOnlyLinesPastTheLastSeq: $name',
    async ({ duringRead, afterFlush }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const log = writePipeLog(dir, 'a', [1, 2, 3], '{"seq":4,"dir"');
      const host = await startScriptedHost(channel, {
        subscribed(message, scripted) {
          for (const seq of duringRead) {
            scripted.push(linePush('a', seq));
          }
          replySubscribed(scripted, message, log);
        },
      });
      const rig = clientRig(dir, channel);
      const client = rig.create();
      const attached = recordedEvents();

      const result = await client.attach('a', attached.events);

      expect(attached.lines).toEqual([]);
      expect(result?.log).toEqual([pipeLine(1), pipeLine(2), pipeLine(3)]);

      rig.timers.fire(0);
      for (const seq of afterFlush) {
        host.push(linePush('a', seq));
      }

      await vi.waitFor(() => expect(attached.lines.length).toBeGreaterThan(0));
      expect(attached.seqs()).toEqual([4]);
    },
  );

  it.each([
    {
      name: 'the host holds no running process',
      log: null,
      running: false,
      rejection: null,
      unsubscribes: [],
    },
    {
      name: 'the host refuses an incomplete log',
      log: null,
      running: true,
      rejection: 'incomplete',
      unsubscribes: [{ type: 'unsubscribe', id: 'a' }],
    },
    {
      name: 'the log file missing',
      log: '/no/such/file.jsonl',
      running: true,
      rejection: 'cannot read',
      unsubscribes: [{ type: 'unsubscribe', id: 'a' }],
    },
  ])(
    'attach_Cases_NullOnlyWhenTheHostSaysSo: $name',
    async ({ log, running, rejection, unsubscribes }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const host = await startScriptedHost(channel, {
        subscribed: (message, scripted) => {
          replySubscribed(scripted, message, log, running);
          scripted.push(linePush('a', 1));
        },
      });
      const rig = clientRig(dir, channel);
      const client = rig.create();
      const attached = recordedEvents();

      const attaching = client.attach('a', attached.events);
      if (rejection === null) {
        await expect(attaching).resolves.toBeNull();
      } else {
        await expect(attaching).rejects.toThrow(rejection);
      }
      await client.list();

      rig.timers.fire(0);
      expect(sentOfType(host, 'unsubscribe')).toEqual(unsubscribes);
      expect(attached.lines).toEqual([]);
    },
  );

  it('silentHost_AfterHello_ListAndAttachReject', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel, {
      listAnswered: false,
      subscribed: () => {},
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const attached = recordedEvents();

    const listing = expect(client.list()).rejects.toThrow('did not answer');
    const attaching = expect(
      client.attach('a', attached.events),
    ).rejects.toThrow('did not answer');
    await vi.waitFor(() => {
      expect(sentOfType(host, 'list')).toHaveLength(1);
      expect(sentOfType(host, 'subscribe')).toHaveLength(1);
    });
    expect(rig.timers.pending(REPLY_LIMIT_MS)).toBe(2);
    rig.timers.fire(REPLY_LIMIT_MS);
    await listing;
    await attaching;

    await vi.waitFor(() =>
      expect(sentOfType(host, 'unsubscribe')).toEqual([
        { type: 'unsubscribe', id: 'a' },
      ]),
    );
    host.push(linePush('a', 1));
    await client.stopAll();
    expect(attached.lines).toEqual([]);
  });

  it('silentHost_AfterHello_StopAllResolvesPastTheKillSteps', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel, { stopAllAnswered: false });
    const rig = clientRig(dir, channel);
    const client = rig.create();

    const stopping = client.stopAll();
    await vi.waitFor(() => expect(sentOfType(host, 'stopAll')).toHaveLength(1));

    const [limit] = rig.timers.delays();
    expect(limit).toBeGreaterThan(2 * HOST_END_GRACE_MS);
    rig.timers.fire(limit);
    await stopping;
    expect(rig.logged.some((line) => line.includes('stop all'))).toBe(true);
  });

  it('spawn_LiveEntryUnderThatId_ClosesTheNewEventsAndLeavesTheEntry', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const first = recordedEvents();
    const second = recordedEvents();
    client.spawn(spawnRequest('a'), first.events);

    const duplicate = client.spawn(spawnRequest('a'), second.events);
    expect(second.closed).toEqual([]);
    await Promise.resolve();
    expect(second.errors()).toEqual(['a process with id a already exists']);

    duplicate.write('ignored');
    duplicate.detach();
    await client.list();
    expect(sentOfType(host, 'spawn')).toHaveLength(1);
    expect(sentOfType(host, 'write')).toEqual([]);
    expect(sentOfType(host, 'unsubscribe')).toEqual([]);
    host.push(linePush('a', 1));
    await vi.waitFor(() => expect(first.seqs()).toEqual([1]));
    expect(second.lines).toEqual([]);
    expect(first.closed).toEqual([]);
  });

  it('terminal_Messages_ReachTheHostInCallOrderUntilDetached', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();

    const terminal = client.terminals.spawn(
      terminalRequest('a'),
      recordedTerminalEvents().events,
    );
    terminal.write('ls');
    terminal.resize(90, 20);
    terminal.kill();
    terminal.detach();
    terminal.write('x');
    await client.list();

    expect(termMessages(host)).toEqual([
      { type: 'termSpawn', request: terminalRequest('a') },
      { type: 'termWrite', id: 'a', data: 'ls' },
      { type: 'termResize', id: 'a', cols: 90, rows: 20 },
      { type: 'termKill', id: 'a' },
      { type: 'termDetach', id: 'a' },
    ]);
  });

  it('terminal_Pushes_RouteByIdToTheLiveEvents', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const a = recordedTerminalEvents();
    const b = recordedTerminalEvents();
    const aTerminal = client.terminals.spawn(terminalRequest('a'), a.events);
    const bTerminal = client.terminals.spawn(terminalRequest('b'), b.events);
    await client.list();
    const exit: TerminalExit = { code: 0, signal: null, error: null };

    host.push(termData('a', 'x'));
    host.push(termData('b', 'y'));
    host.push({ type: 'termClosed', id: 'a', exit });
    host.push(termData('a', 'z'));
    // The list reply follows the pushes on the same connection.
    await client.list();

    expect(a.data).toEqual(['x']);
    expect(a.closed).toEqual([exit]);
    expect(b.data).toEqual(['y']);
    expect(b.closed).toEqual([]);

    aTerminal.write('late');
    bTerminal.detach();
    host.push({ type: 'termClosed', id: 'b', exit });
    await client.list();

    expect(sentOfType(host, 'termWrite')).toEqual([]);
    expect(b.closed).toEqual([]);
  });

  it.each([
    {
      name: 'replay',
      answer: (message: TermAttachMessage, host: ScriptedHost) => {
        host.push(attachReply(message, { replay: 'abc', running: true }));
        host.push(termData('a', 'd'));
      },
      replay: 'abc',
      live: ['d'],
      rejection: null,
    },
    {
      name: 'same chunk',
      answer: (message: TermAttachMessage, host: ScriptedHost) =>
        host.pushTogether([
          attachReply(message, { replay: 'abc', running: true }),
          termData('a', 'd'),
        ]),
      replay: 'abc',
      live: ['d'],
      rejection: null,
    },
    {
      name: 'unknown',
      answer: (message: TermAttachMessage, host: ScriptedHost) =>
        host.push(attachReply(message, null)),
      replay: null,
      live: [],
      rejection: null,
    },
    {
      name: 'no reply',
      answer: () => {},
      replay: null,
      live: [],
      rejection: /did not answer the attach of terminal a/,
    },
  ])(
    'terminalAttach_Cases: $name',
    async ({ answer, replay, live, rejection }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const host = await startScriptedHost(channel, { termAttached: answer });
      const rig = clientRig(dir, channel);
      const client = rig.create();
      const attached = recordedTerminalEvents();

      const attaching = client.terminals.attach('a', attached.events);
      if (rejection !== null) {
        const settled = expect(attaching).rejects.toThrow(rejection);
        await vi.waitFor(() =>
          expect(sentOfType(host, 'termAttach')).toHaveLength(1),
        );
        rig.timers.fire(REPLY_LIMIT_MS);
        await settled;
        await client.list();
        expect(sentOfType(host, 'termDetach')).toEqual([
          { type: 'termDetach', id: 'a' },
        ]);
        return;
      }
      const result = await attaching;

      expect(result?.replay ?? null).toBe(replay);
      expect(attached.data).toEqual([]);
      // The list reply follows every push the answer wrote.
      await client.list();
      expect(attached.data).toEqual([]);
      rig.timers.fire(0);
      expect(attached.data).toEqual(live);
    },
  );

  it('terminalAttach_PushesBeforeTheReply_AreDropped', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    await startScriptedHost(channel, {
      termAttached: (message, host) =>
        host.pushTogether([
          termData('a', 'old'),
          attachReply(message, { replay: 'old', running: true }),
        ]),
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const attached = recordedTerminalEvents();

    await client.terminals.attach('a', attached.events);
    rig.timers.fire(0);
    await client.list();

    expect(attached.data).toEqual([]);
  });

  it.each([
    { name: 'second attach', attachesAgain: true },
    { name: 'detach', attachesAgain: false },
  ])(
    'terminalAttach_BeforeTheFlush_FirstEventsGetNothing: $name',
    async ({ attachesAgain }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const host = await startScriptedHost(channel, {
        termAttached: (message, scripted) =>
          scripted.pushTogether([
            attachReply(message, { replay: 'r', running: true }),
            termData('a', 'd'),
          ]),
      });
      const rig = clientRig(dir, channel);
      const client = rig.create();
      const first = recordedTerminalEvents();
      const second = recordedTerminalEvents();
      const firstResult = await client.terminals.attach('a', first.events);

      if (attachesAgain) {
        await client.terminals.attach('a', second.events);
      } else {
        firstResult?.process.detach();
      }
      rig.timers.fire(0);
      await client.list();

      expect(first.data).toEqual([]);
      expect(second.data).toEqual(attachesAgain ? ['d'] : []);
      expect(sentOfType(host, 'termDetach')).toEqual(
        attachesAgain ? [] : [{ type: 'termDetach', id: 'a' }],
      );
    },
  );

  it('terminalSpawn_LiveEntryUnderThatId_ClosesTheNewEvents', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const first = recordedTerminalEvents();
    const second = recordedTerminalEvents();
    client.terminals.spawn(terminalRequest('a'), first.events);

    client.terminals.spawn(terminalRequest('a'), second.events);
    await client.list();

    expect(second.errors()).toEqual(['a terminal with id a already exists']);
    expect(first.closed).toEqual([]);
    expect(sentOfType(host, 'termSpawn')).toHaveLength(1);
  });

  it('terminalSpawn_DetachedEntryUnderThatId_LeavesTheAnswerToTheHost', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const second = recordedTerminalEvents();
    client.terminals
      .spawn(terminalRequest('a'), recordedTerminalEvents().events)
      .detach();

    client.terminals.spawn(terminalRequest('a'), second.events);
    await vi.waitFor(() =>
      expect(sentOfType(host, 'termSpawn')).toHaveLength(2),
    );
    expect(second.closed).toEqual([]);
    host.push({
      type: 'termClosed',
      id: 'a',
      exit: {
        code: null,
        signal: null,
        error: 'a terminal with id a already exists',
      },
    });

    await vi.waitFor(() =>
      expect(second.errors()).toEqual(['a terminal with id a already exists']),
    );
  });

  it.each([
    {
      name: 'answered',
      answered: true,
      outcome: [{ id: 'a', startedAt: 7, running: true }],
    },
    {
      name: 'silent',
      answered: false,
      outcome: /did not answer its terminal list/,
    },
  ])('terminalList_Cases: $name', async ({ answered, outcome }) => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel, {
      terminals: [{ id: 'a', startedAt: 7, running: true }],
      termListAnswered: answered,
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();

    const listing = client.terminals.list();
    const settled =
      outcome instanceof RegExp
        ? expect(listing).rejects.toThrow(outcome)
        : expect(listing).resolves.toEqual(outcome);
    if (!answered) {
      await vi.waitFor(() =>
        expect(sentOfType(host, 'termList')).toHaveLength(1),
      );
      rig.timers.fire(REPLY_LIMIT_MS);
    }

    await settled;
  });

  it('spawn_DetachedEntryUnderThatId_LeavesTheAnswerToTheHost', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const second = recordedEvents();
    client.spawn(spawnRequest('a'), recordedEvents().events).detach();

    client.spawn(spawnRequest('a'), second.events);
    await client.list();

    expect(sentOfType(host, 'spawn')).toHaveLength(2);
    expect(second.closed).toEqual([]);
  });

  it('list_CurrentAndOtherHosts_MergesWithTheCurrentFlag', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const older = testChannel(dir, '-older');
    const newer = testChannel(dir, '-newer');
    await startScriptedHost(channel, { processes: [listed('a', 1)] });
    const olderHost = await startScriptedHost(older, {
      protocol: 0,
      processes: [listed('b', 2)],
    });
    const newerHost = await startScriptedHost(newer, {
      protocol: SESSION_HOST_PROTOCOL + 1,
      processes: [listed('c', 3)],
    });
    const rig = clientRig(dir, channel);
    writeRecord(rig.folder, 0, older);
    const newerRecord = writeRecord(
      rig.folder,
      SESSION_HOST_PROTOCOL + 1,
      newer,
    );
    const client = rig.create();

    const merged = await client.list();
    await client.list();

    expect(merged).toEqual([
      { id: 'a', startedAt: 1, running: true, current: true },
      { id: 'b', startedAt: 2, running: true, current: false },
      { id: 'c', startedAt: 3, running: true, current: false },
    ]);
    await vi.waitFor(() =>
      expect(sentOfType(olderHost, 'drain')).toHaveLength(1),
    );
    expect(sentOfType(newerHost, 'drain')).toEqual([]);
    expect(existsSync(newerRecord)).toBe(true);
  });

  it.each([
    {
      name: 'a dead channel',
      file: hostRecordFile(0),
      content: 'dead',
      kept: false,
      logged: false,
      rejects: false,
    },
    {
      name: 'a server that never replies',
      file: hostRecordFile(0),
      content: 'silent',
      kept: true,
      logged: false,
      rejects: true,
    },
    {
      name: 'a host that never answers its list',
      file: hostRecordFile(0),
      content: 'unlisted',
      kept: true,
      logged: false,
      rejects: true,
    },
    {
      name: 'a file that does not parse',
      file: hostRecordFile(0),
      content: '{ not json',
      kept: true,
      logged: true,
      rejects: false,
    },
    {
      name: 'a temporary file',
      file: `${hostRecordFile(1)}.tmp`,
      content: '{ not json',
      kept: true,
      logged: false,
      rejects: false,
    },
  ])(
    'otherRecord_Cases_DeletesOnlyWhenTheConnectFails: $name',
    async ({ file, content, kept, logged, rejects }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const other = testChannel(dir, '-other');
      await startScriptedHost(channel, { processes: [listed('a', 1)] });
      if (content === 'silent') {
        await startScriptedHost(other, { silent: true });
      }
      if (content === 'unlisted') {
        await startScriptedHost(other, { listAnswered: false, protocol: 0 });
      }
      const rig = clientRig(dir, channel);
      const record = path.join(rig.folder, file);
      const isChannelRow = ['dead', 'silent', 'unlisted'].includes(content);
      writeFileSync(
        record,
        isChannelRow
          ? JSON.stringify({ protocol: 0, channel: other, pid: 1 })
          : content,
      );
      const client = rig.create();

      let merged: unknown = null;
      client.list().then(
        (result) => {
          merged = result;
        },
        () => {
          merged = 'rejected';
        },
      );
      await vi.waitFor(() => {
        rig.timers.fire(REPLY_LIMIT_MS);
        expect(merged).not.toBeNull();
      });

      expect(merged).toEqual(
        rejects
          ? 'rejected'
          : [{ id: 'a', startedAt: 1, running: true, current: true }],
      );
      expect(existsSync(record)).toBe(kept);
      expect(rig.logged.some((line) => line.includes(file))).toBe(
        logged || !kept,
      );
    },
  );

  it.skipIf(process.platform === 'win32')(
    'otherRecord_ConnectDenied_KeepsTheRecordAndRejects',
    async () => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const other = testChannel(dir, '-other');
      await startScriptedHost(channel);
      await startScriptedHost(other, { protocol: 0 });
      chmodSync(other, 0o000);
      const rig = clientRig(dir, channel);
      const record = writeRecord(rig.folder, 0, other);
      const client = rig.create();

      await expect(client.list()).rejects.toThrow('did not answer');

      expect(existsSync(record)).toBe(true);
    },
  );

  it('list_HostFolderUnreadable_Rejects', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    rmSync(rig.folder, { recursive: true });
    writeFileSync(rig.folder, '');
    const client = rig.create();

    await expect(client.list()).rejects.toThrow();
  });

  it.each([
    { via: 'spawn', pids: [4321] },
    { via: 'attach', pids: [] },
    { via: 'attach of a detached spawn, then a spawned push', pids: [] },
  ])(
    'pid_SpawnedOrSubscribed_HeldUntilClosed: via $via',
    async ({ via, pids }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const host = await hostWithLogs(channel, {
        a: writePipeLog(dir, 'a', []),
      });
      const rig = clientRig(dir, channel);
      const client = rig.create();
      const recorded = recordedEvents();
      const attaches = via !== 'spawn';
      const pushesSpawned = via !== 'attach';

      if (attaches && pushesSpawned) {
        client.spawn(spawnRequest('a'), recordedEvents().events).detach();
      }
      const process = attaches
        ? (await client.attach('a', recorded.events))?.process
        : client.spawn(spawnRequest('a'), recorded.events);
      if (attaches) {
        rig.timers.fire(0);
      }
      if (pushesSpawned) {
        await vi.waitFor(() =>
          expect(sentOfType(host, 'spawn')).toHaveLength(1),
        );
        host.push({ type: 'spawned', id: 'a', pid: 4321 });
      }

      await vi.waitFor(() => expect(process?.pid).toBe(4321));
      const exit: HostedExit = { code: 0, signal: null, error: null };
      host.push({ type: 'closed', id: 'a', exit });
      await vi.waitFor(() => expect(recorded.closed).toEqual([exit]));
      expect(recorded.pids).toEqual(pids);
      expect(process?.pid).toBeNull();
    },
  );

  it('hostExits_OpenProcesses_CloseWithAnError', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await hostWithLogs(channel, {
      attached: writePipeLog(dir, 'attached', []),
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const spawned = recordedEvents();
    const attached = recordedEvents();
    const detached = recordedEvents();
    const terminal = recordedTerminalEvents();
    client.spawn(spawnRequest('spawned'), spawned.events);
    client.spawn(spawnRequest('detached'), detached.events).detach();
    client.terminals.spawn(terminalRequest('terminal'), terminal.events);
    await client.attach('attached', attached.events);
    rig.timers.fire(0);

    await host.stop();

    await vi.waitFor(() => expect(spawned.errors()).toEqual([EXITED]));
    expect(attached.errors()).toEqual([EXITED]);
    expect(detached.closed).toEqual([]);
    expect(terminal.errors()).toEqual([EXITED]);
  });

  it('hostExits_BeforeTheAttachFlush_ClosedFollowsTheBufferedLines', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const log = writePipeLog(dir, 'a', [1]);
    const host = await startScriptedHost(channel, {
      subscribed(message, scripted) {
        scripted.push(linePush('a', 2));
        replySubscribed(scripted, message, log);
      },
      termAttached: (message, scripted) =>
        scripted.pushTogether([
          attachReply(message, { replay: '', running: true }),
          termData('t', 'd'),
        ]),
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const attached = recordedEvents();
    const terminal = recordedTerminalEvents();
    const sentinel = recordedEvents();
    client.spawn(spawnRequest('sentinel'), sentinel.events);
    await client.attach('a', attached.events);
    await client.terminals.attach('t', terminal.events);

    await host.stop();
    await vi.waitFor(() => expect(sentinel.errors()).toEqual([EXITED]));

    expect(attached.closed).toEqual([]);
    expect(terminal.closed).toEqual([]);
    rig.timers.fire(0);
    expect(attached.seqs()).toEqual([2]);
    expect(attached.errors()).toEqual([EXITED]);
    expect(terminal.calls).toEqual(['data:d', `closed:${EXITED}`]);
  });

  it('hostExits_PendingCalls_ListAndAttachRejectAndStopAllResolves', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    let stopping = false;
    const host = await startScriptedHost(channel, {
      listAnswered: false,
      termListAnswered: false,
      stopAllAnswered: false,
      subscribed: () => {
        stopping = true;
      },
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const attached = recordedEvents();

    const attach = expect(
      client.attach('a', attached.events),
    ).rejects.toThrow();
    const listing = expect(client.list()).rejects.toThrow();
    const terminalListing = expect(client.terminals.list()).rejects.toThrow(
      /did not answer its terminal list/,
    );
    const terminal = recordedTerminalEvents();
    const terminalAttach = expect(
      client.terminals.attach('t', terminal.events),
    ).rejects.toThrow(/did not answer the attach of terminal t/);
    const stopAll = client.stopAll();
    await vi.waitFor(() => expect(stopping).toBe(true));
    await vi.waitFor(() => expect(sentOfType(host, 'stopAll')).toHaveLength(1));
    await vi.waitFor(() => expect(sentOfType(host, 'list')).toHaveLength(1));
    await vi.waitFor(() =>
      expect(sentOfType(host, 'termList')).toHaveLength(1),
    );
    await vi.waitFor(() =>
      expect(sentOfType(host, 'termAttach')).toHaveLength(1),
    );
    await host.stop();

    await attach;
    await listing;
    await terminalListing;
    await terminalAttach;
    await expect(stopAll).resolves.toBeUndefined();
    expect(attached.closed).toEqual([]);
    expect(terminal.closed).toEqual([]);
  });

  it('stopAll_HostReplies_Resolves', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();

    await client.stopAll();

    expect(sentOfType(host, 'stopAll')).toHaveLength(1);
  });

  it('detach_ThenAttach_SendsUnsubscribeAndDeliversToTheNewEventsOnly', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await hostWithLogs(channel, {
      a: writePipeLog(dir, 'a', []),
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const first = recordedEvents();
    const second = recordedEvents();
    const process = client.spawn(spawnRequest('a'), first.events);

    process.detach();
    process.write('dropped');
    await client.attach('a', second.events);
    rig.timers.fire(0);
    host.push(linePush('a', 1));

    await vi.waitFor(() => expect(second.seqs()).toEqual([1]));
    expect(sentOfType(host, 'unsubscribe')).toEqual([
      { type: 'unsubscribe', id: 'a' },
    ]);
    expect(sentOfType(host, 'write')).toEqual([]);
    expect(first.lines).toEqual([]);

    await host.stop();
    await vi.waitFor(() => expect(second.errors()).toEqual([EXITED]));
    expect(first.closed).toEqual([]);
  });

  it('attach_Twice_TheFirstEventsGetNothingMore', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await hostWithLogs(channel, {
      a: writePipeLog(dir, 'a', []),
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const first = recordedEvents();
    const second = recordedEvents();
    const firstResult = await client.attach('a', first.events);
    rig.timers.fire(0);
    await client.attach('a', second.events);
    rig.timers.fire(0);

    host.push(linePush('a', 1));
    host.push({
      type: 'closed',
      id: 'a',
      exit: { code: 0, signal: null, error: null },
    });

    await vi.waitFor(() => expect(second.closed).toHaveLength(1));
    expect(second.seqs()).toEqual([1]);
    expect(first.lines).toEqual([]);
    expect(first.closed).toEqual([]);
    firstResult?.process.write('after closed');
    await client.list();
    expect(sentOfType(host, 'write')).toEqual([]);
  });

  it('attach_Replaced_TheOldProcessStillWrites', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await hostWithLogs(channel, {
      a: writePipeLog(dir, 'a', []),
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const firstResult = await client.attach('a', recordedEvents().events);
    await client.attach('a', recordedEvents().events);

    firstResult?.process.write('still');

    await vi.waitFor(() =>
      expect(sentOfType(host, 'write')).toEqual([
        { type: 'write', id: 'a', text: 'still' },
      ]),
    );
  });

  it('detach_StaleObject_SendsNoUnsubscribe', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await hostWithLogs(channel, {
      a: writePipeLog(dir, 'a', []),
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const second = recordedEvents();
    const firstResult = await client.attach('a', recordedEvents().events);
    await client.attach('a', second.events);
    rig.timers.fire(0);

    firstResult?.process.detach();
    host.push(linePush('a', 1));

    await vi.waitFor(() => expect(second.seqs()).toEqual([1]));
    expect(sentOfType(host, 'unsubscribe')).toEqual([]);
  });

  it('setKeepIdleMinutes_Reconnect_SendsTheLastValueAgain', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const firstHost = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const opened = recordedEvents();
    client.spawn(spawnRequest('a'), opened.events);
    client.setKeepIdleMinutes(30);
    await client.list();
    await firstHost.stop();
    await vi.waitFor(() => expect(opened.errors()).toEqual([EXITED]));
    const secondHost = await startScriptedHost(channel);

    await client.list();

    expect(secondHost.got.slice(0, 2)).toEqual([
      { type: 'hello', requestId: 1 },
      { type: 'setKeepIdle', minutes: 30 },
    ]);
    expect(rig.fake.detachedStarts).toEqual([]);
  });

  it.each(SET_PENDING_ROWS)(
    'setPending_Connect_Cases: $name',
    async ({ before, connected, first, second }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const firstHost = await startScriptedHost(channel);
      const rig = clientRig(dir, channel);
      const client = rig.create();
      client.onConnected(() => client.forgetRuns(['marker']));
      if (before !== null) {
        client.setPending(before);
      }
      await client.list();
      await vi.waitFor(() =>
        expect(sentOfType(firstHost, 'setPending')).toHaveLength(
          before === null ? 0 : 1,
        ),
      );

      await connected(client, firstHost);
      await vi.waitFor(() => expect(queueMessages(firstHost)).toEqual(first));
      await stopAndSeeTheDrop(client, firstHost);
      const secondHost = await startScriptedHost(channel);
      await client.list();

      await vi.waitFor(() =>
        expect(sentOfType(secondHost, 'forgetRuns')).toContainEqual({
          type: 'forgetRuns',
          ids: ['marker'],
        }),
      );
      expect(queueMessages(secondHost)).toEqual(second);
    },
  );

  it.each([
    {
      name: 'the host replies',
      host: 'answers',
      outcome: [hostedRun('r1'), hostedRun('r2')],
    },
    {
      name: 'no host started',
      host: 'none',
      outcome: 'the session host did not start',
    },
    {
      name: 'the host stays silent past the limit',
      host: 'silent',
      outcome: 'the session host did not answer its run list',
    },
  ])('listRuns_Cases: $name', async ({ host, outcome }) => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const scripted =
      host === 'none'
        ? null
        : await startScriptedHost(channel, {
            runs: [hostedRun('r1'), hostedRun('r2')],
            runsAnswered: host === 'answers',
          });
    const rig = clientRig(dir, channel);
    const client = rig.create();

    const listing = client.listRuns();
    const settled =
      typeof outcome === 'string'
        ? expect(listing).rejects.toThrow(outcome)
        : expect(listing).resolves.toEqual(outcome);
    if (scripted === null) {
      await vi.waitFor(() => expect(rig.timers.pending(POLL_MS)).toBe(1));
      rig.moveClock(START_LIMIT_MS);
      rig.timers.fire(POLL_MS);
    } else if (host === 'silent') {
      await vi.waitFor(() =>
        expect(sentOfType(scripted, 'listRuns')).toHaveLength(1),
      );
      rig.timers.fire(REPLY_LIMIT_MS);
    }

    await settled;
  });

  it.each([
    { name: 'the list reply comes', ack: 'reply' },
    { name: 'the list reply limit runs out', ack: 'limit' },
    { name: 'the older host closes on the drain', ack: 'close' },
  ])(
    'drain_OlderHostAck_HoldsThePendingListAndRunReadsUntilItEnds: $name',
    async ({ ack }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const older = testChannel(dir, '-older');
      let releaseList = () => {};
      const heldList = new Promise<void>((resolve) => {
        releaseList = resolve;
      });
      const olderHost = await startScriptedHost(older, {
        protocol: 0,
        heldList,
        listAnswered: ack !== 'limit',
        closesOnDrain: ack === 'close',
      });
      const currentHost = await startScriptedHost(channel, {
        runs: [hostedRun('r1')],
      });
      const rig = clientRig(dir, channel);
      writeRecord(rig.folder, 0, older);
      const client = rig.create();
      client.setPending(pendingSpawns('a'));

      const runsRead = client.listRuns();
      if (ack !== 'close') {
        await vi.waitFor(() =>
          expect(olderHost.got.map((message) => message.type)).toEqual([
            'hello',
            'drain',
            'list',
          ]),
        );
        // A reply on the current link, so whatever was sent on it before has arrived.
        await client.stopAll();
        expect(sentOfType(currentHost, 'setPending')).toEqual([]);
        expect(sentOfType(currentHost, 'listRuns')).toEqual([]);
        if (ack === 'reply') {
          releaseList();
        } else {
          rig.timers.fire(REPLY_LIMIT_MS);
        }
      }

      await expect(runsRead).resolves.toEqual([hostedRun('r1')]);
      expect(sentOfType(olderHost, 'drain')).toHaveLength(1);
      expect(
        currentHost.got
          .filter((message) =>
            ['setPending', 'listRuns'].includes(message.type),
          )
          .map((message) => message.type),
      ).toEqual(['setPending', 'listRuns']);
    },
  );

  it.each([
    {
      name: 'ids sent as one message',
      ids: ['r1', 'r2'],
      sent: [{ type: 'forgetRuns', ids: ['r1', 'r2'] }],
    },
    { name: 'an empty list sends nothing', ids: [], sent: [] },
  ])('forgetRuns_Cases: $name', async ({ ids, sent }) => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();

    client.forgetRuns(ids);
    await client.list();

    expect(sentOfType(host, 'forgetRuns')).toEqual(sent);
  });

  it('onRunStarted_Push_ReachesEachLiveListener', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const live: HostedRun[] = [];
    const disposed: HostedRun[] = [];
    client.onRunStarted((run) => live.push(run));
    client.onRunStarted((run) => disposed.push(run)).dispose();
    await client.list();

    host.push({ type: 'runStarted', run: hostedRun('r1') });

    await vi.waitFor(() => expect(live).toEqual([hostedRun('r1')]));
    expect(disposed).toEqual([]);
  });

  it.each([
    { name: 'a new host after a host death', dropsDuringDrain: false },
    {
      name: 'the first link drops during its drain wait',
      dropsDuringDrain: true,
    },
  ])(
    'onConnected_Reconnect_FiresAfterTheDrainAndThePendingList: $name',
    async ({ dropsDuringDrain }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const older = testChannel(dir, '-older');
      let releaseHello = () => {};
      const heldHello = new Promise<void>((resolve) => {
        releaseHello = resolve;
      });
      const olderHost = await startScriptedHost(older, {
        protocol: 0,
        heldHello,
      });
      const firstHost = await startScriptedHost(channel);
      const rig = clientRig(dir, channel);
      if (dropsDuringDrain) {
        writeRecord(rig.folder, 0, older);
      }
      const client = rig.create();
      let calls = 0;
      let disposedCalls = 0;
      client.onConnected(() => {
        calls += 1;
        client.forgetRuns(['marker']);
      });
      client
        .onConnected(() => {
          disposedCalls += 1;
        })
        .dispose();
      client.setPending(pendingSpawns('a'));

      if (dropsDuringDrain) {
        // The first connect waits on the older host's held hello.
        await vi.waitFor(() =>
          expect(sentOfType(olderHost, 'hello')).toHaveLength(1),
        );
      } else {
        await vi.waitFor(() =>
          expect(sentOfType(firstHost, 'setPending')).toHaveLength(1),
        );
        writeRecord(rig.folder, 0, older);
      }
      expect(calls).toBe(0);
      await stopAndSeeTheDrop(client, firstHost);
      const secondHost = await startScriptedHost(channel);
      const runsRead = client.listRuns();
      await vi.waitFor(() =>
        expect(sentOfType(secondHost, 'setKeepIdle')).toHaveLength(1),
      );
      // One drain per record: one under way when its link dropped is the one the next connect waits on.
      await vi.waitFor(() =>
        expect(sentOfType(olderHost, 'hello')).toHaveLength(1),
      );
      expect(calls).toBe(0);
      expect(sentOfType(secondHost, 'setPending')).toEqual([]);
      expect(sentOfType(secondHost, 'listRuns')).toEqual([]);

      releaseHello();

      await vi.waitFor(() =>
        expect(sentOfType(secondHost, 'forgetRuns')).toHaveLength(1),
      );
      await runsRead;
      expect(calls).toBe(1);
      expect(disposedCalls).toBe(0);
      expect(
        secondHost.got
          .filter((message) =>
            ['setPending', 'listRuns', 'forgetRuns'].includes(message.type),
          )
          .map((message) => message.type),
      ).toEqual(['setPending', 'listRuns', 'forgetRuns']);
      expect(sentOfType(secondHost, 'setPending')).toEqual([
        { type: 'setPending', entries: pendingSpawns('a') },
      ]);
      expect(sentOfType(secondHost, 'forgetRuns')).toEqual([
        { type: 'forgetRuns', ids: ['marker'] },
      ]);
      expect(olderHost.got.map((message) => message.type)).toEqual([
        'hello',
        'drain',
        'list',
      ]);
    },
  );
});
