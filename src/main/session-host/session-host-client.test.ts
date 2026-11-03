import {
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
import type {
  HostedExit,
  HostedProcessEvents,
  HostedSpawn,
  PipeLine,
} from '../../contracts/session-host';
import {
  type ClientMessage,
  type HostMessage,
  hostRecordFile,
  type ListedProcess,
  SESSION_HOST_PROTOCOL,
  type SubscribeMessage,
} from '../../contracts/session-host-protocol';
import { channelPath } from '../../shared/local-channel/channel-path';
import { jsonLine, readLines } from '../../shared/local-channel/line-framing';
import {
  type ChannelServer,
  listenOnChannel,
} from '../../shared/local-channel/local-channel';
import {
  createSessionHostClient,
  type SessionHostClient,
  type SessionHostSpawn,
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
  return channelPath(process.platform, dir, 'u', 'wigley-ai-gui', suffix, dir);
}

interface ManualTimers extends Timers {
  fire(ms: number): void;
  pending(ms?: number): number;
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
  };
}

interface HostScript {
  protocol?: number;
  silent?: boolean; // answers nothing at all
  processes?: ListedProcess[];
  stopAllAnswered?: boolean;
  subscribed?(message: SubscribeMessage, host: ScriptedHost): void;
}

interface ScriptedHost {
  got: ClientMessage[];
  sockets: Socket[];
  push(message: HostMessage): void;
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
    stop: async () => {
      await server?.close();
    },
  };
  const answer = (socket: Socket, message: ClientMessage) => {
    got.push(message);
    if (script.silent) {
      return;
    }
    if (message.type === 'hello') {
      socket.write(
        jsonLine({
          type: 'hello',
          requestId: message.requestId,
          protocol: script.protocol ?? SESSION_HOST_PROTOCOL,
        }),
      );
    } else if (message.type === 'list') {
      socket.write(
        jsonLine({
          type: 'list',
          requestId: message.requestId,
          processes: script.processes ?? [],
        }),
      );
    } else if (message.type === 'subscribe') {
      script.subscribed?.(message, host);
    } else if (message.type === 'stopAll' && script.stopAllAnswered !== false) {
      socket.write(jsonLine({ type: 'stopAll', requestId: message.requestId }));
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

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: Parameters<SessionHostSpawn>[2];
}

function clientRig(
  folderRoot: string,
  channel: string,
  spawned: (listeners: ((error: Error) => void)[]) => void = () => {},
) {
  const folder = path.join(folderRoot, 'session-host');
  mkdirSync(folder, { recursive: true });
  const timers = manualTimers();
  const logged: string[] = [];
  const spawnCalls: SpawnCall[] = [];
  let unrefs = 0;
  let now = 5000;
  const spawn: SessionHostSpawn = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    const listeners: ((error: Error) => void)[] = [];
    spawned(listeners);
    return {
      unref: () => {
        unrefs += 1;
      },
      on: (_event, listener) => listeners.push(listener),
    };
  };
  const create = (): SessionHostClient => {
    const client = createSessionHostClient({
      folder,
      channel,
      hostScript: '/build/session-host.js',
      execPath: '/app/binary',
      env: { KEPT: 'yes' },
      spawn,
      clock: { now: () => now },
      timers,
      log: (_source, message) => logged.push(message),
    });
    cleanups.push(() => client.close());
    return client;
  };
  return {
    folder,
    timers,
    logged,
    spawnCalls,
    create,
    unrefs: () => unrefs,
    moveClock: (ms: number) => {
      now += ms;
    },
  };
}

function recordedEvents() {
  const lines: PipeLine[] = [];
  const closed: HostedExit[] = [];
  const events: HostedProcessEvents = {
    line: (line) => lines.push(line),
    closed: (exit) => closed.push(exit),
  };
  return {
    events,
    lines,
    closed,
    seqs: () => lines.map((line) => line.seq),
    errors: () => closed.map((exit) => exit.error),
  };
}

function spawnRequest(id: string): HostedSpawn {
  return {
    id,
    command: 'claude',
    args: [],
    cwd: '/work',
    env: {},
    idleRule: {
      key: 'type',
      value: 'result',
      ignoredStdoutValues: [],
      ignoredStdinValues: [],
    },
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
) {
  host.push({
    type: 'subscribe',
    requestId: message.requestId,
    id: message.id,
    running: log !== null,
    log,
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

describe('createSessionHostClient', () => {
  it('create_HostAnswers_ConnectsWithoutSpawning', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();

    await client.list();

    expect(rig.spawnCalls).toEqual([]);
    expect(host.got.slice(0, 2)).toEqual([
      { type: 'hello', requestId: 1 },
      { type: 'setKeepIdle', minutes: 60 },
    ]);
  });

  it('create_SpawnEmitsError_FailsAtOnce', async () => {
    const dir = tempFolder();
    const rig = clientRig(dir, testChannel(dir, ''), (listeners) =>
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener(new Error('spawn x ENOENT'));
        }
      }),
    );
    const client = rig.create();
    const queued = recordedEvents();

    client.spawn(spawnRequest('a'), queued.events);

    await vi.waitFor(() =>
      expect(queued.errors()).toEqual([
        'the session host did not start: spawn x ENOENT',
      ]),
    );
    expect(rig.spawnCalls).toHaveLength(1);
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
        expect(rig.spawnCalls).toEqual([]);
      }
      rig.timers.fire(REPLY_LIMIT_MS);
      await vi.waitFor(() => expect(rig.timers.pending(POLL_MS)).toBe(1));
      rig.timers.fire(POLL_MS);
    }

    expect(rig.spawnCalls).toHaveLength(1);
  });

  it('connect_WrongProtocol_CountsAsNoAnswer', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    await startScriptedHost(channel, { protocol: SESSION_HOST_PROTOCOL + 1 });
    const rig = clientRig(dir, channel);
    rig.create();

    await vi.waitFor(() => expect(rig.spawnCalls).toHaveLength(1));
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
    expect(rig.spawnCalls).toEqual([
      {
        command: '/app/binary',
        args: ['/build/session-host.js', rig.folder, channel],
        options: {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: { KEPT: 'yes', ELECTRON_RUN_AS_NODE: '1' },
        },
      },
    ]);
    expect(rig.unrefs()).toBe(1);

    const host = await starting[0];
    rig.timers.fire(POLL_MS);

    await vi.waitFor(() =>
      expect(host.got).toContainEqual({ type: 'setKeepIdle', minutes: 60 }),
    );
    expect(rig.spawnCalls).toHaveLength(1);
  });

  it('create_HostNeverAnswers_ClosesQueuedSpawnsWithTheReason', async () => {
    const dir = tempFolder();
    const rig = clientRig(dir, testChannel(dir, ''));
    const client = rig.create();
    const queued = recordedEvents();
    client.spawn(spawnRequest('a'), queued.events);
    const listing = client.list();

    await vi.waitFor(() => expect(rig.timers.pending(POLL_MS)).toBe(1));
    rig.moveClock(START_LIMIT_MS - 1);
    rig.timers.fire(POLL_MS);
    await vi.waitFor(() => expect(rig.timers.pending(POLL_MS)).toBe(1));
    expect(queued.closed).toEqual([]);

    rig.moveClock(1);
    rig.timers.fire(POLL_MS);

    await vi.waitFor(() => expect(queued.closed).toHaveLength(1));
    expect(queued.errors()[0]).toMatch(/^the session host did not start:/);
    await expect(listing).resolves.toEqual([]);
    expect(rig.spawnCalls).toHaveLength(1);
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
    { name: 'reply running false', log: null, unsubscribes: [] },
    {
      name: 'the log file missing',
      log: '/no/such/file.jsonl',
      unsubscribes: [{ type: 'unsubscribe', id: 'a' }],
    },
  ])('attach_Cases_ResolvesNull: $name', async ({ log, unsubscribes }) => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel, {
      subscribed: (message, scripted) => {
        replySubscribed(scripted, message, log);
        scripted.push(linePush('a', 1));
      },
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const attached = recordedEvents();

    await expect(client.attach('a', attached.events)).resolves.toBeNull();
    await client.list();

    rig.timers.fire(0);
    expect(sentOfType(host, 'unsubscribe')).toEqual(unsubscribes);
    expect(attached.lines).toEqual([]);
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
      protocol: 2,
      processes: [listed('c', 3)],
    });
    const rig = clientRig(dir, channel);
    writeRecord(rig.folder, 0, older);
    const newerRecord = writeRecord(rig.folder, 2, newer);
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
    },
    {
      name: 'a server that never replies',
      file: hostRecordFile(0),
      content: 'silent',
      kept: true,
      logged: false,
    },
    {
      name: 'a file that does not parse',
      file: hostRecordFile(0),
      content: '{ not json',
      kept: true,
      logged: true,
    },
    {
      name: 'a temporary file',
      file: `${hostRecordFile(1)}.tmp`,
      content: '{ not json',
      kept: true,
      logged: false,
    },
  ])(
    'otherRecord_Cases_DeletesOnlyWhenTheConnectFails: $name',
    async ({ file, content, kept, logged }) => {
      const dir = tempFolder();
      const channel = testChannel(dir, '');
      const other = testChannel(dir, '-other');
      await startScriptedHost(channel, { processes: [listed('a', 1)] });
      if (content === 'silent') {
        await startScriptedHost(other, { silent: true });
      }
      const rig = clientRig(dir, channel);
      const record = path.join(rig.folder, file);
      const isChannelRow = content === 'dead' || content === 'silent';
      writeFileSync(
        record,
        isChannelRow
          ? JSON.stringify({ protocol: 0, channel: other, pid: 1 })
          : content,
      );
      const client = rig.create();

      let merged: unknown = null;
      void client.list().then((result) => {
        merged = result;
      });
      await vi.waitFor(() => {
        rig.timers.fire(REPLY_LIMIT_MS);
        expect(merged).not.toBeNull();
      });

      expect(merged).toEqual([
        { id: 'a', startedAt: 1, running: true, current: true },
      ]);
      expect(existsSync(record)).toBe(kept);
      expect(rig.logged.some((line) => line.includes(file))).toBe(
        logged || !kept,
      );
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
    client.spawn(spawnRequest('spawned'), spawned.events);
    client.spawn(spawnRequest('detached'), detached.events).detach();
    await client.attach('attached', attached.events);
    rig.timers.fire(0);

    await host.stop();

    await vi.waitFor(() => expect(spawned.errors()).toEqual([EXITED]));
    expect(attached.errors()).toEqual([EXITED]);
    expect(detached.closed).toEqual([]);
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
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const attached = recordedEvents();
    const sentinel = recordedEvents();
    client.spawn(spawnRequest('sentinel'), sentinel.events);
    await client.attach('a', attached.events);

    await host.stop();
    await vi.waitFor(() => expect(sentinel.errors()).toEqual([EXITED]));

    expect(attached.closed).toEqual([]);
    rig.timers.fire(0);
    expect(attached.seqs()).toEqual([2]);
    expect(attached.errors()).toEqual([EXITED]);
  });

  it('hostExits_PendingCalls_ResolveEmpty', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    let stopping = false;
    const host = await startScriptedHost(channel, {
      stopAllAnswered: false,
      subscribed: () => {
        stopping = true;
      },
    });
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const attached = recordedEvents();

    const attach = client.attach('a', attached.events);
    const stopAll = client.stopAll();
    await vi.waitFor(() => expect(stopping).toBe(true));
    await vi.waitFor(() => expect(sentOfType(host, 'stopAll')).toHaveLength(1));
    await host.stop();

    await expect(attach).resolves.toBeNull();
    await expect(stopAll).resolves.toBeUndefined();
    expect(attached.closed).toEqual([]);
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

  it('close_OpenProcesses_FiresNoClosed', async () => {
    const dir = tempFolder();
    const channel = testChannel(dir, '');
    const host = await startScriptedHost(channel);
    const rig = clientRig(dir, channel);
    const client = rig.create();
    const opened = recordedEvents();
    const process = client.spawn(spawnRequest('a'), opened.events);
    await client.list();

    await client.close();

    await vi.waitFor(() => expect(host.sockets).toEqual([]));
    expect(opened.closed).toEqual([]);
    expect(rig.timers.pending()).toBe(0);
    const late = recordedEvents();
    const lateProcess = client.spawn(spawnRequest('b'), late.events);
    lateProcess.write('x');
    process.write('x');
    await expect(client.attach('a', opened.events)).resolves.toBeNull();
    await expect(client.list()).resolves.toEqual([]);
    await expect(client.stopAll()).resolves.toBeUndefined();
    expect(late.closed).toEqual([]);
    expect(sentOfType(host, 'write')).toEqual([]);
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
    expect(rig.spawnCalls).toEqual([]);
  });
});
