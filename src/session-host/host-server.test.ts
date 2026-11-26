import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostedRun, PendingSpawn } from '../contracts/session-host';
import {
  type HostMessage,
  hostLogFile,
  hostRecordFile,
  pendingFile,
  previousHostLogFile,
  runsFile,
  SESSION_HOST_PROTOCOL,
} from '../contracts/session-host-protocol';
import { channelPath } from '../shared/local-channel/channel-path';
import { jsonLine, readLines } from '../shared/local-channel/line-framing';
import { osPlatform } from '../shared/os-platform';
import {
  connectToChannel,
  listenOnChannel,
} from '../shared/local-channel/local-channel';
import { startSessionHost } from './host-server';
import {
  type FakeChild,
  type FakePty,
  fakeChild,
  fakePty,
  manualTime,
  spawnRequest,
  terminalRequest,
} from './session-host-test-doubles';

const hostSockets = vi.hoisted(() => [] as Socket[]);

// Records the host's side of each connection, so a test can reset one as the OS would.
vi.mock('../shared/local-channel/local-channel', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('../shared/local-channel/local-channel')
    >();
  return {
    ...original,
    listenOnChannel: (
      channel: string,
      handlers: Parameters<typeof original.listenOnChannel>[1],
    ) =>
      original.listenOnChannel(channel, {
        ...handlers,
        connected(socket) {
          hostSockets.push(socket);
          handlers.connected(socket);
        },
      }),
  };
});

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
  hostSockets.length = 0;
});

function tempFolder() {
  const folder = mkdtempSync(path.join(tmpdir(), 'sh-'));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(path.join(folder, 'logs'));
  const channel = channelPath(
    osPlatform(process.platform),
    folder,
    'selftest',
    'wigley-ai-gui',
    '',
    folder,
  );
  return { folder, channel };
}

function host(
  existing?: { folder: string; channel: string },
  endLeftovers: () => Promise<void> = () => Promise.resolve(),
  env: NodeJS.ProcessEnv = {},
) {
  const { folder, channel } = existing ?? tempFolder();
  const time = manualTime();
  const spawned: FakeChild[] = [];
  const ptys: FakePty[] = [];
  const childEnvs: NodeJS.ProcessEnv[] = [];
  const exits: number[] = [];
  const started = startSessionHost({
    folder,
    channel,
    pid: 4242,
    children: {
      spawn: (_command, _args, options) => {
        const fake = fakeChild();
        spawned.push(fake);
        childEnvs.push(options.env);
        return fake.child;
      },
      recordPid: () => ({ kill: () => {}, dispose: () => {} }),
      endLeftovers,
      killAll: () => {},
    },
    env,
    clock: time.clock,
    timers: time.timers,
    ptySpawn: () => {
      const fake = fakePty();
      ptys.push(fake);
      return fake.pty;
    },
    exit: (code) => exits.push(code),
  });
  return { folder, channel, time, spawned, ptys, childEnvs, exits, started };
}

type Host = ReturnType<typeof host>;

// Ends a host that the test left running: every child closes and every shell exits, then a drain.
async function stopHost(running: Host) {
  for (const fake of running.spawned) {
    fake.close();
  }
  for (const fake of running.ptys) {
    fake.exit();
  }
  await new Promise((resolve) => setImmediate(resolve));
  if (running.exits.length === 0) {
    const socket = await connectToChannel(running.channel).catch(() => null);
    socket?.on('error', () => {});
    socket?.write(jsonLine({ type: 'drain' }));
    await vi.waitFor(() => expect(running.exits.length).toBeGreaterThan(0));
    socket?.destroy();
  }
}

async function runningHost(
  existing?: { folder: string; channel: string },
  endLeftovers?: () => Promise<void>,
  env?: NodeJS.ProcessEnv,
) {
  const running = host(existing, endLeftovers, env);
  cleanups.push(() => stopHost(running));
  await vi.waitFor(() =>
    expect(
      existsSync(
        path.join(running.folder, hostRecordFile(SESSION_HOST_PROTOCOL)),
      ),
    ).toBe(true),
  );
  return running;
}

async function client(channel: string) {
  const socket = await connectToChannel(channel);
  socket.on('error', () => {});
  cleanups.push(() => {
    socket.destroy();
  });
  const received: HostMessage[] = [];
  readLines(socket, (line) => received.push(JSON.parse(line) as HostMessage));
  return {
    socket,
    received,
    send(message: unknown) {
      socket.write(jsonLine(message));
    },
    linesOf: () =>
      received.flatMap((message) =>
        message.type === 'line' ? [message.line.text] : [],
      ),
    terminalMessages: () =>
      received.filter(
        ({ type }) => type === 'termData' || type === 'termClosed',
      ),
    terminalDataOf: () =>
      received.flatMap((message) =>
        message.type === 'termData' ? [message.data] : [],
      ),
  };
}

type Client = Awaited<ReturnType<typeof client>>;

async function replyTo(
  connection: Client,
  message: { type: string; requestId: number } & Record<string, unknown>,
) {
  connection.send(message);
  await vi.waitFor(() =>
    expect(
      connection.received.some(
        (received) =>
          received.type === message.type &&
          'requestId' in received &&
          received.requestId === message.requestId,
      ),
    ).toBe(true),
  );
  return connection.received.find(
    (received) =>
      received.type === message.type &&
      'requestId' in received &&
      received.requestId === message.requestId,
  ) as HostMessage;
}

let requestIdCount = 100;
function nextRequestId() {
  requestIdCount += 1;
  return requestIdCount;
}

// `hello` has a reply, so once it arrives the host has handled every earlier message of this connection.
async function settled(connection: Client) {
  await replyTo(connection, {
    type: 'hello',
    requestId: nextRequestId(),
  });
}

async function spawned(
  running: Host,
  connection: Client,
  id: string,
): Promise<FakeChild> {
  const before = running.spawned.length;
  connection.send({ type: 'spawn', request: spawnRequest(id) });
  await vi.waitFor(() => expect(running.spawned.length).toBe(before + 1));
  return running.spawned[before];
}

async function spawnedShell(
  running: Host,
  connection: Client,
  id: string,
): Promise<FakePty> {
  const before = running.ptys.length;
  connection.send({ type: 'termSpawn', request: terminalRequest(id) });
  await vi.waitFor(() => expect(running.ptys.length).toBe(before + 1));
  return running.ptys[before];
}

function pendingEntry(
  id: string,
  at: number,
  needsClient = false,
): PendingSpawn {
  return {
    at,
    spawn: spawnRequest(id),
    record: { task: id },
    skipWhileBusy: null,
    needsClient,
  };
}

function hostedRun(id: string, startedAt = 0): HostedRun {
  return {
    id,
    record: { task: id },
    startedAt,
    skipped: false,
    exit: { code: 0, signal: null, error: null },
  };
}

function writeRuns(folder: string, protocol: number, runs: HostedRun[]) {
  writeFileSync(path.join(folder, runsFile(protocol)), JSON.stringify(runs));
}

function writePending(folder: string, entries: PendingSpawn[]) {
  writeFileSync(
    path.join(folder, pendingFile(SESSION_HOST_PROTOCOL)),
    JSON.stringify(entries),
  );
}

async function listedRuns(connection: Client) {
  const reply = await replyTo(connection, {
    type: 'listRuns',
    requestId: nextRequestId(),
  });
  return reply.type === 'listRuns' ? reply.runs : null;
}

function leftoversEndedByTest() {
  let finish = () => {};
  const ended = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { endLeftovers: () => ended, finish };
}

function liveListener(channel: string, replyProtocol: number | null) {
  const server = listenOnChannel(channel, {
    connected(socket) {
      socket.on('error', () => {});
      readLines(socket, (line) => {
        const { requestId } = JSON.parse(line) as { requestId: number };
        if (replyProtocol !== null) {
          socket.write(
            jsonLine({ type: 'hello', requestId, protocol: replyProtocol }),
          );
        }
      });
    },
    failed: () => {},
  });
  cleanups.push(() => server.close());
  return server;
}

describe('host protocol', () => {
  it('hello_RepliesTheProtocol', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);

    const reply = await replyTo(connection, { type: 'hello', requestId: 1 });

    expect(reply).toEqual({
      type: 'hello',
      requestId: 1,
      protocol: SESSION_HOST_PROTOCOL,
    });
  });

  it.each([
    { known: true, running: true, hasLog: true, pid: 4321 },
    { known: false, running: false, hasLog: false, pid: null },
  ])(
    'subscribe_Cases_RepliesThenPushesLines: known $known',
    async ({ known, running: isRunning, hasLog, pid }) => {
      const running = await runningHost();
      const owner = await client(running.channel);
      const fake = await spawned(running, owner, 'a');
      const reader = await client(running.channel);

      const reply = await replyTo(reader, {
        type: 'subscribe',
        requestId: 1,
        id: known ? 'a' : 'b',
      });

      expect(reply).toEqual({
        type: 'subscribe',
        requestId: 1,
        id: known ? 'a' : 'b',
        running: isRunning,
        log: hasLog ? path.join(running.folder, 'logs', 'a.jsonl') : null,
        pid,
      });
      if (known) {
        fake.stdout.write('later\n');
        await vi.waitFor(() => expect(reader.linesOf()).toEqual(['later']));
      }
    },
  );

  it('spawn_HostEnv_ReachesTheProcessTable', async () => {
    const running = await runningHost(undefined, undefined, {
      A: '1',
      ELECTRON_RUN_AS_NODE: '1',
    });
    const connection = await client(running.channel);

    connection.send({
      type: 'spawn',
      request: { ...spawnRequest('a'), inheritEnv: true },
    });

    await vi.waitFor(() => expect(running.childEnvs).toEqual([{ A: '1' }]));
  });

  it('spawned_GoesToTheSpawnerOnly_AndTheSubscribeReplyCarriesThePid', async () => {
    const running = await runningHost();
    const first = await client(running.channel);
    const second = await client(running.channel);

    await spawned(running, first, 'a');

    await vi.waitFor(() =>
      expect(first.received).toContainEqual({
        type: 'spawned',
        id: 'a',
        pid: 4321,
      }),
    );
    await settled(second);
    expect(second.received.filter(({ type }) => type === 'spawned')).toEqual(
      [],
    );
    expect(
      await replyTo(second, { type: 'subscribe', requestId: 1, id: 'a' }),
    ).toEqual({
      type: 'subscribe',
      requestId: 1,
      id: 'a',
      running: true,
      log: path.join(running.folder, 'logs', 'a.jsonl'),
      pid: 4321,
    });
    expect(
      await replyTo(second, { type: 'subscribe', requestId: 2, id: 'nope' }),
    ).toEqual({
      type: 'subscribe',
      requestId: 2,
      id: 'nope',
      running: false,
      log: null,
      pid: null,
    });
  });

  it('list_TwoProcesses_ListsEachWithItsLogPath', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    await spawned(running, connection, 'a');
    await spawned(running, connection, 'x:1');

    const reply = await replyTo(connection, { type: 'list', requestId: 1 });

    const logs = path.join(running.folder, 'logs');
    expect(reply).toEqual({
      type: 'list',
      requestId: 1,
      processes: [
        {
          id: 'a',
          startedAt: 0,
          running: true,
          code: null,
          signal: null,
          log: path.join(logs, 'a.jsonl'),
        },
        {
          id: 'x:1',
          startedAt: 0,
          running: true,
          code: null,
          signal: null,
          log: path.join(logs, 'x%3A1.jsonl'),
        },
      ],
    });
  });

  it('subscribe_SecondConnection_ReplacesTheFirst', async () => {
    const running = await runningHost();
    const first = await client(running.channel);
    const fake = await spawned(running, first, 'a');
    const second = await client(running.channel);
    await replyTo(second, { type: 'subscribe', requestId: 1, id: 'a' });

    fake.stdout.write('later\n');
    await vi.waitFor(() => expect(second.linesOf()).toEqual(['later']));
    await settled(first);

    expect(first.linesOf()).toEqual([]);
  });

  it.each([
    { from: 'the subscriber', stops: true },
    { from: 'another connection', stops: false },
  ])(
    'unsubscribe_Cases_StopsOnlyTheSubscriber: from $from',
    async ({ stops }) => {
      const running = await runningHost();
      const subscriber = await client(running.channel);
      const other = await client(running.channel);
      const fake = await spawned(running, subscriber, 'a');
      const sender = stops ? subscriber : other;

      sender.send({ type: 'unsubscribe', id: 'a' });
      await settled(sender);
      fake.stdout.write('later\n');
      // A line takes the same path to any connection, so the file holding it means the host has handled it.
      const logFile = path.join(running.folder, 'logs', 'a.jsonl');
      await vi.waitFor(() =>
        expect(readFileSync(logFile, 'utf8')).toContain('later'),
      );
      await settled(subscriber);

      expect(subscriber.linesOf()).toEqual(stops ? [] : ['later']);
      const list = await replyTo(other, {
        type: 'list',
        requestId: nextRequestId(),
      });
      expect(
        list.type === 'list' && list.processes.map(({ id }) => id),
      ).toEqual(['a']);
    },
  );

  it('stopAll_Cases_RepliesOnceEveryProcessClosed: two processes', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    const a = await spawned(running, connection, 'a');
    const b = await spawned(running, connection, 'b');

    connection.send({ type: 'stopAll', requestId: 1 });
    await vi.waitFor(() => expect(a.signals).toEqual(['SIGTERM']));
    expect(b.signals).toEqual(['SIGTERM']);

    a.close();
    await settled(connection);
    expect(connection.received.some(({ type }) => type === 'stopAll')).toBe(
      false,
    );

    running.time.advanceTo(3000);
    expect(a.signals).toEqual(['SIGTERM']);
    expect(b.signals).toEqual(['SIGTERM', 'SIGKILL']);

    b.close();
    await vi.waitFor(() =>
      expect(connection.received).toContainEqual({
        type: 'stopAll',
        requestId: 1,
      }),
    );
  });

  it.each([
    { first: 'the process', processClosesFirst: true },
    { first: 'the shell', processClosesFirst: false },
  ])(
    'stopAll_Cases_RepliesOnceEveryProcessClosed: a shell and a process, $first ending first',
    async ({ processClosesFirst }) => {
      const running = await runningHost();
      const connection = await client(running.channel);
      const child = await spawned(running, connection, 'a');
      const shell = await spawnedShell(running, connection, 't');

      connection.send({ type: 'stopAll', requestId: 1 });
      await vi.waitFor(() => expect(child.signals).toEqual(['SIGTERM']));
      expect(shell.kills()).toBe(1);

      const endings = [() => child.close(), () => shell.exit()];
      const [endFirst, endSecond] = processClosesFirst
        ? endings
        : endings.reverse();
      endFirst();
      await settled(connection);
      expect(connection.received.some(({ type }) => type === 'stopAll')).toBe(
        false,
      );

      endSecond();
      await vi.waitFor(() =>
        expect(connection.received).toContainEqual({
          type: 'stopAll',
          requestId: 1,
        }),
      );
    },
  );

  it('stopAll_Cases_RepliesOnceEveryProcessClosed: empty table', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);

    const reply = await replyTo(connection, { type: 'stopAll', requestId: 1 });

    expect(reply).toEqual({ type: 'stopAll', requestId: 1 });
  });

  it.each([
    {
      name: 'a spawn, the process table empty',
      route: 'spawn',
      routeTableHeld: false,
    },
    {
      name: 'a termSpawn, the terminal table empty',
      route: 'termSpawn',
      routeTableHeld: false,
    },
    {
      name: 'a spawn, the process table emptied first',
      route: 'spawn',
      routeTableHeld: true,
    },
    {
      name: 'a termSpawn, the terminal table emptied first',
      route: 'termSpawn',
      routeTableHeld: true,
    },
  ] as const)(
    'stopAll_SpawnWhileTheOtherTableEnds_IsRefusedUntilTheReply: $name',
    async ({ route, routeTableHeld }) => {
      const running = await runningHost();
      const connection = await client(running.channel);
      const holdsProcess = route === 'termSpawn' || routeTableHeld;
      const holdsShell = route === 'spawn' || routeTableHeld;
      const child = holdsProcess
        ? await spawned(running, connection, 'a')
        : null;
      const shell = holdsShell
        ? await spawnedShell(running, connection, 't')
        : null;
      const endProcess = () => child?.close();
      const endShell = () => shell?.exit();
      const [endRouteTable, endOtherTable] =
        route === 'spawn' ? [endProcess, endShell] : [endShell, endProcess];

      connection.send({ type: 'stopAll', requestId: 1 });
      await settled(connection);
      endRouteTable();
      await settled(connection);
      const childrenBefore = running.spawned.length;
      const ptysBefore = running.ptys.length;
      connection.send({
        type: route,
        request: route === 'spawn' ? spawnRequest('n') : terminalRequest('n'),
      });
      await settled(connection);

      expect(connection.received).toContainEqual({
        type: route === 'spawn' ? 'closed' : 'termClosed',
        id: 'n',
        exit: {
          code: null,
          signal: null,
          error: 'the session host is stopping',
        },
      });
      expect(running.spawned).toHaveLength(childrenBefore);
      expect(running.ptys).toHaveLength(ptysBefore);

      endOtherTable();
      await vi.waitFor(() =>
        expect(connection.received).toContainEqual({
          type: 'stopAll',
          requestId: 1,
        }),
      );
      // Once the reply is out, the same route spawns again.
      if (route === 'spawn') {
        await spawned(running, connection, 'm');
      } else {
        await spawnedShell(running, connection, 'm');
      }
    },
  );

  it('closed_SubscribedClient_GetsClosedThenLogGone', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    const fake = await spawned(running, connection, 'a');

    fake.close(0);
    await vi.waitFor(() =>
      expect(connection.received).toContainEqual({
        type: 'closed',
        id: 'a',
        exit: { code: 0, signal: null, error: null },
      }),
    );

    expect(existsSync(path.join(running.folder, 'logs', 'a.jsonl'))).toBe(
      false,
    );
    const list = await replyTo(connection, { type: 'list', requestId: 1 });
    expect(list).toEqual({ type: 'list', requestId: 1, processes: [] });
  });

  it('connectionError_ResetSocket_IsADisconnect', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    const fake = await spawned(running, connection, 'a');
    const hostSide = hostSockets[0];
    const reset = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
    });

    hostSide.destroy(reset);
    await vi.waitFor(() =>
      expect(
        readFileSync(
          path.join(running.folder, hostLogFile(SESSION_HOST_PROTOCOL)),
          'utf8',
        ),
      ).toContain('ECONNRESET'),
    );

    fake.stdout.write('{"type":"result"}\n');
    const logFile = path.join(running.folder, 'logs', 'a.jsonl');
    await vi.waitFor(() =>
      expect(readFileSync(logFile, 'utf8')).toContain('result'),
    );
    expect(running.exits).toEqual([]);
    // With the connection gone the keep window runs, so no client still counts.
    running.time.advanceTo(3_600_000);
    expect(fake.stdin.writableEnded).toBe(true);
  });

  it('stdinError_WriteAfterChildDied_KeepsTheHostAndOtherProcesses', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    const a = await spawned(running, connection, 'a');
    const b = await spawned(running, connection, 'b');
    a.stdin.write = () => {
      a.stdin.emit(
        'error',
        Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }),
      );
      return false;
    };

    connection.send({ type: 'write', id: 'a', text: 'x' });
    await settled(connection);
    b.stdout.write('later\n');
    await vi.waitFor(() => expect(connection.linesOf()).toEqual(['later']));

    const diagnostics = readFileSync(
      path.join(running.folder, hostLogFile(SESSION_HOST_PROTOCOL)),
      'utf8',
    );
    expect(diagnostics.trim().split('\n')).toHaveLength(1);
    expect(diagnostics).toContain('EPIPE');
    expect(running.exits).toEqual([]);
  });

  it.each([
    { line: 'not json' },
    { line: '{"type":"nonsense"}' },
    { line: 'null' },
  ])('badLine_Cases_IsLoggedAndIgnored: $line', async ({ line }) => {
    const running = await runningHost();
    const connection = await client(running.channel);

    connection.socket.write(`${line}\n`);
    await settled(connection);

    expect(
      readFileSync(
        path.join(running.folder, hostLogFile(SESSION_HOST_PROTOCOL)),
        'utf8',
      ),
    ).toContain(line);
    // Not being a message, the line made no client: the first-client wait still ends the host.
    running.time.advanceTo(30_000);
    await vi.waitFor(() => expect(running.exits).toEqual([0]));
  });
});

describe('host terminals', () => {
  it('termSpawn_ThenOutputAndExit_PushesToTheSubscribedConnectionOnly', async () => {
    const running = await runningHost();
    const owner = await client(running.channel);
    const other = await client(running.channel);
    const shell = await spawnedShell(running, owner, 'a');

    shell.emitData('hi');
    shell.exit();

    await vi.waitFor(() =>
      expect(owner.terminalMessages()).toEqual([
        { type: 'termData', id: 'a', data: 'hi' },
        {
          type: 'termClosed',
          id: 'a',
          exit: { code: 0, signal: null, error: null },
        },
      ]),
    );
    await settled(other);
    expect(other.terminalMessages()).toEqual([]);
  });

  it('termAttach_SecondConnection_RepliesTheReplayAndTakesTheOutput', async () => {
    const running = await runningHost();
    const owner = await client(running.channel);
    const shell = await spawnedShell(running, owner, 'a');
    shell.emitData('before');
    const second = await client(running.channel);

    const reply = await replyTo(second, {
      type: 'termAttach',
      requestId: 1,
      id: 'a',
    });

    expect(reply).toEqual({
      type: 'termAttach',
      requestId: 1,
      id: 'a',
      terminal: { replay: 'before', running: true },
    });
    shell.emitData('after');
    await vi.waitFor(() => expect(second.terminalDataOf()).toEqual(['after']));
    await settled(owner);
    expect(owner.terminalDataOf()).toEqual(['before']);
    expect(
      await replyTo(second, { type: 'termAttach', requestId: 2, id: 'nope' }),
    ).toEqual({ type: 'termAttach', requestId: 2, id: 'nope', terminal: null });
  });

  it.each([
    {
      name: 'termWrite',
      message: { type: 'termWrite', id: 'a', data: 'ls' },
      effect: (shell: FakePty) => ({ written: shell.written }),
      expected: { written: ['ls'] },
    },
    {
      name: 'termResize',
      message: { type: 'termResize', id: 'a', cols: 90, rows: 20 },
      effect: (shell: FakePty) => ({ resizes: shell.resizes }),
      expected: { resizes: [{ cols: 90, rows: 20 }] },
    },
    {
      name: 'termKill',
      message: { type: 'termKill', id: 'a' },
      effect: (shell: FakePty) => ({ kills: shell.kills() }),
      expected: { kills: 1 },
    },
  ])(
    'termMessage_Cases_ReachTheShell: $name',
    async ({ message, effect, expected }) => {
      const running = await runningHost();
      const connection = await client(running.channel);
      const shell = await spawnedShell(running, connection, 'a');

      connection.send(message);
      await settled(connection);

      expect(effect(shell)).toEqual(expected);
    },
  );

  it('termDetach_ThenOutput_IsKeptForTheNextAttach', async () => {
    const running = await runningHost();
    const owner = await client(running.channel);
    const shell = await spawnedShell(running, owner, 'a');

    owner.send({ type: 'termDetach', id: 'a' });
    await settled(owner);
    shell.emitData('unseen');
    await settled(owner);

    expect(owner.terminalDataOf()).toEqual([]);
    expect(
      await replyTo(owner, { type: 'termAttach', requestId: 1, id: 'a' }),
    ).toEqual({
      type: 'termAttach',
      requestId: 1,
      id: 'a',
      terminal: { replay: 'unseen', running: true },
    });
  });

  it('disconnect_Subscriber_OutputAfterIsKeptForTheNextAttach', async () => {
    const running = await runningHost();
    const owner = await client(running.channel);
    const shell = await spawnedShell(running, owner, 'a');
    const closed = new Promise((resolve) =>
      hostSockets[0].once('close', resolve),
    );

    owner.socket.destroy();
    await closed;
    shell.emitData('unseen');
    const next = await client(running.channel);

    expect(
      await replyTo(next, { type: 'termAttach', requestId: 1, id: 'a' }),
    ).toEqual({
      type: 'termAttach',
      requestId: 1,
      id: 'a',
      terminal: { replay: 'unseen', running: true },
    });
  });

  it('termList_RepliesEachShell', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    await spawnedShell(running, connection, 'a');
    await spawnedShell(running, connection, 'b');

    const reply = await replyTo(connection, { type: 'termList', requestId: 1 });

    expect(reply).toEqual({
      type: 'termList',
      requestId: 1,
      terminals: [
        { id: 'a', startedAt: 0, running: true },
        { id: 'b', startedAt: 0, running: true },
      ],
    });
  });
});

describe('host messages with bad fields', () => {
  it('spawn_NoRequest_IsLoggedAndTheHostKeepsServing', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);

    connection.send({ type: 'spawn' });
    await settled(connection);

    expect(
      readFileSync(
        path.join(running.folder, hostLogFile(SESSION_HOST_PROTOCOL)),
        'utf8',
      ),
    ).toContain('message spawn');
    expect(running.exits).toEqual([]);
    await spawned(running, connection, 'a');
  });

  it.each([
    { label: 'no rule at all', request: { id: 'a' } },
    {
      label: 'a rule with no value',
      request: {
        id: 'a',
        idleRule: {
          key: 'type',
          busyStdoutValues: ['assistant'],
          busyStdinValues: ['user'],
        },
      },
    },
  ])(
    'spawn_NoIdleRule_SendsClosedToThatSubscriber: $label',
    async ({ request }) => {
      const running = await runningHost();
      const connection = await client(running.channel);

      connection.send({ type: 'spawn', request });
      await vi.waitFor(() =>
        expect(connection.received.map(({ type }) => type)).toContain('closed'),
      );

      expect(running.spawned).toEqual([]);
      const list = await replyTo(connection, { type: 'list', requestId: 1 });
      expect(list).toEqual({ type: 'list', requestId: 1, processes: [] });
    },
  );
});

describe('host queue', () => {
  it('setPending_DueEntry_SpawnsAndPushesRunStartedToEveryClient', async () => {
    const running = await runningHost();
    const first = await client(running.channel);
    const second = await client(running.channel);
    const probe = await client(running.channel);
    second.send({ type: 'setKeepIdle', minutes: 60 });
    await settled(second);
    await settled(probe);

    first.send({ type: 'setPending', entries: [pendingEntry('a', 0)] });

    const pushed = {
      type: 'runStarted',
      run: { ...hostedRun('a'), exit: null },
    };
    await vi.waitFor(() => expect(first.received).toContainEqual(pushed));
    await vi.waitFor(() => expect(second.received).toContainEqual(pushed));
    expect(running.spawned).toHaveLength(1);
    await settled(probe);
    expect(probe.received.map(({ type }) => type)).toEqual(['hello', 'hello']);
  });

  it('listRuns_RepliesTheRunsOldestFirst', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    connection.send({ type: 'setPending', entries: [pendingEntry('a', 0)] });
    await settled(connection);
    running.time.advanceTo(5);
    connection.send({ type: 'setPending', entries: [pendingEntry('b', 5)] });

    expect(await listedRuns(connection)).toEqual([
      { ...hostedRun('a', 0), exit: null },
      { ...hostedRun('b', 5), exit: null },
    ]);
  });

  it('forgetRuns_ThenListRuns_LeavesTheRest', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    connection.send({
      type: 'setPending',
      entries: [pendingEntry('a', 0), pendingEntry('b', 0)],
    });

    connection.send({ type: 'forgetRuns', ids: ['a'] });

    expect(await listedRuns(connection)).toEqual([
      { ...hostedRun('b'), exit: null },
    ]);
  });

  it('hostQueue_NeedsClient: a fresh connection sends an attended entry due now', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);

    connection.send({
      type: 'setPending',
      entries: [pendingEntry('attended', 0, true)],
    });

    await vi.waitFor(() =>
      expect(connection.received).toContainEqual({
        type: 'runStarted',
        run: { ...hostedRun('attended'), exit: null },
      }),
    );
    expect(running.spawned).toHaveLength(1);
  });

  it.each<{ label: string; later: PendingSpawn[]; exits: number[] }>([
    { label: 'alone', later: [], exits: [0] },
    {
      label: 'beside a later unattended entry',
      later: [pendingEntry('later', 1e12)],
      exits: [],
    },
  ])(
    'hostQueue_NeedsClient: an attended entry comes due after the app left, $label',
    async ({ later, exits }) => {
      const running = await runningHost();
      const connection = await client(running.channel);
      connection.send({
        type: 'setPending',
        entries: [pendingEntry('attended', 10, true), ...later],
      });
      await settled(connection);
      connection.socket.destroy();
      await vi.waitFor(() => expect(hostSockets[0].destroyed).toBe(true));

      running.time.advanceTo(10);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(running.spawned).toEqual([]);
      expect(
        readFileSync(
          path.join(running.folder, hostLogFile(SESSION_HOST_PROTOCOL)),
          'utf8',
        ),
      ).toContain('pending attended: dropped, no app connected');
      await vi.waitFor(() => expect(running.exits).toEqual(exits));
    },
  );

  it.each([
    { label: 'before a listRuns reply', sendsPending: false },
    { label: 'before a setPending dedupe', sendsPending: true },
  ])(
    'import_OlderRunsFileWrittenAfterLoad_IsImportedFirst: $label',
    async ({ sendsPending }) => {
      const running = await runningHost();
      const connection = await client(running.channel);
      await settled(connection);
      writeRuns(running.folder, SESSION_HOST_PROTOCOL - 1, [
        hostedRun('older'),
      ]);

      if (sendsPending) {
        connection.send({
          type: 'setPending',
          entries: [pendingEntry('older', 0)],
        });
        await settled(connection);
      }

      expect(running.spawned).toEqual([]);
      expect(await listedRuns(connection)).toEqual([hostedRun('older')]);
      expect(
        existsSync(
          path.join(running.folder, runsFile(SESSION_HOST_PROTOCOL - 1)),
        ),
      ).toBe(false);
    },
  );
});

describe('host lifetime', () => {
  it('drain_IdleAndBusy_EndsEachAtTurnEndThenExits', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    const idle = await spawned(running, connection, 'idle');
    const busy = await spawned(running, connection, 'busy');
    connection.send({ type: 'write', id: 'busy', text: '{"type":"user"}' });
    await settled(connection);

    connection.send({ type: 'drain' });
    await settled(connection);

    expect(idle.stdin.writableEnded).toBe(true);
    expect(busy.stdin.writableEnded).toBe(false);

    busy.stdout.write('{"type":"result"}\n');
    await vi.waitFor(() => expect(busy.stdin.writableEnded).toBe(true));
    idle.close();
    await settled(connection);
    expect(running.exits).toEqual([]);

    busy.close();
    await vi.waitFor(() => expect(running.exits).toEqual([0]));
    expect(
      existsSync(
        path.join(running.folder, hostRecordFile(SESSION_HOST_PROTOCOL)),
      ),
    ).toBe(false);
  });

  it('drain_IdleAndBusy_EndsEachAtTurnEndThenExits: with pending entries and runs', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    connection.send({
      type: 'setPending',
      entries: [pendingEntry('fired', 0), pendingEntry('later', 1e12)],
    });
    await settled(connection);
    const runsPath = path.join(running.folder, runsFile(SESSION_HOST_PROTOCOL));
    const runsText = readFileSync(runsPath, 'utf8');

    connection.send({ type: 'drain' });
    await settled(connection);
    expect(
      existsSync(path.join(running.folder, pendingFile(SESSION_HOST_PROTOCOL))),
    ).toBe(false);
    expect(running.exits).toEqual([]);

    running.spawned[0].close();
    await vi.waitFor(() => expect(running.exits).toEqual([0]));
    expect(readFileSync(runsPath, 'utf8')).toBe(runsText);
  });

  it('exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient: pending entries and no client', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    connection.send({
      type: 'setPending',
      entries: [pendingEntry('later', 1e12)],
    });
    await settled(connection);

    connection.socket.destroy();
    await vi.waitFor(() => expect(hostSockets[0].destroyed).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(running.exits).toEqual([]);
  });

  it('exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient: a running shell and no client', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    const shell = await spawnedShell(running, connection, 'a');

    connection.socket.destroy();
    await vi.waitFor(() => expect(hostSockets[0].destroyed).toBe(true));
    running.time.advanceTo(30_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(running.exits).toEqual([]);

    shell.exit();

    await vi.waitFor(() => expect(running.exits).toEqual([0]));
  });

  it('drain_Shell_KillsAtOnceThenExits', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    const shell = await spawnedShell(running, connection, 'a');

    connection.send({ type: 'drain' });
    await settled(connection);

    expect(shell.kills()).toBe(1);
    expect(running.exits).toEqual([]);
    shell.exit({ exitCode: 0, signal: 1 });
    await vi.waitFor(() => expect(running.exits).toEqual([0]));
  });

  it('exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient: run records and no client', async () => {
    const seeded = tempFolder();
    writeRuns(seeded.folder, SESSION_HOST_PROTOCOL, [hostedRun('a')]);
    const running = await runningHost(seeded);

    running.time.advanceTo(30_000);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(running.exits).toEqual([]);
  });

  it('exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient: the last record forgotten and the client leaves', async () => {
    const seeded = tempFolder();
    writeRuns(seeded.folder, SESSION_HOST_PROTOCOL, [hostedRun('a')]);
    const running = await runningHost(seeded);
    const connection = await client(running.channel);
    connection.send({ type: 'forgetRuns', ids: ['a'] });
    await settled(connection);
    expect(running.exits).toEqual([]);

    connection.socket.destroy();

    await vi.waitFor(() => expect(running.exits).toEqual([0]));
  });

  it('exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient: the last client disconnects', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    connection.send({ type: 'setKeepIdle', minutes: 60 });
    await settled(connection);
    expect(running.exits).toEqual([]);

    connection.socket.destroy();

    await vi.waitFor(() => expect(running.exits).toEqual([0]));
  });

  it('exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient: no connection at all', async () => {
    const running = await runningHost();

    running.time.advanceTo(29_999);
    await new Promise((resolve) => setImmediate(resolve));
    expect(running.exits).toEqual([]);

    running.time.advanceTo(30_000);
    await vi.waitFor(() => expect(running.exits).toEqual([0]));
    expect(
      existsSync(
        path.join(running.folder, hostRecordFile(SESSION_HOST_PROTOCOL)),
      ),
    ).toBe(false);
  });

  it('shutDown_RecordNowHoldsAnotherPid_LeavesTheRecord', async () => {
    const running = await runningHost();
    const record = path.join(
      running.folder,
      hostRecordFile(SESSION_HOST_PROTOCOL),
    );
    const another = JSON.stringify({
      protocol: SESSION_HOST_PROTOCOL,
      channel: running.channel,
      pid: 4343,
    });
    writeFileSync(record, another);

    running.time.advanceTo(30_000);
    await vi.waitFor(() => expect(running.exits).toEqual([0]));

    expect(readFileSync(record, 'utf8')).toBe(another);
  });

  it('exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient: a probe leaves inside the wait', async () => {
    const running = await runningHost();
    const probe = await client(running.channel);
    await replyTo(probe, { type: 'hello', requestId: 1 });
    await replyTo(probe, { type: 'list', requestId: 2 });
    running.time.advanceTo(1000);
    const probeSide = hostSockets[0];

    probe.socket.destroy();
    await vi.waitFor(() => expect(probeSide.destroyed).toBe(true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(running.exits).toEqual([]);

    running.time.advanceTo(29_999);
    await new Promise((resolve) => setImmediate(resolve));
    expect(running.exits).toEqual([]);

    running.time.advanceTo(30_000);
    await vi.waitFor(() => expect(running.exits).toEqual([0]));
  });

  it('exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient: a client connected at the wait end', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    connection.send({ type: 'setKeepIdle', minutes: 60 });
    await settled(connection);

    running.time.advanceTo(30_000);
    await settled(connection);

    expect(running.exits).toEqual([]);
  });

  it('keepWindow_ProbeConnection_IsNotAClient', async () => {
    const running = await runningHost();
    const owner = await client(running.channel);
    const fake = await spawned(running, owner, 'a');
    owner.send({ type: 'setKeepIdle', minutes: 60 });
    await settled(owner);
    const ownerSide = hostSockets[0];
    owner.socket.destroy();
    await vi.waitFor(() => expect(ownerSide.destroyed).toBe(true));
    await new Promise((resolve) => setImmediate(resolve));

    running.time.advanceTo(1_000_000);
    const probe = await client(running.channel);
    await replyTo(probe, { type: 'hello', requestId: 1 });
    const probeSide = hostSockets[1];
    probe.socket.destroy();
    await vi.waitFor(() => expect(probeSide.destroyed).toBe(true));
    await new Promise((resolve) => setImmediate(resolve));

    running.time.advanceTo(3_599_999);
    expect(fake.stdin.writableEnded).toBe(false);
    running.time.advanceTo(3_600_000);
    expect(fake.stdin.writableEnded).toBe(true);
  });
});

describe('host start', () => {
  function seedOldLog(folder: string) {
    writeFileSync(path.join(folder, 'logs', 'old.jsonl'), 'old\n');
  }

  function writeOtherRecord(folder: string, channel: string) {
    writeFileSync(
      path.join(folder, 'host-v0.json'),
      JSON.stringify({ protocol: 0, channel, pid: 1 }),
    );
  }

  function otherChannel(folder: string) {
    return channelPath(
      osPlatform(process.platform),
      folder,
      'selftest',
      'wigley-ai-gui',
      '-v0',
      folder,
    );
  }

  it('start_RecordAndSweep: no other host writes the record, sets the last log aside and sweeps', async () => {
    const seeded = tempFolder();
    seedOldLog(seeded.folder);
    writeFileSync(
      path.join(seeded.folder, hostLogFile(SESSION_HOST_PROTOCOL)),
      'previous\n',
    );

    const running = await runningHost(seeded);
    await running.started;

    expect(
      JSON.parse(
        readFileSync(
          path.join(running.folder, hostRecordFile(SESSION_HOST_PROTOCOL)),
          'utf8',
        ),
      ),
    ).toEqual({
      protocol: SESSION_HOST_PROTOCOL,
      channel: running.channel,
      pid: 4242,
    });
    expect(
      readFileSync(
        path.join(running.folder, previousHostLogFile(SESSION_HOST_PROTOCOL)),
        'utf8',
      ),
    ).toBe('previous\n');
    expect(
      existsSync(path.join(running.folder, hostLogFile(SESSION_HOST_PROTOCOL))),
    ).toBe(false);
    expect(existsSync(path.join(running.folder, 'logs', 'old.jsonl'))).toBe(
      false,
    );
  });

  it('start_RecordAndSweep: a live host behind host-v0.json keeps the old log', async () => {
    const seeded = tempFolder();
    seedOldLog(seeded.folder);
    const older = otherChannel(seeded.folder);
    const server = liveListener(older, 0);
    await server.listening;
    writeOtherRecord(seeded.folder, older);

    const running = await runningHost(seeded);
    await running.started;

    expect(existsSync(path.join(running.folder, 'logs', 'old.jsonl'))).toBe(
      true,
    );
  });

  it('start_RecordAndSweep: a silent host behind host-v0.json keeps the old log, and a spawn does not wait for it', async () => {
    const seeded = tempFolder();
    seedOldLog(seeded.folder);
    const older = otherChannel(seeded.folder);
    const server = liveListener(older, null);
    await server.listening;
    writeOtherRecord(seeded.folder, older);
    const running = await runningHost(seeded);
    const connection = await client(running.channel);
    await spawned(running, connection, 'new');

    running.time.advanceTo(2000);
    await running.started;

    expect(existsSync(path.join(running.folder, 'logs', 'old.jsonl'))).toBe(
      true,
    );
  });

  it.skipIf(process.platform === 'win32')(
    'start_RecordAndSweep: a host that denies the connect behind host-v0.json keeps the old log',
    async () => {
      const seeded = tempFolder();
      seedOldLog(seeded.folder);
      const older = otherChannel(seeded.folder);
      const server = liveListener(older, 0);
      await server.listening;
      chmodSync(older, 0o000);
      writeOtherRecord(seeded.folder, older);

      const running = await runningHost(seeded);
      await running.started;

      expect(existsSync(path.join(running.folder, 'logs', 'old.jsonl'))).toBe(
        true,
      );
    },
  );

  it('start_RecordAndSweep: a record whose channel has no listener takes the old log', async () => {
    const seeded = tempFolder();
    seedOldLog(seeded.folder);
    writeOtherRecord(seeded.folder, otherChannel(seeded.folder));

    const running = await runningHost(seeded);
    await running.started;

    expect(existsSync(path.join(running.folder, 'logs', 'old.jsonl'))).toBe(
      false,
    );
  });

  it('start_EndingLeftovers_HoldsASpawnAndWhatFollowsIt', async () => {
    const seeded = tempFolder();
    seedOldLog(seeded.folder);
    writeFileSync(path.join(seeded.folder, 'logs', 'new.jsonl'), 'stale\n');
    const { endLeftovers, finish } = leftoversEndedByTest();
    const running = await runningHost(seeded, endLeftovers);
    const connection = await client(running.channel);

    connection.send({ type: 'spawn', request: spawnRequest('new') });
    connection.send({ type: 'write', id: 'new', text: 'hi' });
    connection.send({
      type: 'setPending',
      entries: [pendingEntry('queued', 0)],
    });
    const list = await replyTo(connection, { type: 'list', requestId: 1 });

    expect(list).toEqual({ type: 'list', requestId: 1, processes: [] });
    expect(running.spawned).toEqual([]);

    finish();
    await running.started;

    expect(running.spawned).toHaveLength(2);
    const newLog = readFileSync(
      path.join(running.folder, 'logs', 'new.jsonl'),
      'utf8',
    );
    expect(newLog).toContain('"text":"hi"');
    expect(newLog).not.toContain('stale');
    expect(existsSync(path.join(running.folder, 'logs', 'old.jsonl'))).toBe(
      false,
    );
  });

  it('start_EndingLeftovers_AnswersTermListAndHoldsTermSpawn', async () => {
    const { endLeftovers, finish } = leftoversEndedByTest();
    const running = await runningHost(undefined, endLeftovers);
    const connection = await client(running.channel);

    connection.send({ type: 'termSpawn', request: terminalRequest('a') });
    const list = await replyTo(connection, { type: 'termList', requestId: 1 });

    expect(list).toEqual({ type: 'termList', requestId: 1, terminals: [] });
    expect(running.ptys).toEqual([]);

    finish();
    await running.started;

    expect(running.ptys).toHaveLength(1);
  });

  it('start_PendingFileWithNoClient_SpawnsAfterLeftoversAndStaysAlive', async () => {
    const seeded = tempFolder();
    writePending(seeded.folder, [pendingEntry('due', 0)]);
    const { endLeftovers, finish } = leftoversEndedByTest();
    const running = await runningHost(seeded, endLeftovers);
    const connection = await client(running.channel);

    expect(await listedRuns(connection)).toEqual([]);
    expect(running.spawned).toEqual([]);
    connection.socket.destroy();
    await vi.waitFor(() => expect(hostSockets[0].destroyed).toBe(true));

    finish();
    await running.started;
    expect(running.spawned).toHaveLength(1);

    running.spawned[0].close();
    running.time.advanceTo(30_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(running.exits).toEqual([]);
  });

  it('start_HeldSetPending_ServedBeforeTheLoadedQueueStarts', async () => {
    const seeded = tempFolder();
    writePending(seeded.folder, [pendingEntry('removed', 0)]);
    const { endLeftovers, finish } = leftoversEndedByTest();
    const running = await runningHost(seeded, endLeftovers);
    const connection = await client(running.channel);
    connection.send({ type: 'setPending', entries: [] });
    await settled(connection);

    finish();
    await running.started;
    await settled(connection);

    expect(running.spawned).toEqual([]);
    expect(await listedRuns(connection)).toEqual([]);
  });

  it.each([
    {
      label: 'the last client leaves',
      leave: async (connection: Client) => {
        connection.socket.destroy();
        await vi.waitFor(() => expect(hostSockets[0].destroyed).toBe(true));
      },
    },
    {
      label: 'a drain comes',
      leave: async (connection: Client) => {
        connection.send({ type: 'drain' });
        await settled(connection);
      },
    },
  ])('start_EndingLeftovers_ExitWaitsForThem: $label', async ({ leave }) => {
    const { endLeftovers, finish } = leftoversEndedByTest();
    const running = await runningHost(undefined, endLeftovers);
    const connection = await client(running.channel);
    connection.send({ type: 'setKeepIdle', minutes: 60 });
    await settled(connection);

    await leave(connection);
    // Time for an exit already under way: closing the server takes a few turns of the loop.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(running.exits).toEqual([]);

    finish();

    await vi.waitFor(() => expect(running.exits).toEqual([0]));
  });

  it('start_RecordAndSweep: a listen error other than EADDRINUSE exits 1 with no record', async () => {
    const { folder } = tempFolder();
    const blocker = path.join(folder, 'blocker');
    writeFileSync(blocker, '');
    const channel = path.join(blocker, 'h.sock');

    const running = host({ folder, channel });
    await running.started;

    expect(running.exits).toEqual([1]);
    expect(
      existsSync(path.join(folder, hostRecordFile(SESSION_HOST_PROTOCOL))),
    ).toBe(false);
    expect(
      readFileSync(
        path.join(folder, hostLogFile(SESSION_HOST_PROTOCOL)),
        'utf8',
      ),
    ).toContain('listen');
  });

  it.each([
    {
      label: 'a live host answers the probe',
      replyProtocol: 1 as number | null,
    },
    { label: 'a silent server holds the channel', replyProtocol: null },
  ])(
    'start_AnotherLiveHost_ExitsZeroWithoutRecord: $label',
    async ({ replyProtocol }) => {
      const seeded = tempFolder();
      seedOldLog(seeded.folder);
      const liveLog = path.join(
        seeded.folder,
        hostLogFile(SESSION_HOST_PROTOCOL),
      );
      writeFileSync(liveLog, 'live\n');
      const live = liveListener(seeded.channel, replyProtocol);
      await live.listening;

      const endLeftovers = vi.fn(() => Promise.resolve());
      const second = host(seeded, endLeftovers);
      if (replyProtocol === null) {
        await vi.waitFor(() => expect(hostSockets.length).toBeGreaterThan(0));
        second.time.advanceTo(2000);
      }
      await second.started;

      expect(second.exits).toEqual([0]);
      expect(endLeftovers).not.toHaveBeenCalled();
      expect(
        existsSync(
          path.join(seeded.folder, hostRecordFile(SESSION_HOST_PROTOCOL)),
        ),
      ).toBe(false);
      expect(readFileSync(liveLog, 'utf8')).toBe('live\n');
      expect(existsSync(path.join(seeded.folder, 'logs', 'old.jsonl'))).toBe(
        true,
      );
      const reaches = await connectToChannel(seeded.channel);
      reaches.destroy();
    },
  );
});
