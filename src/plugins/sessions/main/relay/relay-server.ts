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
  HOOK_PROTOCOL,
  type HookReply,
  RELAY_PROTOCOL,
  type RelayHello,
  type RelayHelloReply,
  type SessionInfo,
} from '../../contract';

// How long a hook hello waits for its request line, and then for its handler.
export const HOOK_REQUEST_TIMEOUT_MS = 5_000;

// Serves MCP for one session; `input` arrives paused, holding any bytes the
// relay sent after its hello, and `serve` resumes it.
export type ServeSession = (
  streams: { input: Readable; output: Writable },
  session: ConnectedSession,
) => { close(): Promise<void> };

// `connect` opens the app's session for each relay that said a good hello, once
// `ready` resolves; `ready` never rejects. `hook` answers each hook hello's
// request, waiting on neither and never rejecting; `hookTimeoutMs` bounds the
// wait for the request line and for `hook`'s answer, HOOK_REQUEST_TIMEOUT_MS
// when absent.
export interface RelayServerDeps {
  channel: string;
  ready(): Promise<void>;
  connect(info: SessionInfo): ConnectedSession;
  serve: ServeSession;
  hook(name: string, info: SessionInfo, request: unknown): Promise<HookReply>;
  hookTimeoutMs?: number;
  log: PluginLog;
}

function parseHello(line: string): { hello: RelayHello } | { error: string } {
  let hello: RelayHello | null;
  try {
    hello = JSON.parse(line) as RelayHello | null;
  } catch {
    return { error: 'the first line was not a relay hello' };
  }
  if (hello?.protocol !== RELAY_PROTOCOL && hello?.protocol !== HOOK_PROTOCOL) {
    return {
      error: `relay protocol ${hello?.protocol}, app protocol ${RELAY_PROTOCOL}`,
    };
  }
  const badField = mistypedHelloField(hello);
  if (badField !== null) {
    return { error: `relay hello field ${badField} has the wrong type` };
  }
  const isHook = typeof hello.hook === 'string';
  if (isHook !== (hello.protocol === HOOK_PROTOCOL)) {
    return {
      error: isHook
        ? `a hook hello takes hook protocol ${HOOK_PROTOCOL}`
        : `hook protocol ${HOOK_PROTOCOL} takes a hook name`,
    };
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
  if (!isOptional(hello.hook, 'string')) {
    return 'hook';
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
  'hook',
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

function parseHookRequest(
  line: string,
): { request: unknown } | { error: string } {
  try {
    return { request: JSON.parse(line) as unknown };
  } catch {
    return { error: 'the hook request was not JSON' };
  }
}

// Writes the one reply line and ends the socket, unless the client already
// left or the socket already ended.
function endWithHookReply(socket: Socket, reply: HookReply) {
  if (socket.destroyed || socket.writableEnded) {
    return;
  }
  socket.end(jsonLine(reply));
}

// The handler's answer, or a refusal once `limit` ms pass first; the timer is
// cleared when the handler settles first.
async function hookReplyWithin(
  answering: Promise<HookReply>,
  limit: number,
  refused: (error: string) => void,
): Promise<HookReply> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<HookReply>((resolve) => {
    timer = setTimeout(() => {
      const error = `hook handler did not answer within ${limit} ms`;
      refused(error);
      resolve({ ok: false, error });
    }, limit);
  });
  try {
    return await Promise.race([answering, late]);
  } finally {
    clearTimeout(timer);
  }
}

// A hook hello: reads one request line, answers it with one `HookReply` line
// and ends the socket, waiting on no connect hold and opening no session. The
// request line and the handler each get the hook timeout; the line's timer
// runs from the hello, so bytes with no newline do not reset it.
function answerHook(
  socket: Socket,
  name: string,
  hello: RelayHello,
  deps: RelayServerDeps,
) {
  const limit = deps.hookTimeoutMs ?? HOOK_REQUEST_TIMEOUT_MS;
  const logRefusal = (error: string) =>
    deps.log(`refused hook ${name}: ${error}`);
  const refuseHook = (error: string) => {
    logRefusal(error);
    endWithHookReply(socket, { ok: false, error });
  };
  let hasTimedOut = false;
  const lineTimer = setTimeout(() => {
    hasTimedOut = true;
    refuseHook(`no hook request line within ${limit} ms`);
  }, limit);
  socket.once('close', () => clearTimeout(lineTimer));
  readFirstLine(socket, (line) => {
    // A paused socket never reads the client's end, so a client that left
    // would go unseen; flowing, it drops any later bytes.
    socket.resume();
    if (hasTimedOut) {
      return;
    }
    clearTimeout(lineTimer);
    const parsed = parseHookRequest(line);
    if ('error' in parsed) {
      refuseHook(parsed.error);
      return;
    }
    void hookReplyWithin(
      deps.hook(name, sessionInfo(hello), parsed.request),
      limit,
      logRefusal,
    ).then((reply) => endWithHookReply(socket, reply));
  });
  socket.resume();
}

// Reads the hello line and refuses a bad one at once; a hook hello is answered
// at once, and any other good one waits for `deps.ready`, then the socket is
// handed on paused, with the bytes that followed the newline put back in front.
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
    const { hello } = parsed;
    if (typeof hello.hook === 'string') {
      answerHook(socket, hello.hook, hello, deps);
      return;
    }
    void startSessionOnceReady(socket, hello, deps);
  });
}

// Listens for relay.py connections on the channel, one connected session each,
// and for hook calls, each answered with one line and closed.
export function startRelayServer(deps: RelayServerDeps): {
  close(): Promise<void>;
} {
  return listenOnChannel(deps.channel, {
    connected: (socket) => acceptConnection(socket, deps),
    failed: (error) =>
      deps.log(`channel ${deps.channel} failed: ${error.message}`),
  });
}
