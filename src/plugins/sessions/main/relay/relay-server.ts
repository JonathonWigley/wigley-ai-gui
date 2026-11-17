import type { Socket } from 'node:net';
import type { Readable, Writable } from 'node:stream';
import type { PluginLog } from '../../../../contracts/log';
import { errorText } from '../../../../shared/error-text';
import {
  jsonLine,
  readFirstLine,
} from '../../../../shared/local-channel/line-framing';
import { listenOnChannel } from '../../../../shared/local-channel/local-channel';
import {
  type ConnectedSession,
  RELAY_PROTOCOL,
  type RelayHello,
  type RelayHelloReply,
  type SessionInfo,
} from '../../contract';

// Serves MCP for one session; `input` arrives paused, holding any bytes the
// relay sent after its hello, and `serve` resumes it.
export type ServeSession = (
  streams: { input: Readable; output: Writable },
  session: ConnectedSession,
) => { close(): Promise<void> };

// `connect` opens the app's session for each relay that said a good hello, once
// `ready` resolves; `ready` never rejects.
export interface RelayServerDeps {
  channel: string;
  ready(): Promise<void>;
  connect(info: SessionInfo): ConnectedSession;
  serve: ServeSession;
  log: PluginLog;
}

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
function isOptional(value: unknown, type: 'string'): boolean {
  return value === undefined || value === null || typeof value === type;
}

function mistypedHelloField(hello: RelayHello): string | null {
  if (!isOptional(hello.session_id, 'string')) {
    return 'session_id';
  }
  if (!isOptional(hello.project_dir, 'string')) {
    return 'project_dir';
  }
  if (!isOptional(hello.harness, 'string')) {
    return 'harness';
  }
  if (!isOptional(hello.config_dir, 'string')) {
    return 'config_dir';
  }
  if (!isOptional(hello.row_id, 'string')) {
    return 'row_id';
  }
  return null;
}

// The hello fields sessions reads; every other is the host's own.
const SESSIONS_HELLO_FIELDS: ReadonlySet<string> = new Set([
  'protocol',
  'session_id',
  'project_dir',
  'harness',
  'config_dir',
  'row_id',
]);

function sessionInfo(hello: RelayHello): SessionInfo {
  const info: SessionInfo = {
    sessionId: hello.session_id ?? null,
    projectDir: hello.project_dir ?? null,
    harness: hello.harness ?? null,
    rowId: hello.row_id ?? null,
    profileDir: hello.config_dir ?? undefined,
  };
  const hostFields = Object.entries(hello).filter(
    ([field]) => !SESSIONS_HELLO_FIELDS.has(field),
  );
  return hostFields.length === 0
    ? info
    : { ...info, host: Object.fromEntries(hostFields) };
}

function replyLine(reply: RelayHelloReply): string {
  return jsonLine(reply);
}

function refuse(socket: Socket, error: string, deps: RelayServerDeps) {
  deps.log(`refused a relay: ${error}`);
  socket.end(replyLine({ ok: false, error }));
}

// The session opens before the reply, so a hello the app cannot serve is
// refused rather than answered ok over a session that never started.
function startSession(
  socket: Socket,
  hello: RelayHello,
  deps: RelayServerDeps,
) {
  let session: ConnectedSession;
  try {
    session = deps.connect(sessionInfo(hello));
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

// Waits for `deps.ready`, then starts the session unless the relay left. The
// socket keeps flowing into a buffer during the wait, since a paused socket
// raises no `end` or `close` when the relay exits.
async function startSessionOnceReady(
  socket: Socket,
  hello: RelayHello,
  deps: RelayServerDeps,
) {
  let hasLeft = false;
  const markLeft = () => {
    hasLeft = true;
  };
  const received: Buffer[] = [];
  const keepChunk = (chunk: Buffer) => received.push(chunk);
  socket.once('end', markLeft);
  socket.once('close', markLeft);
  socket.on('data', keepChunk);
  socket.resume();
  await deps.ready();
  socket.off('end', markLeft);
  socket.off('close', markLeft);
  socket.off('data', keepChunk);
  if (hasLeft || socket.destroyed) {
    deps.log('a relay left while its connect was held');
    return;
  }
  socket.pause();
  if (received.length > 0) {
    socket.unshift(Buffer.concat(received));
  }
  startSession(socket, hello, deps);
}

// Reads the hello line and refuses a bad one at once; a good one waits for
// `deps.ready`, then the socket is handed on paused, with the bytes that followed
// the newline put back in front.
function acceptConnection(socket: Socket, deps: RelayServerDeps) {
  socket.on('error', (error) =>
    deps.log(`a relay connection failed: ${error.message}`),
  );
  readFirstLine(socket, (line) => {
    const parsed = parseHello(line);
    if ('error' in parsed) {
      refuse(socket, parsed.error, deps);
      return;
    }
    void startSessionOnceReady(socket, parsed.hello, deps);
  });
}

// Listens for relay.py connections on the channel, one connected session each.
export function startRelayServer(deps: RelayServerDeps): {
  close(): Promise<void>;
} {
  return listenOnChannel(deps.channel, {
    connected: (socket) => acceptConnection(socket, deps),
    failed: (error) =>
      deps.log(`channel ${deps.channel} failed: ${error.message}`),
  });
}
