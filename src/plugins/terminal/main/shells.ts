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
// start resolves share one start. `open` starts a shell when the
// session has none and resizes a running one; `restart` and `type` also
// replace an exited one, and never kill a running one. `type` starts a shell
// at 80×24, writes the text with no Enter and sends `typed`, then rejects when
// the shell had exited before the write. `kill` ends a session's shell and
// deletes its `terminal.output` key, and cancels a start still resolving, whose
// callers then reject. `adopt` subscribes to the host's shells whose session
// has a row, and kills the rest; an attach that fails is logged and adoption
// goes on. A shell adoption did not settle (its attach failed, or the list
// itself did) is attached by its session's next start, which spawns only when
// the host holds no shell for the id or that attach fails too; a `kill` of its
// session with no live shell in the table attaches it to kill it and delete
// its `terminal.output` key, and a start meanwhile waits for that end. Once
// the part stopped, adoption attaches no more shells, and a shell attached
// meanwhile is detached after `detachAll` and killed after `killAll`.
// `detachAll` leaves every shell running in the host for the next start to
// adopt; `killAll` ends every shell, those adoption did not settle included
// (listing the host again when the first list failed), save one whose attach
// fails again, which is logged. After either, every `open`, `restart` and
// `type` rejects; `write`, `resize` and `kill` do nothing.
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

// A start whose host attach or shell program is still resolving.
interface Start {
  cancelled: boolean;
  promise: Promise<Ready>;
}

// The id's entry once its start settled; `spawned` is what the entry held at
// its spawn, before any output arrived, when the start spawned the shell, and
// null when it found one.
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

const EXITED_BEFORE_TYPED =
  'terminal: the shell exited before the text was typed';

function cancelledError(sessionId: string): Error {
  return new Error(`terminal: the shell start for ${sessionId} was cancelled`);
}

function isMeasured(cols: number, rows: number): boolean {
  return cols >= 1 && rows >= 1;
}

export function createShells(deps: ShellsDeps): Shells {
  const table = new Map<string, Entry>();
  const starts = new Map<string, Start>();
  // The kills of unreached ids whose attach is still resolving.
  const ends = new Map<string, Promise<void>>();
  // How the part stopped, null while it runs.
  let stopped: 'detached' | 'killed' | null = null;
  let markAdopted: () => void = () => undefined;
  const adopted = new Promise<void>((resolve) => {
    markAdopted = resolve;
  });
  // The listed ids adoption did not settle. `isListUnread` is set when the
  // list itself failed, so any id may be one; `reached` then holds the ids
  // whose attach has since answered.
  const unreached = new Set<string>();
  let isListUnread = false;
  const reached = new Set<string>();

  const isUnreached = (sessionId: string): boolean =>
    isListUnread ? !reached.has(sessionId) : unreached.has(sessionId);

  const markReached = (sessionId: string): void => {
    unreached.delete(sessionId);
    reached.add(sessionId);
  };

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
  ): Ready => {
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
    return { entry, spawned: openedOf(entry) };
  };

  const logAttachFailure = (sessionId: string, error: unknown): void => {
    deps.log(
      `could not attach the shell for ${deps.labelOf(sessionId)}: ${errorText(error)}`,
    );
  };

  // Attaches the host's shell for the id as an entry not yet in the table;
  // null when the host holds none, or when the part stopped while it attached,
  // which then detaches or kills the shell as the stop did.
  const attachEntry = async (sessionId: string): Promise<Entry | null> => {
    const events = eventsOf(sessionId);
    const attached = await deps.terminals.attach(sessionId, events);
    if (attached === null) {
      return null;
    }
    if (stopped === 'killed') {
      attached.process.kill();
      deps.output.delete(sessionId);
      return null;
    }
    if (stopped === 'detached') {
      attached.process.detach();
      return null;
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
    return entry;
  };

  // Runs `attach` for an id adoption did not settle, and marks the id reached
  // once the host answered. A rejected attach is logged and answers null,
  // leaving the id unreached for its next start or kill.
  const reachUnreached = async <T>(
    sessionId: string,
    attach: () => Promise<T | null>,
  ): Promise<T | null> => {
    try {
      const attached = await attach();
      markReached(sessionId);
      return attached;
    } catch (error) {
      logAttachFailure(sessionId, error);
      return null;
    }
  };

  // The shell adoption did not settle for the id, attached; null when the host
  // holds none or the attach failed. A shell attached after `kill` cancelled
  // the start is killed and its output key deleted.
  const reattach = async (
    sessionId: string,
    start: Start,
  ): Promise<Entry | null> => {
    const entry = await reachUnreached(sessionId, () => attachEntry(sessionId));
    if (entry !== null && start.cancelled) {
      entry.process?.kill();
      deps.output.delete(sessionId);
      throw cancelledError(sessionId);
    }
    return entry;
  };

  // Reaches the id's shell in the host when adoption did not, else spawns one.
  const startShell = async (
    sessionId: string,
    cols: number,
    rows: number,
    start: Start,
  ): Promise<Ready> => {
    if (isUnreached(sessionId)) {
      const entry = await reattach(sessionId, start);
      if (entry !== null) {
        setEntry(sessionId, entry);
        deps.log(`shell reattached for ${deps.labelOf(sessionId)}`);
        return { entry, spawned: null };
      }
    }
    const program = await deps.resolveShell();
    return spawnResolved(sessionId, program, cols, rows, start);
  };

  // Files the start in `starts` before its first wait, and removes it once it
  // settles.
  const spawnFor = (
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<Ready> => {
    const start: Start = {
      cancelled: false,
      promise: Promise.resolve()
        .then(() => startShell(sessionId, cols, rows, start))
        .finally(() => starts.delete(sessionId)),
    };
    starts.set(sessionId, start);
    return start.promise;
  };

  // The id's entry once adoption and any start or end in flight settle. With
  // no entry, or an exited one `replacesExited` lets go, it starts one (a spawn
  // at cols×rows, or the attach `startShell` makes first), reading `starts`,
  // `ends` and the table and calling `spawnFor` in one step after
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
      const end = ends.get(sessionId);
      if (end !== undefined) {
        await end;
        continue;
      }
      const entry = table.get(sessionId);
      if (entry !== undefined) {
        const isReplaced = replacesExited && entry.process === null;
        if (!isReplaced) {
          return { entry, spawned: null };
        }
      }
      return spawnFor(sessionId, cols, rows);
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
  // while it attached (its shell is then killed and its output key deleted).
  const adoptOne = async (sessionId: string): Promise<boolean> => {
    const entry = await attachEntry(sessionId);
    if (entry === null) {
      return false;
    }
    if (!deps.hasRow(sessionId)) {
      entry.process?.kill();
      deps.output.delete(sessionId);
      return false;
    }
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
      try {
        if (deps.hasRow(id)) {
          adoptedCount += (await adoptOne(id)) ? 1 : 0;
        } else {
          endedCount += (await endUnclaimed(id)) ? 1 : 0;
        }
      } catch (error) {
        unreached.add(id);
        logAttachFailure(id, error);
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

  // Kills the host's shell for an id adoption did not settle, once any start
  // for it settled, and deletes its output key; nothing when the id is reached
  // or already ending. The end sits in `ends` until its attach answers.
  const endUnreached = (sessionId: string): void => {
    if (!isUnreached(sessionId) || ends.has(sessionId)) {
      return;
    }
    const start = starts.get(sessionId);
    if (start !== undefined) {
      void start.promise
        .catch(() => undefined)
        .then(() => endUnreached(sessionId));
      return;
    }
    const end = reachUnreached(sessionId, () =>
      deps.terminals.attach(sessionId, IGNORED_EVENTS),
    )
      .then((attached) => {
        deps.output.delete(sessionId);
        if (attached !== null) {
          attached.process.kill();
          deps.log(`shell killed for ${deps.labelOf(sessionId)}`);
        }
      })
      .finally(() => ends.delete(sessionId));
    ends.set(sessionId, end);
  };

  // Removes the id's entry, killing its shell and deleting its output key;
  // true when the entry's shell was live, so the host's shell for the id was
  // this entry's.
  const killEntry = (sessionId: string): boolean => {
    const entry = table.get(sessionId);
    if (entry === undefined) {
      return false;
    }
    table.delete(sessionId);
    entry.process?.kill();
    clearOutputTimer(entry);
    deps.output.delete(sessionId);
    deps.log(`shell killed for ${deps.labelOf(sessionId)}`);
    return entry.process !== null;
  };

  const kill = (sessionId: string): void => {
    if (stopped !== null) {
      return;
    }
    const start = starts.get(sessionId);
    if (start !== undefined) {
      start.cancelled = true;
    }
    if (!killEntry(sessionId)) {
      endUnreached(sessionId);
    }
  };

  // Ends every unreached id but those whose live shell `killAll` just killed;
  // lists the host for them when the first list failed.
  const endAllUnreached = (killedLive: ReadonlySet<string>): void => {
    if (!isListUnread) {
      for (const sessionId of unreached) {
        endUnreached(sessionId);
      }
      return;
    }
    void deps.terminals
      .list()
      .then((listed) => {
        for (const { id, running } of listed) {
          if (running && !killedLive.has(id)) {
            endUnreached(id);
          }
        }
      })
      .catch((error: unknown) => {
        deps.log(`could not list the shells to end: ${errorText(error)}`);
      });
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
      const { process } = entry;
      process?.write(text);
      deps.send('typed', { sessionId, shell: entry.shell, text });
      if (process === null) {
        throw new Error(EXITED_BEFORE_TYPED);
      }
    },
    kill,
    async adopt() {
      try {
        await adoptListed();
      } catch (error) {
        isListUnread = true;
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
      const killedLive = new Set<string>();
      for (const sessionId of table.keys()) {
        if (killEntry(sessionId)) {
          killedLive.add(sessionId);
        }
      }
      endAllUnreached(killedLive);
      markAdopted();
    },
  };
}
