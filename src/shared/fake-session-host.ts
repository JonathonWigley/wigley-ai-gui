import type { Clock } from '../contracts/ambient';
import type {
  HostedExit,
  HostedProcess,
  HostedProcessEvents,
  HostedProcessInfo,
  HostedRun,
  HostedSpawn,
  PendingSpawn,
  PipeDirection,
  PipeLine,
  SessionHost,
} from '../contracts/session-host';

// An in-memory `SessionHost` for the tests. `output`, `close` and `spawned` call a record's
// events at once; `spawn` and `attach` call nothing during the call. `spawn` takes the request's
// `stdin` lines as writes, as the real host does.

export interface FakeHostedProcessRecord {
  request: HostedSpawn | null; // null for a process added with addRunning
  id: string;
  startedAt: number;
  current: boolean;
  events: HostedProcessEvents | null; // the latest spawn or attach events; null until attached
  spawnEvents: HostedProcessEvents | null; // the events `spawn` was given; null for a process added with addRunning
  pid: number | null; // set by `spawned`, or by addRunning's `pid`
  log: PipeLine[]; // every line, `in` included, in seq order
  writes: string[];
  inputEnded: boolean;
  kills: ('SIGTERM' | 'SIGKILL')[];
  detaches: number; // detach calls on any HostedProcess of this record
  closed: HostedExit | null;
}

export interface FakeSessionHost extends SessionHost {
  readonly processes: readonly FakeHostedProcessRecord[];
  readonly keepIdleMinutes: readonly number[];
  readonly stopAllCalls: number;
  // Every list `setPending` was given, in call order.
  readonly pendingLists: readonly (readonly PendingSpawn[])[];
  // Every id `forgetRuns` was given, in call order.
  readonly forgotten: readonly string[];
  addRunning(process: {
    id: string;
    startedAt: number;
    current: boolean;
    log: readonly PipeLine[];
    pid?: number; // left out: null
  }): FakeHostedProcessRecord;
  output(id: string, dir: 'out' | 'err', text: string): PipeLine;
  // Sets process `id`'s pid, and tells the events `spawn` was given while no `attach` has replaced them.
  spawned(id: string, pid: number): void;
  close(id: string, exit: HostedExit): void;
  failNextSpawn(error: string): void;
  // What `list()` resolves from now on; null goes back to listing the records.
  setList(infos: readonly HostedProcessInfo[] | null): void;
  // What `list()` and `listRuns()` reject with from now on, ahead of `setList`; null goes back to resolving.
  failList(error: string | null): void;
  // Adds `run` to what `listRuns` resolves, then tells every `onRunStarted` listener.
  startRun(run: HostedRun): void;
  // Tells every `onConnected` listener, as any connect after the client's first attempt does.
  connectAgain(): void;
}

function appendLine(
  record: FakeHostedProcessRecord,
  dir: PipeDirection,
  text: string,
  clock: Clock,
): PipeLine {
  const lastSeq = record.log.at(-1)?.seq ?? 0;
  const line: PipeLine = { seq: lastSeq + 1, dir, at: clock.now(), text };
  record.log.push(line);
  return line;
}

function closeRecord(record: FakeHostedProcessRecord, exit: HostedExit) {
  if (record.closed !== null) {
    return;
  }
  record.closed = exit;
  record.events?.closed(exit);
}

function hostedProcessOf(
  record: FakeHostedProcessRecord,
  events: HostedProcessEvents,
  clock: Clock,
): HostedProcess {
  return {
    id: record.id,
    get pid() {
      return record.closed === null ? record.pid : null;
    },
    write(text) {
      if (record.closed === null) {
        record.writes.push(text);
        appendLine(record, 'in', text, clock);
      }
    },
    endInput() {
      if (record.closed === null) {
        record.inputEnded = true;
      }
    },
    kill(signal) {
      if (record.closed === null) {
        record.kills.push(signal);
      }
    },
    detach() {
      record.detaches += 1;
      if (record.events === events) {
        record.events = null;
      }
    },
  };
}

export function createFakeSessionHost(clock: Clock): FakeSessionHost {
  const processes: FakeHostedProcessRecord[] = [];
  const keepIdleMinutes: number[] = [];
  let stopAllCalls = 0;
  let nextSpawnError: string | null = null;
  let listedInfos: readonly HostedProcessInfo[] | null = null;
  let listError: string | null = null;
  const pendingLists: (readonly PendingSpawn[])[] = [];
  const forgotten: string[] = [];
  const startedRuns: HostedRun[] = [];
  const runStartedListeners = new Set<(run: HostedRun) => void>();
  const connectedListeners = new Set<() => void>();

  const lastRecordOf = (id: string): FakeHostedProcessRecord | undefined =>
    processes.findLast((record) => record.id === id);

  return {
    processes,
    keepIdleMinutes,
    get stopAllCalls() {
      return stopAllCalls;
    },
    pendingLists,
    forgotten,
    spawn(request, events) {
      const { id } = request;
      const holder = lastRecordOf(id);
      if (holder !== undefined && holder.closed === null) {
        queueMicrotask(() =>
          events.closed({
            code: null,
            signal: null,
            error: `a process with id ${id} already exists`,
          }),
        );
        return {
          id,
          pid: null,
          write() {},
          endInput() {},
          kill() {},
          detach() {},
        };
      }
      const record: FakeHostedProcessRecord = {
        request,
        id,
        startedAt: clock.now(),
        current: true,
        events,
        spawnEvents: events,
        pid: null,
        log: [],
        writes: [],
        inputEnded: false,
        kills: [],
        detaches: 0,
        closed: null,
      };
      processes.push(record);
      for (const line of request.stdin) {
        record.writes.push(line);
        appendLine(record, 'in', line, clock);
      }
      if (nextSpawnError !== null) {
        const error = nextSpawnError;
        nextSpawnError = null;
        queueMicrotask(() =>
          closeRecord(record, { code: null, signal: null, error }),
        );
      }
      return hostedProcessOf(record, events, clock);
    },
    async attach(id, events) {
      const record = lastRecordOf(id);
      if (record === undefined || !record.current || record.closed !== null) {
        return null;
      }
      record.events = events;
      return {
        process: hostedProcessOf(record, events, clock),
        log: [...record.log],
      };
    },
    async list() {
      if (listError !== null) {
        throw new Error(listError);
      }
      if (listedInfos !== null) {
        return [...listedInfos];
      }
      return processes
        .filter((record) => record.closed === null)
        .map(({ id, startedAt, current }) => ({
          id,
          startedAt,
          running: true,
          current,
        }));
    },
    setKeepIdleMinutes(minutes) {
      keepIdleMinutes.push(minutes);
    },
    async stopAll() {
      stopAllCalls += 1;
      const stopped = processes.filter(
        (record) => record.current && record.closed === null,
      );
      for (const record of stopped) {
        record.kills.push('SIGTERM');
        closeRecord(record, { code: null, signal: 'SIGTERM', error: null });
      }
    },
    setPending(entries) {
      pendingLists.push([...entries]);
    },
    async listRuns() {
      if (listError !== null) {
        throw new Error(listError);
      }
      return startedRuns.filter((run) => !forgotten.includes(run.id));
    },
    forgetRuns(ids) {
      forgotten.push(...ids);
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
    addRunning({ id, startedAt, current, log, pid }) {
      const record: FakeHostedProcessRecord = {
        request: null,
        id,
        startedAt,
        current,
        events: null,
        spawnEvents: null,
        pid: pid ?? null,
        log: [...log],
        writes: [],
        inputEnded: false,
        kills: [],
        detaches: 0,
        closed: null,
      };
      processes.push(record);
      return record;
    },
    output(id, dir, text) {
      const record = lastRecordOf(id);
      if (record === undefined || record.closed !== null) {
        throw new Error(`fake session host has no open process ${id}`);
      }
      const line = appendLine(record, dir, text, clock);
      record.events?.line(line);
      return line;
    },
    spawned(id, pid) {
      const record = lastRecordOf(id);
      if (record === undefined || record.closed !== null) {
        throw new Error(`fake session host has no open process ${id}`);
      }
      record.pid = pid;
      if (record.events !== null && record.events === record.spawnEvents) {
        record.events.spawned(pid);
      }
    },
    close(id, exit) {
      const record = lastRecordOf(id);
      if (record === undefined) {
        throw new Error(`fake session host has no process ${id}`);
      }
      closeRecord(record, exit);
    },
    failNextSpawn(error) {
      nextSpawnError = error;
    },
    setList(infos) {
      listedInfos = infos;
    },
    failList(error) {
      listError = error;
    },
    startRun(run) {
      startedRuns.push(run);
      // A copy, as the real client makes: a listener added during the loop is not told this run.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const listener of [...runStartedListeners]) {
        listener(run);
      }
    },
    connectAgain() {
      // A copy, as the real client makes: a listener added during the loop is not told this connect.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const listener of [...connectedListeners]) {
        listener();
      }
    },
  };
}
