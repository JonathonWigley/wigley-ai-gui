import type { SpawnOptions } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { Clock, Timers } from '../../contracts/ambient';
import type { Log } from '../../contracts/log';
import type {
  HostedExit,
  HostedProcess,
  HostedProcessEvents,
  HostedProcessInfo,
  PipeLine,
  SessionHost,
} from '../../contracts/session-host';
import {
  type ClientMessage,
  type ClosedEvent,
  type LineEvent,
  type PipeLogRecord,
  SESSION_HOST_PROTOCOL,
} from '../../contracts/session-host-protocol';
import {
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

export type SessionHostSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => {
  unref(): void;
  // node:child_process reports ENOENT, EACCES and EMFILE as an `error` event, not a throw.
  on(event: 'error', listener: (error: Error) => void): unknown;
};

export interface SessionHostClientDeps {
  folder: string; // <app instance user data>/session-host
  channel: string; // sessionHostChannel(...)
  hostScript: string; // the built session-host.js
  execPath: string; // process.execPath
  env: NodeJS.ProcessEnv;
  spawn: SessionHostSpawn;
  clock: Clock;
  timers: Timers;
  log: Log;
}

export interface SessionHostClient extends SessionHost {
  // Disconnects from every host. Kills nothing; fires no `closed`.
  close(): Promise<void>;
}

// One events object a `spawn` or an `attach` was given.
interface Subscriber {
  events: HostedProcessEvents;
  // The highest seq read from the log or delivered; lines at or below it are dropped.
  lastSeq: number;
  // Pushed messages held back while an attach reads the log, until its flush. Null once they flow live.
  buffer: (LineEvent | ClosedEvent)[] | null;
  // True until the attach it belongs to has resolved.
  attaching: boolean;
  detached: boolean;
}

// One process id this client holds. Every `HostedProcess` of the id shares it.
interface ProcessEntry {
  id: string;
  ended: boolean; // closed, or its host is gone
  subscriber: Subscriber | null; // the one live events object
}

interface ConnectAttempt {
  ended: boolean;
  wake: (() => void) | null; // ends the wait for the next poll
}

// Called with the link once connected; with null and the reason when the attempt failed or the client closed.
type ConnectedRun = (link: HostLink | null, failure: string) => void;

function trackedTimers(timers: Timers): Timers & { clearAll(): void } {
  const handles = new Set<number>();
  return {
    set(run, ms) {
      const handle = timers.set(() => {
        handles.delete(handle);
        run();
      }, ms);
      handles.add(handle);
      return handle;
    },
    clear(handle) {
      handles.delete(handle);
      timers.clear(handle);
    },
    clearAll() {
      for (const handle of handles) {
        timers.clear(handle);
      }
      handles.clear();
    },
  };
}

function endEntry(processes: Map<string, ProcessEntry>, entry: ProcessEntry) {
  entry.ended = true;
  if (processes.get(entry.id) === entry) {
    processes.delete(entry.id);
  }
}

// Gives `message` to `subscriber` while it is still the live events object of the entry.
function deliver(
  processes: Map<string, ProcessEntry>,
  entry: ProcessEntry,
  subscriber: Subscriber,
  message: LineEvent | ClosedEvent,
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

// Each `\n`-ended line; a last line with no newline is still being written.
async function readPipeLog(file: string): Promise<PipeLine[]> {
  const lines = (await readFile(file, 'utf8')).split('\n').slice(0, -1);
  return lines.map((line) => JSON.parse(line) as PipeLogRecord);
}

export function createSessionHostClient(
  deps: SessionHostClientDeps,
): SessionHostClient {
  const timers = trackedTimers(deps.timers);
  const processes = new Map<string, ProcessEntry>();
  const openLinks = new Set<HostLink>();
  let current: HostLink | null = null;
  let attempt: ConnectAttempt | null = null;
  let waiting: ConnectedRun[] = [];
  let keepIdleMinutes = DEFAULT_KEEP_IDLE_MINUTES;
  let closedByCaller = false;

  const pushed = (message: LineEvent | ClosedEvent) => {
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
      error: 'the session host exited',
    };
    const entries = [...processes.values()];
    processes.clear();
    for (const entry of entries) {
      entry.ended = true;
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
  };

  const disconnected = (link: HostLink) => {
    openLinks.delete(link);
    if (current === link) {
      current = null;
      hostDied();
    }
  };

  const openHost = (channel: string): Promise<HostAnswer> =>
    openHostLink(channel, {
      timers,
      log: deps.log,
      opened(link) {
        // The connect was still in flight when `close` ran.
        if (closedByCaller) {
          link.destroy();
        }
        openLinks.add(link);
      },
      pushed,
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

  const runWaiting = (link: HostLink | null, failure: string) => {
    const queued = waiting;
    waiting = [];
    for (const run of queued) {
      run(link, failure);
    }
  };

  const failAttempt = (started: ConnectAttempt, reason: string) => {
    endAttempt(started);
    deps.log(LOG_SOURCE, `the session host did not start: ${reason}`);
    runWaiting(null, reason);
  };

  const startHost = (started: ConnectAttempt) => {
    try {
      const host = deps.spawn(
        deps.execPath,
        [deps.hostScript, deps.folder, deps.channel],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: { ...deps.env, ELECTRON_RUN_AS_NODE: '1' },
        },
      );
      host.on('error', (error) => {
        if (started.ended) {
          deps.log(LOG_SOURCE, `host spawn error: ${error.message}`);
        } else {
          failAttempt(started, error.message);
        }
      });
      host.unref();
    } catch (error) {
      failAttempt(started, (error as Error).message);
    }
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

  const adopt = (started: ConnectAttempt, link: HostLink) => {
    endAttempt(started);
    current = link;
    link.send({ type: 'setKeepIdle', minutes: keepIdleMinutes });
    runWaiting(link, '');
    void otherHosts.drainOlder();
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
    adopt(started, link);
  };

  const startConnecting = () => {
    if (attempt === null && !closedByCaller) {
      attempt = { ended: false, wake: null };
      void runAttempt(attempt);
    }
  };

  // Runs `run` at once when the state is settled; else keeps the order of calls until the attempt ends.
  const whenConnected = (run: ConnectedRun) => {
    if (closedByCaller || current !== null) {
      run(current, '');
      return;
    }
    waiting.push(run);
    startConnecting();
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
      lastSeq: 0,
      buffer: attaching ? [] : null,
      attaching,
      detached: false,
    };
    if (closedByCaller) {
      return { entry: { id, ended: true, subscriber: null }, subscriber };
    }
    const entry = processes.get(id) ?? { id, ended: false, subscriber: null };
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

  const abandonSubscriber = (entry: ProcessEntry, subscriber: Subscriber) => {
    if (entry.subscriber === subscriber) {
      entry.subscriber = null;
    }
  };

  const attachOver = async (
    link: HostLink,
    entry: ProcessEntry,
    subscriber: Subscriber,
  ) => {
    const { id } = entry;
    const reply = await link.request((requestId) => ({
      type: 'subscribe',
      requestId,
      id,
    }));
    if (reply?.type !== 'subscribe') {
      abandonSubscriber(entry, subscriber);
      return null;
    }
    if (!reply.running || reply.log === null) {
      if (entry.subscriber === subscriber) {
        entry.subscriber = null;
        endEntry(processes, entry);
      }
      return null;
    }
    let log: PipeLine[];
    try {
      log = await readPipeLog(reply.log);
    } catch (error) {
      if (entry.subscriber === subscriber) {
        link.send({ type: 'unsubscribe', id });
        entry.subscriber = null;
      }
      deps.log(
        LOG_SOURCE,
        `cannot read the pipe log of ${id}: ${(error as Error).message}`,
      );
      return null;
    }
    if (link !== current) {
      abandonSubscriber(entry, subscriber);
      return null;
    }
    subscriber.attaching = false;
    for (const line of log) {
      subscriber.lastSeq = Math.max(subscriber.lastSeq, line.seq);
    }
    timers.set(() => flushBuffer(processes, entry, subscriber), 0);
    return { process: hostedProcess(entry, subscriber), log };
  };

  const listAllHosts = async (link: HostLink): Promise<HostedProcessInfo[]> => {
    const reply = await link.request((requestId) => ({
      type: 'list',
      requestId,
    }));
    if (reply?.type !== 'list') {
      return [];
    }
    const others = await otherHosts.list();
    if (closedByCaller) {
      return [];
    }
    const own = reply.processes.map(({ id, startedAt, running }) => ({
      id,
      startedAt,
      running,
      current: true,
    }));
    return [...own, ...others];
  };

  startConnecting();

  return {
    spawn(request, events) {
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
      if (closedByCaller) {
        return Promise.resolve(null);
      }
      const { entry, subscriber } = subscribe(id, events, true);
      return new Promise((resolve) => {
        whenConnected((link) => {
          if (link === null) {
            abandonSubscriber(entry, subscriber);
            resolve(null);
            return;
          }
          void attachOver(link, entry, subscriber).then(resolve);
        });
      });
    },
    list() {
      return new Promise((resolve) => {
        whenConnected((link) => {
          if (link === null) {
            resolve([]);
            return;
          }
          void listAllHosts(link).then(resolve);
        });
      });
    },
    setKeepIdleMinutes(minutes) {
      if (closedByCaller) {
        return;
      }
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
            .request((requestId) => ({ type: 'stopAll', requestId }))
            .then(() => resolve());
        });
      });
    },
    async close() {
      closedByCaller = true;
      current = null;
      if (attempt !== null) {
        endAttempt(attempt);
      }
      for (const entry of processes.values()) {
        entry.ended = true;
        entry.subscriber = null;
      }
      processes.clear();
      runWaiting(null, '');
      timers.clearAll();
      const links = [...openLinks];
      for (const link of links) {
        link.end();
      }
      await Promise.all(links.map((link) => link.closed));
    },
  };
}
