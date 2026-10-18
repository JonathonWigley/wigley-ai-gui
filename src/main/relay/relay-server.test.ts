import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AnswersPayload,
  FormsService,
  SessionInfo,
} from '../../contracts/forms';
import { RELAY_PROTOCOL, type RelayHello } from '../../contracts/relay';
import { type ServeSession, startRelayServer } from './relay-server';

const PAYLOAD: AnswersPayload = {
  outcome: 'no_round',
  summary: 'No round.',
  next: 'Send the round with ask_round.',
  answers: [],
  notices: [],
};

const HELLO: RelayHello = {
  protocol: RELAY_PROTOCOL,
  session_id: 'session-1',
  project_dir: '/work/project',
  deadline_seconds: 300,
};

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function fakeForms() {
  const started: SessionInfo[] = [];
  let ended = 0;
  const forms: FormsService = {
    startSession: (info) => {
      started.push(info);
      return {
        askRound: async () => PAYLOAD,
        collectLastRound: async () => PAYLOAD,
        end: () => {
          ended++;
        },
      };
    },
  };
  return { forms, started, ended: () => ended };
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

// macOS caps a socket path near 104 bytes, so the folder name stays short.
function start(serve: ServeSession, forms: FormsService, leftover = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wr-'));
  const channel = path.join(dir, 's.sock');
  if (leftover) {
    writeFileSync(channel, '');
  }
  const server = startRelayServer({ channel, forms, serve, log: () => {} });
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
    const { forms, started } = fakeForms();
    const channel = start(echoServe().serve, forms);
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
        deadlineSeconds: 300,
      },
    ]);
  });

  it('starts a session with null fields from a hello that has none', async () => {
    const { forms, started } = fakeForms();
    const channel = start(echoServe().serve, forms);
    const { socket, nextLine } = await open(channel);

    socket.write(
      helloLine({
        protocol: RELAY_PROTOCOL,
        session_id: null,
        project_dir: null,
        deadline_seconds: null,
      }),
    );
    await nextLine();

    expect(started).toEqual([
      { sessionId: null, projectDir: null, deadlineSeconds: null },
    ]);
  });

  it('refuses a hello of another protocol, naming both versions', async () => {
    const { forms, started } = fakeForms();
    const channel = start(echoServe().serve, forms);
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
    const { forms, started } = fakeForms();
    const channel = start(echoServe().serve, forms);
    const { socket, nextLine } = await open(channel);
    const hello = helloLine(HELLO);
    const half = Math.floor(hello.length / 2);

    await new Promise<void>((resolve) =>
      socket.write(hello.slice(0, half), () => resolve()),
    );
    socket.write(hello.slice(half));

    expect(JSON.parse(await nextLine())).toEqual({ ok: true });
    expect(started).toHaveLength(1);
  });

  it('refuses a first line that is not JSON and starts no session', async () => {
    const { forms, started } = fakeForms();
    const channel = start(echoServe().serve, forms);
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

  it('ends the session and its server when the relay disconnects', async () => {
    const fake = fakeForms();
    const echo = echoServe();
    const channel = start(echo.serve, fake.forms);
    const { socket, nextLine } = await open(channel);
    socket.write(helloLine(HELLO));
    await nextLine();

    socket.end();

    await vi.waitFor(() => expect(fake.ended()).toBe(1));
    expect(echo.closed()).toBe(1);
  });

  it('listens over a socket file a crashed run left behind', async () => {
    const channel = start(echoServe().serve, fakeForms().forms, true);
    const { socket, nextLine } = await open(channel);

    socket.write(helloLine(HELLO));

    expect(JSON.parse(await nextLine())).toEqual({ ok: true });
  });
});
