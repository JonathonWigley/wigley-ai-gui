import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { Socket } from 'node:net';
import path from 'node:path';
import type { Clock, Timers } from '../contracts/ambient';
import {
  type ClientMessage,
  type HelloMessage,
  type HostMessage,
  HOST_LOGS_FOLDER,
  hostRecordFile,
  hostRecordProtocol,
  pipeLogFile,
  SESSION_HOST_PROTOCOL,
  type SessionHostRecord,
} from '../contracts/session-host-protocol';
import { jsonLine, readLines } from '../shared/local-channel/line-framing';
import {
  connectFoundNoListener,
  connectToChannel,
  listenOnChannel,
} from '../shared/local-channel/local-channel';
import { createDiagnosticLog, type DiagnosticLog } from './diagnostic-log';
import type { HostChildren } from './host-children';
import {
  createProcessTable,
  type HostSpawn,
  type ProcessSubscriber,
  type ProcessTable,
} from './process-table';
import { replaceFile } from './replace-file';

const HELLO_WAIT_MS = 2000;
const FIRST_CLIENT_WAIT_MS = 30_000;

const CLIENT_MESSAGE_TYPES: ReadonlySet<unknown> = new Set<
  ClientMessage['type']
>([
  'hello',
  'list',
  'drain',
  'spawn',
  'write',
  'endInput',
  'kill',
  'subscribe',
  'unsubscribe',
  'setKeepIdle',
  'stopAll',
]);
// Another host's probe or an older-host check sends only these, and never counts as a client.
// Frozen with the messages it names, since an app drains or lists any older host.
const NON_CLIENT_MESSAGE_TYPES: ReadonlySet<ClientMessage['type']> = new Set([
  'hello',
  'list',
  'drain',
]);
// Answered while a new host ends what the last one left. The rest wait, in order: each may act on a process whose
// `spawn` is waiting, and a `drain` or `stopAll` must see it. The table is empty, so these answer truly.
const SERVED_WHILE_ENDING_LEFTOVERS: ReadonlySet<ClientMessage['type']> =
  new Set(['hello', 'list', 'subscribe', 'setKeepIdle']);

export interface SessionHostDeps {
  folder: string;
  channel: string;
  pid: number;
  children: HostChildren;
  clock: Clock;
  timers: Timers;
  exit(code: number): void;
}

function clientMessageOf(line: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(line) as ClientMessage | null;
    return CLIENT_MESSAGE_TYPES.has(parsed?.type) ? parsed : null;
  } catch {
    return null;
  }
}

function helloReplyProtocol(line: string): number | null {
  try {
    const parsed = JSON.parse(line) as { protocol?: unknown } | null;
    return typeof parsed?.protocol === 'number' ? parsed.protocol : null;
  } catch {
    return null;
  }
}

// What a `hello` on a channel found: the protocol that answered; `none` when the connect proved no listener; `silent`
// when one is possible, since the connect failed some other way or no protocol came within `HELLO_WAIT_MS`.
function askHello(
  channel: string,
  timers: Timers,
): Promise<number | 'none' | 'silent'> {
  return new Promise((resolve) => {
    let socket: Socket | null = null;
    let settled = false;
    const settle = (answer: number | 'none' | 'silent') => {
      if (settled) {
        return;
      }
      settled = true;
      timers.clear(timer);
      socket?.destroy();
      resolve(answer);
    };
    const timer = timers.set(() => settle('silent'), HELLO_WAIT_MS);
    connectToChannel(channel).then(
      (connected) => {
        if (settled) {
          connected.destroy();
          return;
        }
        socket = connected;
        connected.on('error', () => settle('silent'));
        connected.on('close', () => settle('silent'));
        readLines(connected, (line) =>
          settle(helloReplyProtocol(line) ?? 'silent'),
        );
        const hello: HelloMessage = { type: 'hello', requestId: 1 };
        connected.write(jsonLine(hello));
      },
      (error: unknown) =>
        settle(connectFoundNoListener(error) ? 'none' : 'silent'),
    );
  });
}

function writeRecord(folder: string, record: SessionHostRecord) {
  replaceFile(
    path.join(folder, hostRecordFile(record.protocol)),
    JSON.stringify(record),
  );
}

function recordedChannel(file: string): string | null {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as SessionHostRecord)
      .channel;
  } catch {
    return null;
  }
}

async function anotherHostMayListen(
  folder: string,
  timers: Timers,
): Promise<boolean> {
  const otherRecords = readdirSync(folder).filter((name) => {
    const protocol = hostRecordProtocol(name);
    return protocol !== null && protocol !== SESSION_HOST_PROTOCOL;
  });
  for (const name of otherRecords) {
    const channel = recordedChannel(path.join(folder, name));
    if (channel !== null && (await askHello(channel, timers)) !== 'none') {
      return true;
    }
  }
  return false;
}

async function sweepLogs(
  folder: string,
  snapshot: readonly string[],
  table: ProcessTable,
  timers: Timers,
) {
  if (await anotherHostMayListen(folder, timers)) {
    return;
  }
  const heldNames = new Set(table.list().map(({ id }) => pipeLogFile(id)));
  for (const name of snapshot) {
    if (!heldNames.has(name)) {
      rmSync(path.join(folder, HOST_LOGS_FOLDER, name), { force: true });
    }
  }
}

interface ConnectionsDeps {
  spawn: HostSpawn;
  clock: Clock;
  timers: Timers;
  logsFolder: string;
  diagnostics: DiagnosticLog;
  shutDown(): void;
}

// The wire protocol over every connection, and the exit rule, which turns on who is connected.
function createConnections(deps: ConnectionsDeps) {
  const { diagnostics } = deps;
  const clients = new Set<Socket>();
  let draining = false;
  let isEndingLeftovers = true;
  let exitRuleWaits = false;
  const heldMessages: (() => void)[] = [];
  const table = createProcessTable({
    spawn: deps.spawn,
    clock: deps.clock,
    timers: deps.timers,
    logsFolder: deps.logsFolder,
    diagnostics,
    processClosed: () => checkExitRule(),
  });

  function checkExitRule() {
    if (isEndingLeftovers) {
      exitRuleWaits = true;
      return;
    }
    const holdsNoProcess = table.list().length === 0;
    if (holdsNoProcess && (draining || clients.size === 0)) {
      deps.shutDown();
    }
  }

  function serveHeldMessages() {
    isEndingLeftovers = false;
    for (const serve of heldMessages.splice(0)) {
      serve();
    }
    if (exitRuleWaits) {
      checkExitRule();
    }
  }

  function markClient(socket: Socket) {
    clients.add(socket);
    if (clients.size === 1) {
      table.setClientConnected(true);
    }
  }

  function disconnected(socket: Socket, subscriber: ProcessSubscriber) {
    table.dropSubscriber(subscriber);
    if (!clients.delete(socket)) {
      return;
    }
    if (clients.size === 0) {
      table.setClientConnected(false);
    }
    checkExitRule();
  }

  function handleMessage(
    message: ClientMessage,
    subscriber: ProcessSubscriber,
    push: (message: HostMessage) => void,
  ) {
    switch (message.type) {
      case 'hello':
        push({
          type: 'hello',
          requestId: message.requestId,
          protocol: SESSION_HOST_PROTOCOL,
        });
        break;
      case 'list':
        push({
          type: 'list',
          requestId: message.requestId,
          processes: table.list(),
        });
        break;
      case 'drain':
        draining = true;
        table.drain();
        checkExitRule();
        break;
      case 'spawn':
        table.spawn(message.request, subscriber);
        break;
      case 'write':
        table.write(message.id, message.text);
        break;
      case 'endInput':
        table.endInput(message.id);
        break;
      case 'kill':
        table.kill(message.id, message.signal);
        break;
      case 'subscribe':
        push({
          type: 'subscribe',
          requestId: message.requestId,
          id: message.id,
          ...table.subscribe(message.id, subscriber),
        });
        break;
      case 'unsubscribe':
        table.unsubscribe(message.id, subscriber);
        break;
      case 'setKeepIdle':
        table.setKeepIdleMinutes(message.minutes);
        break;
      case 'stopAll':
        table.stopAll(() =>
          push({ type: 'stopAll', requestId: message.requestId }),
        );
        break;
    }
  }

  function connected(socket: Socket) {
    const push = (message: HostMessage) => {
      if (!socket.destroyed && socket.writable) {
        socket.write(jsonLine(message));
      }
    };
    const subscriber: ProcessSubscriber = {
      line: (id, line) => push({ type: 'line', id, line }),
      closed: (id, exit) => push({ type: 'closed', id, exit }),
    };
    socket.on('error', (error) =>
      diagnostics.append(`connection: ${error.message}`),
    );
    socket.on('close', () => disconnected(socket, subscriber));
    readLines(socket, (line) => {
      const message = clientMessageOf(line);
      if (message === null) {
        diagnostics.append(`ignored line: ${line}`);
        return;
      }
      if (!NON_CLIENT_MESSAGE_TYPES.has(message.type)) {
        markClient(socket);
      }
      const serve = () => {
        // A known type can still carry bad fields, and a throw here would end the host and every session.
        try {
          handleMessage(message, subscriber, push);
        } catch (error) {
          diagnostics.append(
            `message ${message.type}: ${(error as Error).message}`,
          );
        }
      };
      if (
        isEndingLeftovers &&
        !SERVED_WHILE_ENDING_LEFTOVERS.has(message.type)
      ) {
        heldMessages.push(serve);
      } else {
        serve();
      }
    });
  }

  return { connected, checkExitRule, serveHeldMessages, table };
}

// Runs the start steps. A host that finds the channel owned, or cannot listen, calls `deps.exit` and is done;
// one that owns the channel ends what the last host left before it serves a `spawn`, and serves until the exit rule
// calls `deps.exit`. Resolves once the log sweep has finished.
export async function startSessionHost(deps: SessionHostDeps): Promise<void> {
  const { folder, channel, clock, timers } = deps;
  const logsFolder = path.join(folder, HOST_LOGS_FOLDER);
  mkdirSync(logsFolder, { recursive: true });

  if ((await askHello(channel, timers)) === SESSION_HOST_PROTOCOL) {
    deps.exit(0);
    return;
  }
  const snapshot = readdirSync(logsFolder);

  const diagnostics = createDiagnosticLog(folder, clock);
  let shuttingDown = false;
  const connections = createConnections({
    spawn: deps.children.spawn,
    clock,
    timers,
    logsFolder,
    diagnostics,
    shutDown() {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      void server.close().then(() => {
        rmSync(path.join(folder, hostRecordFile(SESSION_HOST_PROTOCOL)), {
          force: true,
        });
        deps.exit(0);
      });
    },
  });
  let ownsChannel = false;
  let listenError: NodeJS.ErrnoException | null = null;
  const server = listenOnChannel(channel, {
    connected: connections.connected,
    failed(error) {
      if (ownsChannel) {
        diagnostics.append(`channel: ${error.message}`);
      } else {
        listenError = error;
      }
    },
  });
  if (!(await server.listening)) {
    const failure = listenError as NodeJS.ErrnoException | null;
    if (failure?.code === 'EADDRINUSE') {
      deps.exit(0);
    } else {
      diagnostics.append(`listen: ${failure?.message}`);
      deps.exit(1);
    }
    return;
  }

  ownsChannel = true;
  diagnostics.setAsidePrevious();
  writeRecord(folder, {
    protocol: SESSION_HOST_PROTOCOL,
    channel,
    pid: deps.pid,
  });
  timers.set(connections.checkExitRule, FIRST_CLIENT_WAIT_MS);
  await deps.children.endLeftovers();
  connections.serveHeldMessages();
  await sweepLogs(folder, snapshot, connections.table, timers).catch(
    (error: Error) => diagnostics.append(`log sweep: ${error.message}`),
  );
}
