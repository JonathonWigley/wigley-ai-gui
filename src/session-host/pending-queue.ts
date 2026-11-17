import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Clock, Timers } from '../contracts/ambient';
import type {
  HostedExit,
  HostedRun,
  HostedSpawn,
  PendingSpawn,
} from '../contracts/session-host';
import {
  pendingFile,
  runsFile,
  runsFileProtocol,
  SESSION_HOST_PROTOCOL,
} from '../contracts/session-host-protocol';
import type { DiagnosticLog } from './diagnostic-log';
import type { ProcessSubscriber } from './process-table';
import { replaceFile } from './replace-file';

// The longest the queue's timer waits before it reads the clock again (Decisions, The timer).
export const PENDING_TICK_MS = 30_000;

const HOST_EXITED_ERROR = 'the session host that started it exited';

export interface PendingQueueDeps {
  folder: string; // the host folder
  clock: Clock;
  timers: Timers;
  diagnostics: DiagnosticLog;
  // The process table's `spawn`.
  spawn(request: HostedSpawn, subscriber: ProcessSubscriber): void;
  // The process table's `isBusy`.
  isBusy(id: string): boolean;
  // Called once for each run the queue starts or skips, after its record is saved.
  runStarted(run: HostedRun): void;
}

export interface PendingQueue {
  // Reads the pending table and runs record of `SESSION_HOST_PROTOCOL`, then calls `importOlder`. Arms no timer.
  load(): void;
  // Adds the records of every older protocol's runs file in the folder that this record lacks, saves, and deletes
  // the older file (Decisions, Import).
  importOlder(): void;
  // Arms the timer and starts each entry already due. Before `start`, nothing spawns.
  start(): void;
  setPending(entries: readonly PendingSpawn[]): void;
  runs(): HostedRun[]; // oldest first
  forgetRuns(ids: readonly string[]): void;
  // Fills the exit of the run with this id when its exit is null.
  processClosed(id: string, exit: HostedExit): void;
  // At a drain: drops every pending entry, deletes the pending file, takes no new entry, and writes the runs file no
  // more, so it stays as last written for the next host to import. `isEmpty` reads true after it.
  drop(): void;
  isEmpty(): boolean; // no pending entry and no run record, or dropped
}

// A `spawn: null` that reached the process table would throw outside its `try` and end the host.
function isWellFormedEntry(entry: unknown): entry is PendingSpawn {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const { at, spawn } = entry as Partial<PendingSpawn>;
  const hasFiniteAt = typeof at === 'number' && Number.isFinite(at);
  const hasSpawnWithId =
    typeof spawn === 'object' && spawn !== null && typeof spawn.id === 'string';
  return hasFiniteAt && hasSpawnWithId;
}

// A run read back from a file; the queue looks runs up by `id`.
function isWellFormedRun(run: unknown): run is HostedRun {
  return (
    typeof run === 'object' &&
    run !== null &&
    typeof (run as Partial<HostedRun>).id === 'string'
  );
}

// The JSON list in `file`: empty when the file is missing, null with one diagnostics line when it cannot be read, is
// not JSON or is not a list.
function readList(file: string, diagnostics: DiagnosticLog): unknown[] | null {
  const name = path.basename(file);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    diagnostics.append(`${name}: ${(error as Error).message}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    diagnostics.append(`${name} is not JSON`);
    return null;
  }
  if (!Array.isArray(parsed)) {
    diagnostics.append(`${name} is not a list`);
    return null;
  }
  return parsed;
}

// Keeps each item `isWellFormed` accepts, with one diagnostics line naming the index of each it drops.
function wellFormedItems<T>(
  items: readonly unknown[],
  isWellFormed: (item: unknown) => item is T,
  label: string,
  diagnostics: DiagnosticLog,
): T[] {
  const kept: T[] = [];
  items.forEach((item, index) => {
    if (isWellFormed(item)) {
      kept.push(item);
    } else {
      diagnostics.append(`${label} ${index} is not well formed: dropped`);
    }
  });
  return kept;
}

// A loaded run that still reads as running belongs to a host that is gone, which took its process with it.
// True when it changed the run.
function endRunOfAGoneHost(run: HostedRun): boolean {
  if (run.exit !== null || run.skipped) {
    return false;
  }
  run.exit = { code: null, signal: null, error: HOST_EXITED_ERROR };
  return true;
}

function errorExit(error: string): HostedExit {
  return { code: null, signal: null, error };
}

export function createPendingQueue(deps: PendingQueueDeps): PendingQueue {
  const { folder, clock, timers, diagnostics } = deps;
  const pendingPath = path.join(folder, pendingFile(SESSION_HOST_PROTOCOL));
  const runsPath = path.join(folder, runsFile(SESSION_HOST_PROTOCOL));
  let pending: PendingSpawn[] = [];
  let runs: HostedRun[] = [];
  let timer: number | null = null;
  let isStarted = false;
  let isDropped = false;
  const subscriber: ProcessSubscriber = {
    line: () => {},
    spawned: () => {},
    closed: (id, exit) => processClosed(id, exit),
  };

  function savePending() {
    if (isDropped) {
      return;
    }
    try {
      replaceFile(pendingPath, JSON.stringify(pending));
    } catch (error) {
      diagnostics.append(`pending save: ${(error as Error).message}`);
    }
  }

  function saveRuns() {
    if (isDropped) {
      return;
    }
    try {
      replaceFile(runsPath, JSON.stringify(runs));
    } catch (error) {
      diagnostics.append(`runs save: ${(error as Error).message}`);
    }
  }

  function loadRuns(file: string): HostedRun[] | null {
    const items = readList(file, diagnostics);
    return items === null
      ? null
      : wellFormedItems(
          items,
          isWellFormedRun,
          `${path.basename(file)} run`,
          diagnostics,
        );
  }

  function processClosed(id: string, exit: HostedExit) {
    const run = runs.find(
      (candidate) =>
        candidate.id === id && candidate.exit === null && !candidate.skipped,
    );
    if (run === undefined) {
      return;
    }
    run.exit = exit;
    saveRuns();
  }

  function clearTimer() {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  }

  function armTimer() {
    clearTimer();
    if (!isStarted || pending.length === 0) {
      return;
    }
    const earliestAt = Math.min(...pending.map(({ at }) => at));
    const delay = Math.max(0, earliestAt - clock.now());
    timer = timers.set(startDueEntries, Math.min(delay, PENDING_TICK_MS));
  }

  // Removes `entry` from the table and records its run before any spawn, so a refusal that closes at once finds it.
  function recordRun(entry: PendingSpawn): HostedRun {
    pending = pending.filter((candidate) => candidate !== entry);
    savePending();
    const skipped =
      entry.skipWhileBusy !== null && deps.isBusy(entry.skipWhileBusy);
    const run: HostedRun = {
      id: entry.spawn.id,
      record: entry.record,
      startedAt: clock.now(),
      skipped,
      exit: null,
    };
    runs.push(run);
    saveRuns();
    return run;
  }

  // Spawns or skips `entry`; a throw becomes the run's error exit, since an uncaught throw from a timer callback ends
  // the host and every session.
  function startRun(entry: PendingSpawn): HostedRun {
    let run: HostedRun | null = null;
    try {
      run = recordRun(entry);
      if (!run.skipped) {
        deps.spawn(entry.spawn, subscriber);
      }
      return run;
    } catch (error) {
      const message = (error as Error).message;
      diagnostics.append(`pending ${entry.spawn.id}: ${message}`);
      if (run !== null) {
        processClosed(run.id, errorExit(message));
        return run;
      }
      const failed: HostedRun = {
        id: entry.spawn.id,
        record: entry.record,
        startedAt: clock.now(),
        skipped: false,
        exit: errorExit(message),
      };
      runs.push(failed);
      saveRuns();
      return failed;
    }
  }

  function fireEntry(entry: PendingSpawn) {
    const run = startRun(entry);
    try {
      deps.runStarted(run);
    } catch (error) {
      diagnostics.append(
        `run started ${run.id}: ${(error as Error).message}`,
      );
    }
  }

  function startDueEntries() {
    timer = null;
    const now = clock.now();
    const due = pending
      .filter(({ at }) => at <= now)
      .sort((a, b) => a.at - b.at);
    for (const entry of due) {
      fireEntry(entry);
    }
    armTimer();
  }

  function importOlder() {
    if (isDropped) {
      return;
    }
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch (error) {
      diagnostics.append(`runs import: ${(error as Error).message}`);
      return;
    }
    for (const name of names) {
      const protocol = runsFileProtocol(name);
      if (protocol === null || protocol >= SESSION_HOST_PROTOCOL) {
        continue;
      }
      const file = path.join(folder, name);
      const older = loadRuns(file);
      if (older === null) {
        continue;
      }
      const heldIds = new Set(runs.map(({ id }) => id));
      for (const run of older) {
        if (!heldIds.has(run.id)) {
          endRunOfAGoneHost(run);
          runs.push(run);
          heldIds.add(run.id);
        }
      }
      runs.sort((a, b) => a.startedAt - b.startedAt);
      saveRuns();
      try {
        rmSync(file, { force: true });
      } catch (error) {
        diagnostics.append(`${name}: ${(error as Error).message}`);
      }
    }
  }

  return {
    load() {
      pending = wellFormedItems(
        readList(pendingPath, diagnostics) ?? [],
        isWellFormedEntry,
        'pending entry',
        diagnostics,
      );
      runs = loadRuns(runsPath) ?? [];
      let endedAny = false;
      for (const run of runs) {
        endedAny = endRunOfAGoneHost(run) || endedAny;
      }
      if (endedAny) {
        saveRuns();
      }
      importOlder();
    },
    importOlder,
    start() {
      isStarted = true;
      startDueEntries();
    },
    setPending(entries) {
      if (isDropped) {
        diagnostics.append('setPending after a drain: ignored');
        return;
      }
      // An entry whose run is recorded was sent before the app heard that run start; the first of two ids stays.
      const takenIds = new Set(runs.map(({ id }) => id));
      const kept: PendingSpawn[] = [];
      for (const entry of wellFormedItems(
        entries,
        isWellFormedEntry,
        'pending entry',
        diagnostics,
      )) {
        if (!takenIds.has(entry.spawn.id)) {
          takenIds.add(entry.spawn.id);
          kept.push(entry);
        }
      }
      pending = kept;
      savePending();
      if (isStarted) {
        startDueEntries();
      }
    },
    runs: () => [...runs],
    forgetRuns(ids) {
      const forgotten = new Set(ids);
      runs = runs.filter(({ id }) => !forgotten.has(id));
      saveRuns();
    },
    processClosed,
    drop() {
      clearTimer();
      pending = [];
      isDropped = true;
      try {
        rmSync(pendingPath, { force: true });
      } catch (error) {
        diagnostics.append(`pending delete: ${(error as Error).message}`);
      }
    },
    isEmpty: () => isDropped || (pending.length === 0 && runs.length === 0),
  };
}
