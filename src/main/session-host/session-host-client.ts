import { readFile } from 'node:fs/promises';
import type { Clock, Timers } from '../../contracts/ambient';
import type { Log } from '../../contracts/log';
import type { ProcessRunner } from '../../contracts/processes';
import type {
  HostedExit,
  HostedProcess,
  HostedProcessEvents,
  HostedProcessInfo,
  HostedRun,
  PendingSpawn,
  PipeLine,
  SessionHost,
} from '../../contracts/session-host';
import {
  type ClientMessage,
  type ClosedEvent,
  HOST_END_GRACE_MS,
  type LineEvent,
  type PipeLogRecord,
  SESSION_HOST_PROTOCOL,
  type SpawnedEvent,
  type TermAttachReply,
  type TermClosedEvent,
  type TermDataEvent,
} from '../../contracts/session-host-protocol';
import type {
  TerminalAttach,
  TerminalEvents,
  TerminalExit,
  TerminalHost,
  TerminalInfo,
  TerminalProcess,
} from '../../contracts/terminals';
import { errorText } from '../../shared/error-text';
import {
  HOST_REPLY_LIMIT_MS,
  type HostAnswer,
  type HostLink,
  LOG_SOURCE,
  openHostLink,
} from './host-link';
import { createOtherHosts } from './other-hosts';

const HOST_POLL_MS = 100;
const HOST_START_LIMIT_MS = 10_000;
// The host's own starting value.
const DEFAULT_KEEP_IDLE_MINUTES = 60;
// SIGTERM, the grace to SIGKILL, the grace from an exit to destroying held pipes, and a margin for the reply.
const STOP_ALL_REPLY_LIMIT_MS = 2 * HOST_END_GRACE_MS + 2000;
// The `closed` error of every process and shell open when the host's connection drops.
const HOST_EXITED = 'the session host exited';

export interface SessionHostClientDeps {
  folder: string; // <app instance user data>/session-host
  channel: string; // sessionHostChannel(...)
  hostScript: string; // the built session-host.js
  execPath: string; // process.execPath
  processes: Pick<ProcessRunner, 'startDetached'>; // starts the host in the app's environment
  clock: Clock;
  timers: Timers;
  log: Log;
}

// The session host client: the hosted processes, and the shells as `terminals`.
export interface SessionHostClient extends SessionHost {
  readonly terminals: TerminalHost;
}

// A message the host pushes for one process.
type PushedEvent = LineEvent | ClosedEvent | SpawnedEvent;

// One events object a `spawn` or an `attach` was given.
interface Subscriber {
  events: HostedProcessEvents;
  // True for the events a `spawn` was given: only they hear `spawned`.
  fromSpawn: boolean;
  // The highest seq read from the log or delivered; lines at or below it are dropped.
  lastSeq: number;
  // Pushed messages held back while an attach reads the log, until its flush. Null once they flow live.
  buffer: PushedEvent[] | null;
  // True until the attach it belongs to has resolved.
  attaching: boolean;
  detached: boolean;
}

// One process id this client holds. Every `HostedProcess` of the id shares it.
interface ProcessEntry {
  id: string;
  ended: boolean; // closed, or its host is gone
  subscriber: Subscriber | null; // the one live events object
  pid: number | null; // the OS pid once the host reports it; null once ended
}

interface ConnectAttempt {
  ended: boolean;
  wake: (() => void) | null; // ends the wait for the next poll
  // True for the client's first attempt: only its connect tells no `onConnected` listener, since no call was
  // refused before it.
  isFirst: boolean;
}

// Called with the link once connected; with null and the reason when the attempt failed.
type ConnectedRun = (link: HostLink | null, failure: string) => void;

function endEntry(processes: Map<string, ProcessEntry>, entry: ProcessEntry) {
  entry.ended = true;
  entry.pid = null;
  if (processes.get(entry.id) === entry) {
    processes.delete(entry.id);
  }
}

// Gives `message` to `subscriber` while it is still the live events object of the entry.
function deliver(
  processes: Map<string, ProcessEntry>,
  entry: ProcessEntry,
  subscriber: Subscriber,
  message: PushedEvent,
) {
  if (entry.subscriber !== subscriber) {
    return;
  }
  if (message.type === 'line') {
    if (message.line.seq > subscriber.lastSeq) {
      subscriber.lastSeq = message.line.seq;
      subscriber.events.line(message.line);
    }
    return;
  }
  if (message.type === 'spawned') {
    entry.pid = message.pid;
    if (subscriber.fromSpawn) {
      subscriber.events.spawned(message.pid);
    }
    return;
  }
  entry.subscriber = null;
  endEntry(processes, entry);
  subscriber.events.closed(message.exit);
}

function flushBuffer(
  processes: Map<string, ProcessEntry>,
  entry: ProcessEntry,
  subscriber: Subscriber,
) {
  const buffered = subscriber.buffer ?? [];
  subscriber.buffer = null;
  for (const message of buffered) {
    deliver(processes, entry, subscriber, message);
  }
}

// A message the host pushes for one shell.
type TerminalPush = TermDataEvent | TermClosedEvent;

// One events object a terminal `spawn` or `attach` was given.
interface TerminalSubscriber {
  events: TerminalEvents;
  detached: boolean;
  // The `termAttach` request that made it; null for a `spawn`'s.
  attachRequestId: number | null;
  // False until the host's attach reply has come; a push before it is output the reply's replay holds.
  replied: boolean;
  // Pushes held back from the attach reply until its flush. Null once they flow live.
  buffer: TerminalPush[] | null;
}

// One shell id this client holds. Every `TerminalProcess` of the id shares it.
interface TerminalEntry {
  id: string;
  ended: boolean; // closed, or its host is gone
  subscriber: TerminalSubscriber | null; // the one live events object
}

interface TerminalClientDeps {
  timers: Timers;
  whenConnected: (run: ConnectedRun) => void;
}

// The shells side of the client: its `TerminalHost`, and what its links and a host death call.
interface TerminalClient {
  host: TerminalHost;
  pushed: (message: TerminalPush) => void;
  attachReceived: (reply: TermAttachReply) => void;
  hostDied: () => void;
}

function terminalSubscriber(
  events: TerminalEvents,
  fromSpawn: boolean,
): TerminalSubscriber {
  return {
    events,
    detached: false,
    attachRequestId: null,
    replied: fromSpawn,
    buffer: null,
  };
}

function endTerminalEntry(
  terminals: Map<string, TerminalEntry>,
  entry: TerminalEntry,
) {
  entry.ended = true;
  if (terminals.get(entry.id) === entry) {
    terminals.delete(entry.id);
  }
}

// Gives `message` to `subscriber` while it is still the live events object of the entry.
function deliverToTerminal(
  terminals: Map<string, TerminalEntry>,
  entry: TerminalEntry,
  subscriber: TerminalSubscriber,
  message: TerminalPush,
) {
  if (entry.subscriber !== subscriber) {
    return;
  }
  if (message.type === 'termData') {
    subscriber.events.data(message.data);
    return;
  }
  entry.subscriber = null;
  endTerminalEntry(terminals, entry);
  subscriber.events.closed(message.exit);
}

// Buffers `message` while the subscriber's attach flush is ahead; else delivers it.
function holdOrDeliverToTerminal(
  terminals: Map<string, TerminalEntry>,
  entry: TerminalEntry,
  subscriber: TerminalSubscriber,
  message: TerminalPush,
) {
  if (subscriber.buffer !== null) {
    subscriber.buffer.push(message);
  } else {
    deliverToTerminal(terminals, entry, subscriber, message);
  }
}

function flushTerminalBuffer(
  terminals: Map<string, TerminalEntry>,
  entry: TerminalEntry,
  subscriber: TerminalSubscriber,
) {
  const buffered = subscriber.buffer ?? [];
  subscriber.buffer = null;
  for (const message of buffered) {
    deliverToTerminal(terminals, entry, subscriber, message);
  }
}

function createTerminalClient(deps: TerminalClientDeps): TerminalClient {
  const { timers, whenConnected } = deps;
  const terminals = new Map<string, TerminalEntry>();

  const sendWhenConnected = (message: ClientMessage) => {
    whenConnected((link) => link?.send(message));
  };

  const subscribe = (id: string, subscriber: TerminalSubscriber) => {
    const entry = terminals.get(id) ?? { id, ended: false, subscriber: null };
    terminals.set(id, entry);
    entry.subscriber = subscriber;
    return entry;
  };

  const terminalProcess = (
    entry: TerminalEntry,
    subscriber: TerminalSubscriber,
  ): TerminalProcess => {
    const { id } = entry;
    const sendWhileActive = (message: ClientMessage) => {
      if (!entry.ended && !subscriber.detached) {
        sendWhenConnected(message);
      }
    };
    return {
      id,
      write: (data) => sendWhileActive({ type: 'termWrite', id, data }),
      resize: (cols, rows) =>
        sendWhileActive({ type: 'termResize', id, cols, rows }),
      kill: () => sendWhileActive({ type: 'termKill', id }),
      detach() {
        if (entry.subscriber === subscriber) {
          sendWhileActive({ type: 'termDetach', id });
          entry.subscriber = null;
        }
        subscriber.detached = true;
      },
    };
  };

  // Live output starts in a timer after the resolve, so the caller writes `replay` before any live chunk.
  const attachOver = async (
    link: HostLink,
    entry: TerminalEntry,
    subscriber: TerminalSubscriber,
  ): Promise<TerminalAttach | null> => {
    const { id } = entry;
    const reply = await link.request((requestId) => {
      subscriber.attachRequestId = requestId;
      return { type: 'termAttach', requestId, id };
    }, HOST_REPLY_LIMIT_MS);
    const isLive = entry.subscriber === subscriber;
    if (reply?.type !== 'termAttach') {
      if (isLive) {
        link.send({ type: 'termDetach', id });
        entry.subscriber = null;
      }
      throw new Error(
        `the session host did not answer the attach of terminal ${id}`,
      );
    }
    if (reply.terminal === null) {
      if (isLive) {
        entry.subscriber = null;
        endTerminalEntry(terminals, entry);
      }
      return null;
    }
    timers.set(() => flushTerminalBuffer(terminals, entry, subscriber), 0);
    return {
      process: terminalProcess(entry, subscriber),
      replay: reply.terminal.replay,
    };
  };

  const listOver = async (link: HostLink): Promise<TerminalInfo[]> => {
    const reply = await link.request(
      (requestId) => ({ type: 'termList', requestId }),
      HOST_REPLY_LIMIT_MS,
    );
    if (reply?.type !== 'termList') {
      throw new Error('the session host did not answer its terminal list');
    }
    return reply.terminals;
  };

  const host: TerminalHost = {
    spawn(request, events) {
      if (terminals.get(request.id)?.subscriber) {
        queueMicrotask(() =>
          events.closed({
            code: null,
            signal: null,
            error: `a terminal with id ${request.id} already exists`,
          }),
        );
        return terminalProcess(
          { id: request.id, ended: true, subscriber: null },
          { ...terminalSubscriber(events, true), detached: true },
        );
      }
      const subscriber = terminalSubscriber(events, true);
      const entry = subscribe(request.id, subscriber);
      whenConnected((link, failure) => {
        if (link !== null) {
          link.send({ type: 'termSpawn', request });
          return;
        }
        deliverToTerminal(terminals, entry, subscriber, {
          type: 'termClosed',
          id: request.id,
          exit: {
            code: null,
            signal: null,
            error: `the session host did not start: ${failure}`,
          },
        });
      });
      return terminalProcess(entry, subscriber);
    },
    attach(id, events) {
      const subscriber = terminalSubscriber(events, false);
      const entry = subscribe(id, subscriber);
      return new Promise((resolve, reject) => {
        whenConnected((link, failure) => {
          if (link === null) {
            if (entry.subscriber === subscriber) {
              entry.subscriber = null;
            }
            reject(new Error(`the session host did not start: ${failure}`));
            return;
          }
          attachOver(link, entry, subscriber).then(resolve, reject);
        });
      });
    },
    list() {
      return new Promise((resolve, reject) => {
        whenConnected((link, failure) => {
          if (link === null) {
            reject(new Error(`the session host did not start: ${failure}`));
            return;
          }
          listOver(link).then(resolve, reject);
        });
      });
    },
  };

  return {
    host,
    pushed(message) {
      const entry = terminals.get(message.id);
      const subscriber = entry?.subscriber;
      if (entry === undefined || !subscriber?.replied) {
        return;
      }
      holdOrDeliverToTerminal(terminals, entry, subscriber, message);
    },
    attachReceived(reply) {
      const subscriber = terminals.get(reply.id)?.subscriber;
      const isThisSubscribersReply =
        subscriber?.attachRequestId === reply.requestId;
      if (!subscriber || !isThisSubscribersReply || reply.terminal === null) {
        return;
      }
      subscriber.replied = true;
      subscriber.buffer = [];
    },
    hostDied() {
      const exit: TerminalExit = {
        code: null,
        signal: null,
        error: HOST_EXITED,
      };
      const entries = [...terminals.values()];
      terminals.clear();
      for (const entry of entries) {
        entry.ended = true;
        const { subscriber } = entry;
        // An attach with no reply yet is left to its request, which the link's close settles.
        if (!subscriber?.replied) {
          continue;
        }
        holdOrDeliverToTerminal(terminals, entry, subscriber, {
          type: 'termClosed',
          id: entry.id,
          exit,
        });
      }
    },
  };
}

// The command that starts the session host the client would start: `execPath` with `hostScript`, `folder` and
// `channel` as its arguments, and `ELECTRON_RUN_AS_NODE` set to `1`.
export function sessionHostLaunch(
  deps: Pick<
    SessionHostClientDeps,
    'execPath' | 'hostScript' | 'folder' | 'channel'
  >,
): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: deps.execPath,
    args: [deps.hostScript, deps.folder, deps.channel],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

// Each `\n`-ended line; a last line with no newline is still being written.
async function readPipeLog(file: string): Promise<PipeLine[]> {
  const lines = (await readFile(file, 'utf8')).split('\n').slice(0, -1);
  return lines.map((line) => JSON.parse(line) as PipeLogRecord);
}

export function createSessionHostClient(
  deps: SessionHostClientDeps,
): SessionHostClient {
  const { timers } = deps;
  const processes = new Map<string, ProcessEntry>();
  const terminalClient = createTerminalClient({
    timers,
    whenConnected: (run) => whenConnected(run),
  });
  let current: HostLink | null = null;
  let attempt: ConnectAttempt | null = null;
  const waiting: ConnectedRun[] = [];
  // Runs that wait for `queueLink` to be the current link.
  const waitingForQueue: ConnectedRun[] = [];
  let keepIdleMinutes = DEFAULT_KEEP_IDLE_MINUTES;
  // The last `setPending` list, less each entry a `runStarted` or `forgetRuns` named; null until the first `setPending`.
  let pending: readonly PendingSpawn[] | null = null;
  // The link whose older hosts have served their drain and which got the pending list; `setPending` and `listRuns` go
  // straight to it.
  let queueLink: HostLink | null = null;
  let hasAttempted = false;
  const runStartedListeners = new Set<(run: HostedRun) => void>();
  const connectedListeners = new Set<() => void>();

  const pushed = (message: PushedEvent) => {
    const entry = processes.get(message.id);
    if (!entry?.subscriber) {
      return;
    }
    const { subscriber } = entry;
    if (subscriber.buffer !== null) {
      subscriber.buffer.push(message);
    } else {
      deliver(processes, entry, subscriber, message);
    }
  };

  const hostDied = () => {
    const exit: HostedExit = {
      code: null,
      signal: null,
      error: HOST_EXITED,
    };
    const entries = [...processes.values()];
    processes.clear();
    for (const entry of entries) {
      entry.ended = true;
      entry.pid = null;
      const subscriber = entry.subscriber;
      if (subscriber === null || subscriber.attaching) {
        continue;
      }
      if (subscriber.buffer !== null) {
        // The attach has resolved and its flush is still ahead: `closed` must stay behind the buffered lines.
        subscriber.buffer.push({ type: 'closed', id: entry.id, exit });
      } else {
        deliver(processes, entry, subscriber, {
          type: 'closed',
          id: entry.id,
          exit,
        });
      }
    }
    terminalClient.hostDied();
  };

  const dropPending = (ids: readonly string[]) => {
    if (pending !== null) {
      pending = pending.filter((entry) => !ids.includes(entry.spawn.id));
    }
  };

  const runStarted = (run: HostedRun) => {
    dropPending([run.id]);
    // A copy, so a listener added during the loop is not told this run.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...runStartedListeners]) {
      listener(run);
    }
  };

  const disconnected = (link: HostLink) => {
    if (current === link) {
      current = null;
      hostDied();
    }
  };

  const openHost = (channel: string): Promise<HostAnswer> =>
    openHostLink(channel, {
      timers,
      log: deps.log,
      pushed,
      terminalPushed: terminalClient.pushed,
      terminalAttachReceived: terminalClient.attachReceived,
      runStarted,
      disconnected,
    });

  const otherHosts = createOtherHosts({
    folder: deps.folder,
    open: openHost,
    log: deps.log,
  });

  const tryCurrentHost = async (): Promise<HostLink | null> => {
    const answer = await openHost(deps.channel);
    if (answer.kind !== 'answered') {
      return null;
    }
    if (answer.protocol !== SESSION_HOST_PROTOCOL) {
      answer.link.destroy();
      return null;
    }
    return answer.link;
  };

  const endAttempt = (started: ConnectAttempt) => {
    started.ended = true;
    started.wake?.();
    if (attempt === started) {
      attempt = null;
    }
  };

  // Empties `queued` before it runs any, so a run queued meanwhile waits for the next call.
  const runQueued = (
    queued: ConnectedRun[],
    link: HostLink | null,
    failure: string,
  ) => {
    for (const run of queued.splice(0)) {
      run(link, failure);
    }
  };

  const failAttempt = (started: ConnectAttempt, reason: string) => {
    endAttempt(started);
    deps.log(LOG_SOURCE, `the session host did not start: ${reason}`);
    runQueued(waiting, null, reason);
    runQueued(waitingForQueue, null, reason);
  };

  // The host's output is dropped; a host that starts and later exits is found by the next connect.
  const startHost = (started: ConnectAttempt) => {
    const launch = sessionHostLaunch(deps);
    deps.processes
      .startDetached(launch.command, launch.args, { setEnv: launch.env })
      .catch((error: unknown) => {
        if (started.ended) {
          deps.log(LOG_SOURCE, `host spawn error: ${errorText(error)}`);
        } else {
          failAttempt(started, errorText(error));
        }
      });
  };

  const waitForNextPoll = (started: ConnectAttempt) =>
    new Promise<void>((resolve) => {
      const handle = timers.set(() => {
        started.wake = null;
        resolve();
      }, HOST_POLL_MS);
      started.wake = () => {
        timers.clear(handle);
        resolve();
      };
    });

  // The pending list, `listRuns` and `onConnected` wait until each older host has served its drain, so no older host
  // fires a run once this host holds the queue, and no run is read before.
  const adopt = async (started: ConnectAttempt, link: HostLink) => {
    endAttempt(started);
    current = link;
    link.send({ type: 'setKeepIdle', minutes: keepIdleMinutes });
    runQueued(waiting, link, '');
    await otherHosts.drainOlder();
    if (current !== link) {
      // A newer link's own `adopt` serves the queued runs; a dropped link leaves them to a new connect.
      if (current === null && waitingForQueue.length > 0) {
        startConnecting();
      }
      return;
    }
    queueLink = link;
    if (pending !== null) {
      link.send({ type: 'setPending', entries: [...pending] });
    }
    runQueued(waitingForQueue, link, '');
    if (!started.isFirst) {
      // A copy, so a listener added during the loop is not told this connect.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const listener of [...connectedListeners]) {
        listener();
      }
    }
  };

  const runAttempt = async (started: ConnectAttempt) => {
    let link = await tryCurrentHost();
    if (link === null && !started.ended) {
      const spawnedAt = deps.clock.now();
      startHost(started);
      while (link === null && !started.ended) {
        await waitForNextPoll(started);
        if (started.ended) {
          break;
        }
        if (deps.clock.now() - spawnedAt >= HOST_START_LIMIT_MS) {
          failAttempt(started, `no answer in ${HOST_START_LIMIT_MS} ms`);
          break;
        }
        link = await tryCurrentHost();
      }
    }
    if (link === null) {
      return;
    }
    if (started.ended) {
      link.destroy();
      return;
    }
    await adopt(started, link);
  };

  const startConnecting = () => {
    if (attempt === null) {
      attempt = { ended: false, wake: null, isFirst: !hasAttempted };
      hasAttempted = true;
      void runAttempt(attempt);
    }
  };

  // Runs `run` at once when the state is settled; else keeps the order of calls until the attempt ends.
  const whenConnected = (run: ConnectedRun) => {
    if (current !== null) {
      run(current, '');
      return;
    }
    waiting.push(run);
    startConnecting();
  };

  // Runs `run` on `queueLink` while it is the current link; else once `adopt` has made it so, or the attempt failed.
  const whenQueueReady = (run: ConnectedRun) => {
    if (current !== null && current === queueLink) {
      run(current, '');
      return;
    }
    waitingForQueue.push(run);
    if (current === null) {
      startConnecting();
    }
  };

  const sendWhenConnected = (message: ClientMessage) => {
    whenConnected((link) => link?.send(message));
  };

  const subscribe = (
    id: string,
    events: HostedProcessEvents,
    attaching: boolean,
  ): { entry: ProcessEntry; subscriber: Subscriber } => {
    const subscriber: Subscriber = {
      events,
      fromSpawn: !attaching,
      lastSeq: 0,
      buffer: attaching ? [] : null,
      attaching,
      detached: false,
    };
    const entry = processes.get(id) ?? {
      id,
      ended: false,
      subscriber: null,
      pid: null,
    };
    processes.set(id, entry);
    entry.subscriber = subscriber;
    return { entry, subscriber };
  };

  const hostedProcess = (
    entry: ProcessEntry,
    subscriber: Subscriber,
  ): HostedProcess => {
    const { id } = entry;
    const isActive = () => !entry.ended && !subscriber.detached;
    const sendWhileActive = (message: ClientMessage) => {
      if (isActive()) {
        sendWhenConnected(message);
      }
    };
    return {
      id,
      get pid() {
        return entry.ended ? null : entry.pid;
      },
      write: (text) => sendWhileActive({ type: 'write', id, text }),
      endInput: () => sendWhileActive({ type: 'endInput', id }),
      kill: (signal) => sendWhileActive({ type: 'kill', id, signal }),
      detach() {
        const isLive = entry.subscriber === subscriber;
        if (isLive) {
          sendWhileActive({ type: 'unsubscribe', id });
          entry.subscriber = null;
        }
        subscriber.detached = true;
      },
    };
  };

  const abandonAttach = (
    link: HostLink,
    entry: ProcessEntry,
    subscriber: Subscriber,
  ) => {
    if (entry.subscriber === subscriber) {
      link.send({ type: 'unsubscribe', id: entry.id });
      entry.subscriber = null;
    }
  };

  const attachOver = async (
    link: HostLink,
    entry: ProcessEntry,
    subscriber: Subscriber,
  ) => {
    const { id } = entry;
    const reply = await link.request(
      (requestId) => ({ type: 'subscribe', requestId, id }),
      HOST_REPLY_LIMIT_MS,
    );
    if (reply?.type !== 'subscribe') {
      abandonAttach(link, entry, subscriber);
      throw new Error(`the session host did not answer the attach of ${id}`);
    }
    if (!reply.running) {
      if (entry.subscriber === subscriber) {
        entry.subscriber = null;
        endEntry(processes, entry);
      }
      return null;
    }
    if (reply.log === null) {
      abandonAttach(link, entry, subscriber);
      throw new Error(`the pipe log of ${id} is incomplete`);
    }
    let log: PipeLine[];
    try {
      log = await readPipeLog(reply.log);
    } catch (error) {
      abandonAttach(link, entry, subscriber);
      throw new Error(
        `cannot read the pipe log of ${id}: ${(error as Error).message}`,
      );
    }
    if (link !== current) {
      abandonAttach(link, entry, subscriber);
      throw new Error(`the connection dropped during the attach of ${id}`);
    }
    subscriber.attaching = false;
    entry.pid = reply.pid;
    for (const line of log) {
      subscriber.lastSeq = Math.max(subscriber.lastSeq, line.seq);
    }
    timers.set(() => flushBuffer(processes, entry, subscriber), 0);
    return { process: hostedProcess(entry, subscriber), log };
  };

  const listAllHosts = async (link: HostLink): Promise<HostedProcessInfo[]> => {
    const reply = await link.request(
      (requestId) => ({ type: 'list', requestId }),
      HOST_REPLY_LIMIT_MS,
    );
    if (reply?.type !== 'list') {
      throw new Error('the session host did not answer its list');
    }
    const others = await otherHosts.list();
    const own = reply.processes.map(({ id, startedAt, running }) => ({
      id,
      startedAt,
      running,
      current: true,
    }));
    return [...own, ...others];
  };

  const listRunsOver = async (link: HostLink): Promise<HostedRun[]> => {
    const reply = await link.request(
      (requestId) => ({ type: 'listRuns', requestId }),
      HOST_REPLY_LIMIT_MS,
    );
    if (reply?.type !== 'listRuns') {
      throw new Error('the session host did not answer its run list');
    }
    return reply.runs;
  };

  startConnecting();

  return {
    terminals: terminalClient.host,
    spawn(request, events) {
      if (processes.get(request.id)?.subscriber) {
        queueMicrotask(() =>
          events.closed({
            code: null,
            signal: null,
            error: `a process with id ${request.id} already exists`,
          }),
        );
        return hostedProcess(
          { id: request.id, ended: true, subscriber: null, pid: null },
          {
            events,
            fromSpawn: true,
            lastSeq: 0,
            buffer: null,
            attaching: false,
            detached: true,
          },
        );
      }
      const { entry, subscriber } = subscribe(request.id, events, false);
      whenConnected((link, failure) => {
        if (link !== null) {
          link.send({ type: 'spawn', request });
          return;
        }
        deliver(processes, entry, subscriber, {
          type: 'closed',
          id: request.id,
          exit: {
            code: null,
            signal: null,
            error: `the session host did not start: ${failure}`,
          },
        });
      });
      return hostedProcess(entry, subscriber);
    },
    attach(id, events) {
      const { entry, subscriber } = subscribe(id, events, true);
      return new Promise((resolve, reject) => {
        whenConnected((link, failure) => {
          if (link === null) {
            entry.subscriber = null;
            reject(new Error(`the session host did not start: ${failure}`));
            return;
          }
          attachOver(link, entry, subscriber).then(resolve, reject);
        });
      });
    },
    list() {
      return new Promise((resolve, reject) => {
        whenConnected((link, failure) => {
          if (link === null) {
            reject(new Error(`the session host did not start: ${failure}`));
            return;
          }
          listAllHosts(link).then(resolve, reject);
        });
      });
    },
    setKeepIdleMinutes(minutes) {
      keepIdleMinutes = minutes;
      if (current !== null) {
        current.send({ type: 'setKeepIdle', minutes });
      } else {
        // The next connection sends the value as its first message.
        startConnecting();
      }
    },
    stopAll() {
      return new Promise((resolve) => {
        whenConnected((link) => {
          if (link === null) {
            resolve();
            return;
          }
          void link
            .request(
              (requestId) => ({ type: 'stopAll', requestId }),
              STOP_ALL_REPLY_LIMIT_MS,
            )
            .then((reply) => {
              if (reply === null) {
                deps.log(LOG_SOURCE, 'stop all ended with no host reply');
              }
              resolve();
            });
        });
      });
    },
    setPending(entries) {
      pending = [...entries];
      if (current === null) {
        startConnecting();
      } else if (current === queueLink) {
        current.send({ type: 'setPending', entries: [...pending] });
      }
      // Else `adopt` waits on its drain and sends the list after it.
    },
    listRuns() {
      return new Promise((resolve, reject) => {
        whenQueueReady((link, failure) => {
          if (link === null) {
            reject(new Error(`the session host did not start: ${failure}`));
            return;
          }
          listRunsOver(link).then(resolve, reject);
        });
      });
    },
    forgetRuns(ids) {
      dropPending(ids);
      if (ids.length > 0) {
        sendWhenConnected({ type: 'forgetRuns', ids: [...ids] });
      }
    },
    onRunStarted(listener) {
      runStartedListeners.add(listener);
      return {
        dispose() {
          runStartedListeners.delete(listener);
        },
      };
    },
    onConnected(listener) {
      connectedListeners.add(listener);
      return {
        dispose() {
          connectedListeners.delete(listener);
        },
      };
    },
  };
}
