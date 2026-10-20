import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { Log } from '../../../../contracts/log';
import { errorText } from '../../../../shared/error-text';
import {
  type ConnectedSession,
  HARNESSES,
  RELAY_PROTOCOL,
  type RelayHello,
  type Harness,
  type RelayHelloReply,
  type SessionInfo,
} from '../../contract';

// Serves MCP for one session; `input` arrives paused, holding any bytes the
// relay sent after its hello, and `serve` resumes it.
export type ServeSession = (
  streams: { input: Readable; output: Writable },
  session: ConnectedSession,
) => { close(): Promise<void> };

// `connect` opens the app's session for each relay that said hello.
export interface RelayServerDeps {
  channel: string;
  connect(info: SessionInfo): ConnectedSession;
  serve: ServeSession;
  log: Log;
}

const PIPE_PREFIX = '\\\\.\\pipe\\';

function parseHello(line: string): { hello: RelayHello } | { error: string } {
  let hello: RelayHello | null;
  try {
    hello = JSON.parse(line) as RelayHello | null;
  } catch {
    return { error: 'the first line was not a relay hello' };
  }
  if (hello?.protocol !== RELAY_PROTOCOL) {
    return {
      error: `relay protocol ${hello?.protocol}, app protocol ${RELAY_PROTOCOL}`,
    };
  }
  const badField = mistypedHelloField(hello);
  if (badField !== null) {
    return { error: `relay hello field ${badField} has the wrong type` };
  }
  return { hello };
}

// An absent field counts as null.
function isOptional(value: unknown, type: 'string' | 'number'): boolean {
  return value === undefined || value === null || typeof value === type;
}

function mistypedHelloField(hello: RelayHello): string | null {
  if (!isOptional(hello.session_id, 'string')) {
    return 'session_id';
  }
  if (!isOptional(hello.project_dir, 'string')) {
    return 'project_dir';
  }
  if (!isOptional(hello.deadline_seconds, 'number')) {
    return 'deadline_seconds';
  }
  if (!isOptional(hello.harness, 'string')) {
    return 'harness';
  }
  return null;
}

// A harness the app does not know reads as none.
function harnessOf(value: string | null | undefined): Harness | null {
  return HARNESSES.find((harness) => harness === value) ?? null;
}

function sessionInfo(hello: RelayHello): SessionInfo {
  return {
    sessionId: hello.session_id ?? null,
    projectDir: hello.project_dir ?? null,
    deadlineSeconds: hello.deadline_seconds ?? null,
    harness: harnessOf(hello.harness),
  };
}

function replyLine(reply: RelayHelloReply): string {
  return `${JSON.stringify(reply)}\n`;
}

function refuse(socket: Socket, error: string, deps: RelayServerDeps) {
  deps.log('relay', `refused a relay: ${error}`);
  socket.end(replyLine({ ok: false, error }));
}

// The session opens before the reply, so a hello the app cannot serve is
// refused rather than answered ok over a session that never started.
function startSession(socket: Socket, line: string, deps: RelayServerDeps) {
  const parsed = parseHello(line);
  if ('error' in parsed) {
    refuse(socket, parsed.error, deps);
    return;
  }
  let session: ConnectedSession;
  try {
    session = deps.connect(sessionInfo(parsed.hello));
  } catch (error) {
    refuse(
      socket,
      `the app could not start the session: ${errorText(error)}`,
      deps,
    );
    return;
  }
  socket.write(replyLine({ ok: true }));
  const served = deps.serve({ input: socket, output: socket }, session);
  socket.on('close', () => {
    session.end();
    void served.close();
  });
}

// Reads the hello line, then hands the socket on paused, with the bytes that
// followed the newline put back in front.
function acceptConnection(socket: Socket, deps: RelayServerDeps) {
  socket.on('error', (error) =>
    deps.log('relay', `a relay connection failed: ${error.message}`),
  );
  let received = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    received = Buffer.concat([received, chunk]);
    const newline = received.indexOf('\n');
    if (newline === -1) {
      return;
    }
    socket.pause();
    socket.off('data', onData);
    const rest = received.subarray(newline + 1);
    if (rest.length > 0) {
      socket.unshift(rest);
    }
    startSession(socket, received.subarray(0, newline).toString('utf8'), deps);
  };
  socket.on('data', onData);
}

// Listens for relay.py connections on the channel, one connected session each.
export function startRelayServer(deps: RelayServerDeps): {
  close(): Promise<void>;
} {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    acceptConnection(socket, deps);
  });
  server.on('error', (error) =>
    deps.log('relay', `channel ${deps.channel} failed: ${error.message}`),
  );
  if (!deps.channel.startsWith(PIPE_PREFIX)) {
    mkdirSync(path.dirname(deps.channel), { recursive: true });
    // A crashed run leaves its socket file behind, and listen fails on it.
    rmSync(deps.channel, { force: true });
  }
  server.listen(deps.channel);
  return {
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  };
}
