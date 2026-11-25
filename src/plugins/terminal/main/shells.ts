import type { Timers } from '../../../contracts/ambient';
import type { ProgramCandidate } from '../../../contracts/platform';
import type { MainChannel } from '../../../contracts/plugin';
import type { KeyedSlotWriter } from '../../../contracts/state';
import {
  TERMINAL_REPLAY_LIMIT,
  type TerminalEvents,
  type TerminalExit,
  type TerminalHost,
  type TerminalProcess,
} from '../../../contracts/terminals';
import { errorText } from '../../../shared/error-text';
import { keepTail } from '../../../shared/keep-tail';
import type { TerminalChannel, TerminalOpened } from '../contract';
import { exitReason } from '../exit-reason';
import { createPlainText, type PlainText } from './plain-text';

// The lines of output the `terminal.output` slot holds per session.
export const PLAIN_LINE_LIMIT = 200;
// How long output gathers before one write of the `terminal.output` slot.
export const OUTPUT_WRITE_MS = 250;
// The size a shell starts at when no screen has measured one.
const START_COLS = 80;
const START_ROWS = 24;

export interface ShellsDeps {
  terminals: TerminalHost;
  resolveShell(): Promise<ProgramCandidate | null>;
  folderOf(sessionId: string): string; // the row's projectDir, else services.homeDir
  labelOf(sessionId: string): string; // the row's label, else the session id
  hasRow(sessionId: string): boolean;
  newShellId(): string; // services.randomUuid
  send: MainChannel<TerminalChannel>['send'];
  output: KeyedSlotWriter<string>;
  timers: Timers;
  log(message: string): void;
}

// Each session's one shell, keyed by app session id. `open`, `restart` and
// `type` wait for `adopt` to settle first, and calls for one session while its
// shell program resolves share one start. `open` starts a shell when the
// session has none and resizes a running one; `restart` and `type` also
// replace an exited one, and never kill a running one. `type` starts a shell
// at 80×24, writes the text with no Enter and sends `typed`. `kill` ends a
// session's shell and deletes its `terminal.output` key, and cancels a start
// still resolving, whose callers then reject. `adopt` subscribes to the host's
// shells whose session has a row, and kills the rest; once the part stopped it
// attaches no more shells, and a shell it attached meanwhile is detached after
// `detachAll` and killed after `killAll`. `detachAll` leaves every shell running
// in the host for the next start to adopt; `killAll` ends every shell. After
// either, every `open`, `restart` and `type` rejects; `write`, `resize` and
// `kill` do nothing.
export interface Shells {
  open(sessionId: string, cols: number, rows: number): Promise<TerminalOpened>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  restart(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<TerminalOpened>;
  type(sessionId: string, text: string): Promise<void>;
  kill(sessionId: string): void;
  adopt(): Promise<void>;
  detachAll(): void;
  killAll(): void;
}

// One session's shell. `process` is null once the shell exited; `events` is
// the subscription the entry was made with, so an event from any other is
// stale. `outputTimer` is the armed write of the output slot, null for none.
interface Entry {
  shell: string;
  process: TerminalProcess | null;
  buffer: string;
  seq: number;
  folder: string;
  exit: TerminalExit | null;
  plain: PlainText;
  events: TerminalEvents;
  outputTimer: number | null;
}

// A start whose shell program is still resolving.
interface Start {
  cancelled: boolean;
  promise: Promise<Spawned>;
}

// A spawned entry, and what it held at the spawn, before any output arrived.
interface Spawned {
  entry: Entry;
  opened: TerminalOpened;
}

// The id's entry once its start settled; `spawned` is set when this call
// started the shell.
interface Ready {
  entry: Entry;
  spawned: TerminalOpened | null;
}

const IGNORED_EVENTS: TerminalEvents = { data() {}, closed() {} };

function openedOf(entry: Entry): TerminalOpened {
  return {
    shell: entry.shell,
    buffer: entry.buffer,
    seq: entry.seq,
    folder: entry.folder,
    exit: entry.exit,
  };
}

function cancelledError(sessionId: string): Error {
  return new Error(`terminal: the shell start for ${sessionId} was cancelled`);
}

function isMeasured(cols: number, rows: number): boolean {
  return cols >= 1 && rows >= 1;
}

export function createShells(deps: ShellsDeps): Shells {
  const table = new Map<string, Entry>();
  const starts = new Map<string, Start>();
  // How the part stopped, null while it runs.
  let stopped: 'detached' | 'killed' | null = null;
  let markAdopted: () => void = () => undefined;
  const adopted = new Promise<void>((resolve) => {
    markAdopted = resolve;
  });

  const currentEntry = (
    sessionId: string,
    events: TerminalEvents,
  ): Entry | undefined => {
    const entry = table.get(sessionId);
    return entry?.events === events ? entry : undefined;
  };

  const clearOutputTimer = (entry: Entry): void => {
    if (entry.outputTimer !== null) {
      deps.timers.clear(entry.outputTimer);
      entry.outputTimer = null;
    }
  };

  // Coalesces: the first call after a write arms one timer, and later calls
  // join it until it writes.
  const scheduleOutput = (sessionId: string, entry: Entry): void => {
    if (entry.outputTimer !== null) {
      return;
    }
    entry.outputTimer = deps.timers.set(() => {
      entry.outputTimer = null;
      deps.output.set(sessionId, entry.plain.text());
    }, OUTPUT_WRITE_MS);
  };

  const eventsOf = (sessionId: string): TerminalEvents => {
    const events: TerminalEvents = {
      data(chunk) {
        const entry = currentEntry(sessionId, events);
        if (entry === undefined) {
          return;
        }
        entry.seq += 1;
        entry.buffer = keepTail(entry.buffer + chunk, TERMINAL_REPLAY_LIMIT);
        deps.send('data', {
          sessionId,
          shell: entry.shell,
          chunk,
          seq: entry.seq,
        });
        entry.plain.write(chunk);
        scheduleOutput(sessionId, entry);
      },
      closed(exit) {
        const entry = currentEntry(sessionId, events);
        if (entry === undefined || entry.process === null) {
          return;
        }
        entry.exit = exit;
        entry.process = null;
        deps.send('exited', { sessionId, shell: entry.shell, exit });
        deps.log(
          `shell exited for ${deps.labelOf(sessionId)}: ${exitReason(exit)}`,
        );
      },
    };
    return events;
  };

  // Puts `entry` in the table in place of the id's last one, whose pending
  // output write it clears.
  const setEntry = (sessionId: string, entry: Entry): void => {
    const replaced = table.get(sessionId);
    if (replaced !== undefined) {
      clearOutputTimer(replaced);
    }
    table.set(sessionId, entry);
    scheduleOutput(sessionId, entry);
  };

  const spawnResolved = (
    sessionId: string,
    program: ProgramCandidate | null,
    cols: number,
    rows: number,
    start: Start,
  ): Spawned => {
    if (start.cancelled) {
      throw cancelledError(sessionId);
    }
    if (program === null) {
      throw new Error('terminal found no shell program to start');
    }
    const isSized = isMeasured(cols, rows);
    const folder = deps.folderOf(sessionId);
    const events = eventsOf(sessionId);
    const process = deps.terminals.spawn(
      {
        id: sessionId,
        command: program.command,
        args: program.args,
        cwd: folder,
        cols: isSized ? cols : START_COLS,
        rows: isSized ? rows : START_ROWS,
      },
      events,
    );
    const entry: Entry = {
      shell: deps.newShellId(),
      process,
      buffer: '',
      seq: 0,
      folder,
      exit: null,
      plain: createPlainText(PLAIN_LINE_LIMIT),
      events,
      outputTimer: null,
    };
    setEntry(sessionId, entry);
    deps.log(`shell started for ${deps.labelOf(sessionId)} in ${folder}`);
    return { entry, opened: openedOf(entry) };
  };

  // Files the start in `starts` before its first wait, and removes it once it
  // settles.
  const spawnFor = (
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<Spawned> => {
    const start: Start = {
      cancelled: false,
      promise: deps
        .resolveShell()
        .then((program) => spawnResolved(sessionId, program, cols, rows, start))
        .finally(() => starts.delete(sessionId)),
    };
    starts.set(sessionId, start);
    return start.promise;
  };

  // The id's entry once adoption and any start in flight settle. With no
  // entry, or an exited one `replacesExited` lets go, it spawns at cols×rows,
  // reading `starts` and the table and calling `spawnFor` in one step after
  // its last wait, so concurrent calls make one shell.
  const readyEntry = async (
    sessionId: string,
    cols: number,
    rows: number,
    replacesExited: boolean,
  ): Promise<Ready> => {
    await adopted;
    for (;;) {
      if (stopped !== null) {
        throw cancelledError(sessionId);
      }
      const start = starts.get(sessionId);
      if (start !== undefined) {
        await start.promise;
        continue;
      }
      const entry = table.get(sessionId);
      if (entry !== undefined) {
        const isReplaced = replacesExited && entry.process === null;
        if (!isReplaced) {
          return { entry, spawned: null };
        }
      }
      const { entry: spawnedEntry, opened } = await spawnFor(
        sessionId,
        cols,
        rows,
      );
      return { entry: spawnedEntry, spawned: opened };
    }
  };

  const resizeEntry = (entry: Entry, cols: number, rows: number): void => {
    if (entry.process !== null && isMeasured(cols, rows)) {
      entry.process.resize(cols, rows);
    }
  };

  const openWith = async (
    sessionId: string,
    cols: number,
    rows: number,
    replacesExited: boolean,
  ): Promise<TerminalOpened> => {
    const { entry, spawned } = await readyEntry(
      sessionId,
      cols,
      rows,
      replacesExited,
    );
    if (spawned !== null) {
      return spawned;
    }
    resizeEntry(entry, cols, rows);
    return openedOf(entry);
  };

  // Subscribes to a listed shell whose session has a row; false when the host
  // no longer holds it, the part stopped while it attached, or the row closed
  // while it attached (its shell is then killed).
  const adoptOne = async (sessionId: string): Promise<boolean> => {
    const events = eventsOf(sessionId);
    const attached = await deps.terminals.attach(sessionId, events);
    if (attached === null) {
      return false;
    }
    if (stopped !== null) {
      if (stopped === 'killed') {
        attached.process.kill();
      } else {
        attached.process.detach();
      }
      return false;
    }
    if (!deps.hasRow(sessionId)) {
      attached.process.kill();
      return false;
    }
    const { process, replay } = attached;
    const entry: Entry = {
      shell: deps.newShellId(),
      process,
      buffer: keepTail(replay, TERMINAL_REPLAY_LIMIT),
      seq: replay === '' ? 0 : 1,
      folder: deps.folderOf(sessionId),
      exit: null,
      plain: createPlainText(PLAIN_LINE_LIMIT),
      events,
      outputTimer: null,
    };
    entry.plain.write(replay);
    setEntry(sessionId, entry);
    return true;
  };

  // Kills a listed shell whose session has no row; false when the host no
  // longer holds it.
  const endUnclaimed = async (sessionId: string): Promise<boolean> => {
    const attached = await deps.terminals.attach(sessionId, IGNORED_EVENTS);
    attached?.process.kill();
    deps.output.delete(sessionId);
    return attached !== null;
  };

  const adoptListed = async (): Promise<void> => {
    const listed = await deps.terminals.list();
    let adoptedCount = 0;
    let endedCount = 0;
    for (const { id } of listed) {
      if (stopped !== null) {
        break;
      }
      if (deps.hasRow(id)) {
        adoptedCount += (await adoptOne(id)) ? 1 : 0;
      } else {
        endedCount += (await endUnclaimed(id)) ? 1 : 0;
      }
    }
    if (listed.length > 0) {
      deps.log(`adopted ${adoptedCount} shells, ended ${endedCount}`);
    }
  };

  const cancelStarts = (): void => {
    for (const start of starts.values()) {
      start.cancelled = true;
    }
  };

  const kill = (sessionId: string): void => {
    const start = starts.get(sessionId);
    if (start !== undefined) {
      start.cancelled = true;
    }
    const entry = table.get(sessionId);
    if (entry === undefined) {
      return;
    }
    table.delete(sessionId);
    entry.process?.kill();
    clearOutputTimer(entry);
    deps.output.delete(sessionId);
    deps.log(`shell killed for ${deps.labelOf(sessionId)}`);
  };

  return {
    open: (sessionId, cols, rows) => openWith(sessionId, cols, rows, false),
    write(sessionId, data) {
      table.get(sessionId)?.process?.write(data);
    },
    resize(sessionId, cols, rows) {
      const entry = table.get(sessionId);
      if (entry !== undefined) {
        resizeEntry(entry, cols, rows);
      }
    },
    restart: (sessionId, cols, rows) => openWith(sessionId, cols, rows, true),
    async type(sessionId, text) {
      const { entry } = await readyEntry(
        sessionId,
        START_COLS,
        START_ROWS,
        true,
      );
      entry.process?.write(text);
      deps.send('typed', { sessionId, shell: entry.shell, text });
    },
    kill,
    async adopt() {
      try {
        await adoptListed();
      } catch (error) {
        deps.log(`adoption failed: ${errorText(error)}`);
      } finally {
        markAdopted();
      }
    },
    detachAll() {
      stopped = 'detached';
      cancelStarts();
      for (const entry of table.values()) {
        entry.process?.detach();
        clearOutputTimer(entry);
      }
      table.clear();
      markAdopted();
    },
    killAll() {
      stopped = 'killed';
      cancelStarts();
      for (const sessionId of table.keys()) {
        kill(sessionId);
      }
      markAdopted();
    },
  };
}
