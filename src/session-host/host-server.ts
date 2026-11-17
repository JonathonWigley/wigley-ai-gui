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
import { createPendingQueue } from './pending-queue';
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
  'setPending',
  'listRuns',
  'forgetRuns',
]);
// Another host's probe or an older-host check sends only these, and never counts as a client.
// Frozen with the messages it names, since an app drains or lists any older host.
const NON_CLIENT_MESSAGE_TYPES: ReadonlySet<ClientMessage['type']> = new Set([
  'hello',
  'list',
  'drain',
]);
// Answered while a new host ends what the last one left. The rest wait, in order: each may act on a process whose
// `spawn` is waiting, and a `drain` or `stopAll` must see it. `list` answers empty even with a `spawn` waiting, so a
// relaunch inside this hold can rest a row beside a process about to start. `listRuns` and `forgetRuns` answer from
// the loaded runs record, since the client's reply limit is shorter than the hold.
const SERVED_WHILE_ENDING_LEFTOVERS: ReadonlySet<ClientMessage['type']> =
  new Set([
    'hello',
    'list',
    'subscribe',
    'setKeepIdle',
    'listRuns',
    'forgetRuns',
  ]);

export interface SessionHostDeps {
  folder: string;
  channel: string;
  pid: number;
  children: HostChildren;
  // The host's own environment, which a prepared run's child inherits under its overlay.
  env: NodeJS.ProcessEnv;
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

function readRecord(file: string): SessionHostRecord | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SessionHostRecord | null;
  } catch {
    return null;
  }
}

// A record another host wrote since, or one that cannot be read, stays.
function removeOwnRecord(folder: string, pid: number) {
  const file = path.join(folder, hostRecordFile(SESSION_HOST_PROTOCOL));
  if (readRecord(file)?.pid === pid) {
    rmSync(file, { force: true });
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
    const channel = readRecord(path.join(folder, name))?.channel ?? null;
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

function sendTo(socket: Socket, message: HostMessage) {
  if (!socket.destroyed && socket.writable) {
    socket.write(jsonLine(message));
  }
}

interface ConnectionsDeps {
  folder: string;
  spawn: HostSpawn;
  env: NodeJS.ProcessEnv;
  clock: Clock;
  timers: Timers;
  logsFolder: string;
  diagnostics: DiagnosticLog;
  shutDown(): void;
}

// The wire protocol over every connection, the pending queue, and the exit rule, which turns on who is connected.
function createConnections(deps: ConnectionsDeps) {
  const { diagnostics } = deps;
  const clients = new Set<Socket>();
  let draining = false;
  let isEndingLeftovers = true;
  let exitRuleWaits = false;
  const heldMessages: (() => void)[] = [];
  const table = createProcessTable({
    spawn: deps.spawn,
    env: deps.env,
    clock: deps.clock,
    timers: deps.timers,
    logsFolder: deps.logsFolder,
    diagnostics,
    // The queue's own subscriber is replaced once an app attaches, so it hears every close here too.
    processClosed: (id, exit) => {
      queue.processClosed(id, exit);
      checkExitRule();
    },
  });
  const queue = createPendingQueue({
    folder: deps.folder,
    clock: deps.clock,
    timers: deps.timers,
    diagnostics,
    spawn: (request, subscriber) => table.spawn(request, subscriber),
    isBusy: (id) => table.isBusy(id),
    runStarted(run) {
      for (const socket of clients) {
        sendTo(socket, { type: 'runStarted', run });
      }
    },
  });

  function checkExitRule() {
    if (isEndingLeftovers) {
      exitRuleWaits = true;
      return;
    }
    const holdsNothing = table.list().length === 0 && queue.isEmpty();
    const hasNoClientToServe = draining || clients.size === 0;
    if (holdsNothing && hasNoClientToServe) {
      deps.shutDown();
    }
  }

  // A held `setPending` is newer than the loaded pending file, so the queue starts only after it is served.
  function serveHeldMessages() {
    isEndingLeftovers = false;
    for (const serve of heldMessages.splice(0)) {
      serve();
    }
    queue.start();
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
        queue.drop();
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
      case 'setPending':
        queue.setPending(message.entries);
        checkExitRule();
        break;
      case 'listRuns':
        queue.importOlder();
        push({
          type: 'listRuns',
          requestId: message.requestId,
          runs: queue.runs(),
        });
        break;
      case 'forgetRuns':
        queue.forgetRuns(message.ids);
        checkExitRule();
        break;
    }
  }

  function connected(socket: Socket) {
    const push = (message: HostMessage) => sendTo(socket, message);
    const subscriber: ProcessSubscriber = {
      line: (id, line) => push({ type: 'line', id, line }),
      closed: (id, exit) => push({ type: 'closed', id, exit }),
      spawned: (id, pid) => push({ type: 'spawned', id, pid }),
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

  return { connected, checkExitRule, serveHeldMessages, table, queue };
}

// Runs the start steps. A host that finds the channel owned or its lock held, or cannot listen, calls `deps.exit` and
// is done; one that owns the channel loads its pending queue, ends what the last host left before it serves a `spawn`
// or starts a pending entry, and serves until the exit rule calls `deps.exit`. Resolves once the log sweep has finished.
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
    folder,
    spawn: deps.children.spawn,
    env: deps.env,
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
        removeOwnRecord(folder, deps.pid);
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
  // Listening holds the channel's lock, so no other host of this protocol runs to write this log or the swept logs.
  diagnostics.setAsidePrevious();
  writeRecord(folder, {
    protocol: SESSION_HOST_PROTOCOL,
    channel,
    pid: deps.pid,
  });
  connections.queue.load();
  timers.set(connections.checkExitRule, FIRST_CLIENT_WAIT_MS);
  await deps.children.endLeftovers();
  connections.serveHeldMessages();
  await sweepLogs(folder, snapshot, connections.table, timers).catch(
    (error: Error) => diagnostics.append(`log sweep: ${error.message}`),
  );
}
