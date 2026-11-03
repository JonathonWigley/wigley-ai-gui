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
import type { HostMessage } from '../contracts/session-host-protocol';
import { channelPath } from '../shared/local-channel/channel-path';
import { jsonLine, readLines } from '../shared/local-channel/line-framing';
import {
  connectToChannel,
  listenOnChannel,
} from '../shared/local-channel/local-channel';
import { startSessionHost } from './host-server';
import {
  type FakeChild,
  fakeChild,
  manualTime,
  spawnRequest,
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
    process.platform,
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
) {
  const { folder, channel } = existing ?? tempFolder();
  const time = manualTime();
  const spawned: FakeChild[] = [];
  const exits: number[] = [];
  const started = startSessionHost({
    folder,
    channel,
    pid: 4242,
    children: {
      spawn: () => {
        const fake = fakeChild();
        spawned.push(fake);
        return fake.child;
      },
      endLeftovers,
      killAll: () => {},
    },
    clock: time.clock,
    timers: time.timers,
    exit: (code) => exits.push(code),
  });
  return { folder, channel, time, spawned, exits, started };
}

type Host = ReturnType<typeof host>;

// Ends a host that the test left running: every child closes, then a drain.
async function stopHost(running: Host) {
  for (const fake of running.spawned) {
    fake.close();
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
) {
  const running = host(existing, endLeftovers);
  cleanups.push(() => stopHost(running));
  await vi.waitFor(() =>
    expect(existsSync(path.join(running.folder, 'host-v1.json'))).toBe(true),
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

    expect(reply).toEqual({ type: 'hello', requestId: 1, protocol: 1 });
  });

  it.each([
    { known: true, running: true, hasLog: true },
    { known: false, running: false, hasLog: false },
  ])(
    'subscribe_Cases_RepliesThenPushesLines: known $known',
    async ({ known, running: isRunning, hasLog }) => {
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
      });
      if (known) {
        fake.stdout.write('later\n');
        await vi.waitFor(() => expect(reader.linesOf()).toEqual(['later']));
      }
    },
  );

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

  it('stopAll_Cases_RepliesOnceEveryProcessClosed: empty table', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);

    const reply = await replyTo(connection, { type: 'stopAll', requestId: 1 });

    expect(reply).toEqual({ type: 'stopAll', requestId: 1 });
  });

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
        readFileSync(path.join(running.folder, 'host-v1.log'), 'utf8'),
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
      path.join(running.folder, 'host-v1.log'),
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
      readFileSync(path.join(running.folder, 'host-v1.log'), 'utf8'),
    ).toContain(line);
    // Not being a message, the line made no client: the first-client wait still ends the host.
    running.time.advanceTo(30_000);
    await vi.waitFor(() => expect(running.exits).toEqual([0]));
  });
});

describe('host messages with bad fields', () => {
  it('spawn_NoRequest_IsLoggedAndTheHostKeepsServing', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);

    connection.send({ type: 'spawn' });
    await settled(connection);

    expect(
      readFileSync(path.join(running.folder, 'host-v1.log'), 'utf8'),
    ).toContain('message spawn');
    expect(running.exits).toEqual([]);
    await spawned(running, connection, 'a');
  });

  it('spawn_NoIdleRule_SendsClosedToThatSubscriber', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);

    connection.send({ type: 'spawn', request: { id: 'a' } });
    await vi.waitFor(() =>
      expect(connection.received.map(({ type }) => type)).toContain('closed'),
    );

    expect(running.spawned).toEqual([]);
    const list = await replyTo(connection, { type: 'list', requestId: 1 });
    expect(list).toEqual({ type: 'list', requestId: 1, processes: [] });
  });
});

describe('host lifetime', () => {
  it('drain_IdleAndBusy_EndsEachAtTurnEndThenExits', async () => {
    const running = await runningHost();
    const connection = await client(running.channel);
    const idle = await spawned(running, connection, 'idle');
    const busy = await spawned(running, connection, 'busy');
    connection.send({ type: 'write', id: 'busy', text: 'go' });
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
    expect(existsSync(path.join(running.folder, 'host-v1.json'))).toBe(false);
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
    expect(existsSync(path.join(running.folder, 'host-v1.json'))).toBe(false);
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
      process.platform,
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
    writeFileSync(path.join(seeded.folder, 'host-v1.log'), 'previous\n');

    const running = await runningHost(seeded);
    await running.started;

    expect(
      JSON.parse(
        readFileSync(path.join(running.folder, 'host-v1.json'), 'utf8'),
      ),
    ).toEqual({ protocol: 1, channel: running.channel, pid: 4242 });
    expect(
      readFileSync(path.join(running.folder, 'host-v1.previous.log'), 'utf8'),
    ).toBe('previous\n');
    expect(existsSync(path.join(running.folder, 'host-v1.log'))).toBe(false);
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

  function leftoversEndedByTest() {
    let finish = () => {};
    const ended = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { endLeftovers: () => ended, finish };
  }

  it('start_EndingLeftovers_HoldsASpawnAndWhatFollowsIt', async () => {
    const seeded = tempFolder();
    seedOldLog(seeded.folder);
    writeFileSync(path.join(seeded.folder, 'logs', 'new.jsonl'), 'stale\n');
    const { endLeftovers, finish } = leftoversEndedByTest();
    const running = await runningHost(seeded, endLeftovers);
    const connection = await client(running.channel);

    connection.send({ type: 'spawn', request: spawnRequest('new') });
    connection.send({ type: 'write', id: 'new', text: 'hi' });
    const list = await replyTo(connection, { type: 'list', requestId: 1 });

    expect(list).toEqual({ type: 'list', requestId: 1, processes: [] });
    expect(running.spawned).toEqual([]);

    finish();
    await running.started;

    expect(running.spawned).toHaveLength(1);
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
    expect(existsSync(path.join(folder, 'host-v1.json'))).toBe(false);
    expect(readFileSync(path.join(folder, 'host-v1.log'), 'utf8')).toContain(
      'listen',
    );
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
      const liveLog = path.join(seeded.folder, 'host-v1.log');
      writeFileSync(liveLog, 'live\n');
      const live = liveListener(seeded.channel, replyProtocol);
      await live.listening;

      const second = host(seeded);
      if (replyProtocol === null) {
        await vi.waitFor(() => expect(hostSockets.length).toBeGreaterThan(0));
        second.time.advanceTo(2000);
      }
      await second.started;

      expect(second.exits).toEqual([0]);
      expect(existsSync(path.join(seeded.folder, 'host-v1.json'))).toBe(false);
      expect(readFileSync(liveLog, 'utf8')).toBe('live\n');
      expect(existsSync(path.join(seeded.folder, 'logs', 'old.jsonl'))).toBe(
        true,
      );
      const reaches = await connectToChannel(seeded.channel);
      reaches.destroy();
    },
  );
});
