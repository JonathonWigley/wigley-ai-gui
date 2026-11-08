import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelPath } from '../../../../shared/local-channel/channel-path';
import { osPlatform } from '../../../../shared/os-platform';
import {
  type ConnectedSession,
  RELAY_PROTOCOL,
  type RelayHello,
  type SessionInfo,
} from '../../contract';
import {
  type RelayServerDeps,
  type ServeSession,
  startRelayServer,
} from './relay-server';

const HELLO: RelayHello = {
  protocol: RELAY_PROTOCOL,
  session_id: 'session-1',
  project_dir: '/work/project',
  deadline_seconds: 300,
  harness: 'claude',
};

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function fakeSessions() {
  const started: SessionInfo[] = [];
  let ended = 0;
  const connect = (info: SessionInfo): ConnectedSession => {
    started.push(info);
    return {
      session: { id: `app-${started.length}`, info },
      call: async () => ({ content: [] }),
      end: () => {
        ended++;
      },
    };
  };
  return { connect, started, ended: () => ended };
}

// Echoes every byte back, so a test sees exactly what reached `serve`.
function echoServe() {
  let closed = 0;
  const serve: ServeSession = ({ input, output }) => {
    input.on('data', (chunk) => output.write(chunk));
    input.resume();
    return {
      close: async () => {
        closed++;
      },
    };
  };
  return { serve, closed: () => closed };
}

// The production channel over a test folder: a named pipe on Windows, a
// socket file elsewhere.
function testChannel(dir: string): string {
  return channelPath(
    osPlatform(process.platform),
    dir,
    'selftest',
    'wigley-ai-gui',
    '',
    dir,
  );
}

const channelIsPipe = testChannel(tmpdir()).startsWith('\\\\.\\pipe\\');

// macOS caps a socket path near 104 bytes, so the folder name stays short.
function start(
  serve: ServeSession,
  connect: RelayServerDeps['connect'],
  leftover = false,
  ready: RelayServerDeps['ready'] = () => Promise.resolve(),
  log: RelayServerDeps['log'] = () => {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wr-'));
  const channel = testChannel(dir);
  if (leftover) {
    mkdirSync(path.dirname(channel), { recursive: true });
    writeFileSync(channel, '');
  }
  const server = startRelayServer({ channel, ready, connect, serve, log });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => server.close());
  return channel;
}

async function open(channel: string) {
  const socket = connect(channel);
  cleanups.push(() => {
    socket.destroy();
  });
  await once(socket, 'connect');
  const lines: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  createInterface({ input: socket }).on('line', (line) => {
    const waiter = waiting.shift();
    if (waiter) {
      waiter(line);
    } else {
      lines.push(line);
    }
  });
  const nextLine = () =>
    new Promise<string>((resolve) => {
      const line = lines.shift();
      if (line === undefined) {
        waiting.push(resolve);
      } else {
        resolve(line);
      }
    });
  return { socket, nextLine };
}

function helloLine(hello: object): string {
  return `${JSON.stringify(hello)}\n`;
}

describe('startRelayServer', () => {
  it('answers a hello and hands every later byte to serve', async () => {
    const { connect, started } = fakeSessions();
    const channel = start(echoServe().serve, connect);
    const { socket, nextLine } = await open(channel);

    socket.write(`${helloLine(HELLO)}first\n`);

    expect(JSON.parse(await nextLine())).toEqual({ ok: true });
    expect(await nextLine()).toBe('first');
    socket.write('second\n');
    expect(await nextLine()).toBe('second');
    expect(started).toEqual([
      {
        sessionId: 'session-1',
        projectDir: '/work/project',
        harness: 'claude',
        host: { deadline_seconds: 300 },
      },
    ]);
  });

  it('refuses a hello of another protocol, naming both versions', async () => {
    const { connect, started } = fakeSessions();
    const channel = start(echoServe().serve, connect);
    const { socket, nextLine } = await open(channel);
    const ended = once(socket, 'end');

    socket.write(helloLine({ ...HELLO, protocol: 99 }));

    expect(JSON.parse(await nextLine())).toEqual({
      ok: false,
      error: `relay protocol 99, app protocol ${RELAY_PROTOCOL}`,
    });
    await ended;
    expect(started).toEqual([]);
  });

  it('answers a hello that arrives in two chunks', async () => {
    const { connect, started } = fakeSessions();
    const channel = start(echoServe().serve, connect);
    const { socket, nextLine } = await open(channel);
    const hello = helloLine(HELLO);
    const half = Math.floor(hello.length / 2);

    await new Promise<void>((resolve) =>
      socket.write(hello.slice(0, half), () => resolve()),
    );
    // The server has no signal for a partial read; the pause lets it read the first half alone.
    await new Promise((resolve) => setTimeout(resolve, 20));
    socket.write(hello.slice(half));

    expect(JSON.parse(await nextLine())).toEqual({ ok: true });
    expect(started).toHaveLength(1);
  });

  it('refuses a first line that is not JSON and starts no session', async () => {
    const { connect, started } = fakeSessions();
    const channel = start(echoServe().serve, connect);
    const { socket, nextLine } = await open(channel);
    const ended = once(socket, 'end');

    socket.write('not json\n');

    expect(JSON.parse(await nextLine())).toEqual({
      ok: false,
      error: 'the first line was not a relay hello',
    });
    await ended;
    expect(started).toEqual([]);
  });

  it.each([
    ['session_id', { session_id: 7 }],
    ['project_dir', { project_dir: 42 }],
    ['harness', { harness: 3 }],
    ['config_dir', { config_dir: 3 }],
  ])(
    'refuses a hello whose %s has the wrong type and starts no session',
    async (field, override) => {
      const { connect, started } = fakeSessions();
      const channel = start(echoServe().serve, connect);
      const { socket, nextLine } = await open(channel);
      const ended = once(socket, 'end');

      socket.write(helloLine({ ...HELLO, ...override }));

      expect(JSON.parse(await nextLine())).toEqual({
        ok: false,
        error: `relay hello field ${field} has the wrong type`,
      });
      await ended;
      expect(started).toEqual([]);
    },
  );

  it('refuses a hello whose session fails to start, naming the failure, and serves nothing', async () => {
    let served = 0;
    const channel = start(
      () => {
        served++;
        return { close: async () => {} };
      },
      () => {
        throw new Error('forms could not start');
      },
    );
    const { socket, nextLine } = await open(channel);
    const ended = once(socket, 'end');

    socket.write(helloLine(HELLO));

    expect(JSON.parse(await nextLine())).toEqual({
      ok: false,
      error: 'the app could not start the session: forms could not start',
    });
    await ended;
    expect(served).toBe(0);
  });

  it.each([
    {
      hello: {
        protocol: RELAY_PROTOCOL,
        session_id: null,
        project_dir: null,
        deadline_seconds: null,
        harness: null,
      },
      expected: {
        sessionId: null,
        projectDir: null,
        harness: null,
        host: { deadline_seconds: null },
      },
    },
    {
      hello: { protocol: RELAY_PROTOCOL },
      expected: {
        sessionId: null,
        projectDir: null,
        harness: null,
      },
    },
    {
      hello: { ...HELLO, config_dir: '/home/me/.claude-work' },
      expected: {
        sessionId: 'session-1',
        projectDir: '/work/project',
        harness: 'claude',
        profileDir: '/home/me/.claude-work',
        host: { deadline_seconds: 300 },
      },
    },
    {
      hello: { ...HELLO, harness: 'codex' },
      expected: {
        sessionId: 'session-1',
        projectDir: '/work/project',
        harness: 'codex',
        host: { deadline_seconds: 300 },
      },
    },
    {
      hello: { ...HELLO, harness: 'gemini' },
      expected: {
        sessionId: 'session-1',
        projectDir: '/work/project',
        harness: null,
        host: { deadline_seconds: 300 },
      },
    },
    {
      hello: { ...HELLO, deadline_seconds: '300', tab_id: 7 },
      expected: {
        sessionId: 'session-1',
        projectDir: '/work/project',
        harness: 'claude',
        host: { deadline_seconds: '300', tab_id: 7 },
      },
    },
  ])(
    'starts a session from hello $hello as $expected',
    async ({ hello, expected }) => {
      const { connect, started } = fakeSessions();
      const channel = start(echoServe().serve, connect);
      const { socket, nextLine } = await open(channel);

      socket.write(helloLine(hello));

      expect(JSON.parse(await nextLine())).toEqual({ ok: true });
      expect(started).toEqual([expected]);
    },
  );

  it('ends the session and its server when the relay disconnects', async () => {
    const fake = fakeSessions();
    const echo = echoServe();
    const channel = start(echo.serve, fake.connect);
    const { socket, nextLine } = await open(channel);
    socket.write(helloLine(HELLO));
    await nextLine();

    socket.end();

    await vi.waitFor(() => expect(fake.ended()).toBe(1));
    expect(echo.closed()).toBe(1);
  });

  // A `ready` the test resolves itself, and the log it fills.
  function heldReady() {
    let release = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const logged: string[] = [];
    const log: RelayServerDeps['log'] = (message) => {
      logged.push(message);
    };
    return { ready: () => ready, release: () => release(), logged, log };
  }

  it('hello_WhileHeld_RepliesOnceReady', async () => {
    const fake = fakeSessions();
    const hold = heldReady();
    const channel = start(
      echoServe().serve,
      fake.connect,
      false,
      hold.ready,
      hold.log,
    );
    const { socket, nextLine } = await open(channel);
    const replied = nextLine();

    socket.write(`${helloLine(HELLO)}first\n`);
    // The server has no signal for a read it holds; the pause lets the bytes arrive.
    await new Promise((resolve) => setTimeout(resolve, 20));
    socket.write('second\n');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fake.started).toEqual([]);
    hold.release();

    expect(JSON.parse(await replied)).toEqual({ ok: true });
    expect(fake.started).toHaveLength(1);
    expect(await nextLine()).toBe('first');
    expect(await nextLine()).toBe('second');
  });

  it('hello_ClosedWhileHeld_NeverConnects', async () => {
    const fake = fakeSessions();
    const hold = heldReady();
    const channel = start(
      echoServe().serve,
      fake.connect,
      false,
      hold.ready,
      hold.log,
    );
    const { socket } = await open(channel);

    socket.write(helloLine(HELLO));
    socket.end();
    await once(socket, 'close');
    await new Promise((resolve) => setTimeout(resolve, 20));
    hold.release();

    await vi.waitFor(() =>
      expect(hold.logged).toContain('a relay left while its connect was held'),
    );
    expect(fake.started).toEqual([]);
  });

  it('hello_Refused_NotHeld', async () => {
    const fake = fakeSessions();
    const hold = heldReady();
    const channel = start(
      echoServe().serve,
      fake.connect,
      false,
      hold.ready,
      hold.log,
    );
    const { socket, nextLine } = await open(channel);

    socket.write(helloLine({ ...HELLO, protocol: 99 }));

    expect(JSON.parse(await nextLine())).toEqual({
      ok: false,
      error: `relay protocol 99, app protocol ${RELAY_PROTOCOL}`,
    });
    expect(fake.started).toEqual([]);
  });

  it.skipIf(channelIsPipe)(
    'listens over a socket file a crashed run left behind',
    async () => {
      const channel = start(echoServe().serve, fakeSessions().connect, true);
      const { socket, nextLine } = await open(channel);

      socket.write(helloLine(HELLO));

      expect(JSON.parse(await nextLine())).toEqual({ ok: true });
    },
  );
});
