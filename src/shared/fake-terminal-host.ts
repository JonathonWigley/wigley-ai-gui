import type { Clock } from '../contracts/ambient';
import {
  TERMINAL_REPLAY_LIMIT,
  type TerminalEvents,
  type TerminalExit,
  type TerminalHost,
  type TerminalProcess,
  type TerminalSpawn,
} from '../contracts/terminals';
import { keepTail } from './keep-tail';

export interface FakeTerminalRecord {
  request: TerminalSpawn | null; // null for a shell added with addRunning
  id: string;
  startedAt: number;
  events: TerminalEvents | null; // the subscriber now; null after its detach
  output: string; // the replay: all output, cut with keepTail at TERMINAL_REPLAY_LIMIT
  writes: string[];
  resizes: { cols: number; rows: number }[];
  kills: number;
  detaches: number;
  ending: boolean; // true from a kill until the close; list() then shows running: false
  closed: TerminalExit | null;
}

// `addRunning`, `output` and `close` stand for the host's side: they act at
// once and throw on an id no open record holds.
export interface FakeTerminalHost extends TerminalHost {
  readonly terminals: readonly FakeTerminalRecord[];
  addRunning(shell: {
    id: string;
    startedAt: number;
    output: string;
  }): FakeTerminalRecord;
  output(id: string, chunk: string): void;
  close(id: string, exit: TerminalExit): void;
}

const PROMPT = '$ ';
const EXIT_LINE = 'exit';
const EXITED: TerminalExit = { code: 0, signal: null, error: null };
// SIGHUP, the exit a kill gives.
const KILLED: TerminalExit = { code: null, signal: 1, error: null };

// What the fake shell holds beside its record: the line typed since the last
// Enter, and whether an `exit` line or a kill has a close waiting.
interface ShellState {
  line: string;
  closePending: boolean;
}

function endedHandle(id: string): TerminalProcess {
  return { id, write() {}, resize() {}, kill() {}, detach() {} };
}

function writeChunk(record: FakeTerminalRecord, chunk: string): void {
  record.output = keepTail(record.output + chunk, TERMINAL_REPLAY_LIMIT);
  record.events?.data(chunk);
}

function closeRecord(record: FakeTerminalRecord, exit: TerminalExit): void {
  if (record.closed !== null) {
    return;
  }
  record.closed = exit;
  record.events?.closed(exit);
}

function closeLater(
  record: FakeTerminalRecord,
  state: ShellState,
  exit: TerminalExit,
): void {
  state.closePending = true;
  queueMicrotask(() => closeRecord(record, exit));
}

// Echoes `data` one character at a time as the line discipline would, answers
// each Enter with `ran: <line>` and a new prompt, and closes on an `exit` line.
function typeInto(
  record: FakeTerminalRecord,
  state: ShellState,
  data: string,
): void {
  let reply = '';
  for (const char of data) {
    if (char === '\r') {
      reply += '\r\n';
      if (state.line === EXIT_LINE) {
        state.line = '';
        writeChunk(record, reply);
        closeLater(record, state, EXITED);
        return;
      }
      reply += `ran: ${state.line}\r\n${PROMPT}`;
      state.line = '';
    } else if (char === '\x7f') {
      if (state.line !== '') {
        state.line = state.line.slice(0, -1);
        reply += '\b \b';
      }
    } else {
      state.line += char;
      reply += char;
    }
  }
  if (reply !== '') {
    writeChunk(record, reply);
  }
}

// A scripted shell host for the self-test, a default drive run and tests, as
// the main process sees the real one through the session host client. A
// `TerminalHost` or `TerminalProcess` call never throws and never calls an
// event inside it: the prompt, a refusal and every close come in a microtask.
// A closed record stays in `terminals` and no call finds it by its id.
export function createFakeTerminalHost(clock: Clock): FakeTerminalHost {
  const terminals: FakeTerminalRecord[] = [];
  const states = new Map<FakeTerminalRecord, ShellState>();

  const openRecord = (id: string): FakeTerminalRecord | null =>
    terminals.find((record) => record.id === id && record.closed === null) ??
    null;

  const requireOpen = (id: string): FakeTerminalRecord => {
    const record = openRecord(id);
    if (record === null) {
      throw new Error(`no terminal ${id}`);
    }
    return record;
  };

  const addRecord = (
    request: TerminalSpawn | null,
    id: string,
    startedAt: number,
    events: TerminalEvents | null,
    output: string,
  ): FakeTerminalRecord => {
    const record: FakeTerminalRecord = {
      request,
      id,
      startedAt,
      events,
      output,
      writes: [],
      resizes: [],
      kills: 0,
      detaches: 0,
      ending: false,
      closed: null,
    };
    terminals.push(record);
    states.set(record, { line: '', closePending: false });
    return record;
  };

  // A handle is active until its own `detach` and while its record is open.
  const handleOf = (
    record: FakeTerminalRecord,
    events: TerminalEvents,
  ): TerminalProcess => {
    const state = states.get(record) as ShellState;
    let isDetached = false;
    const isActive = (): boolean => !isDetached && record.closed === null;
    return {
      id: record.id,
      write: (data) => {
        if (!isActive()) {
          return;
        }
        record.writes.push(data);
        if (!state.closePending) {
          typeInto(record, state, data);
        }
      },
      resize: (cols, rows) => {
        if (isActive()) {
          record.resizes.push({ cols, rows });
        }
      },
      kill: () => {
        if (!isActive()) {
          return;
        }
        record.kills += 1;
        if (!record.ending) {
          record.ending = true;
          closeLater(record, state, KILLED);
        }
      },
      detach: () => {
        if (!isActive()) {
          return;
        }
        record.detaches += 1;
        isDetached = true;
        if (record.events === events) {
          record.events = null;
        }
      },
    };
  };

  return {
    terminals,
    spawn: (request, events) => {
      if (openRecord(request.id) !== null) {
        queueMicrotask(() =>
          events.closed({
            code: null,
            signal: null,
            error: `a terminal with id ${request.id} already exists`,
          }),
        );
        return endedHandle(request.id);
      }
      const record = addRecord(request, request.id, clock.now(), events, '');
      queueMicrotask(() => {
        if (record.closed === null) {
          writeChunk(record, PROMPT);
        }
      });
      return handleOf(record, events);
    },
    attach: (id, events) => {
      const record = openRecord(id);
      if (record === null) {
        return Promise.resolve(null);
      }
      record.events = events;
      return Promise.resolve({
        process: handleOf(record, events),
        replay: record.output,
      });
    },
    list: () =>
      Promise.resolve(
        terminals
          .filter((record) => record.closed === null)
          .map((record) => ({
            id: record.id,
            startedAt: record.startedAt,
            running: !record.ending,
          })),
      ),
    addRunning: ({ id, startedAt, output }) => {
      if (openRecord(id) !== null) {
        throw new Error(`a terminal with id ${id} already exists`);
      }
      return addRecord(
        null,
        id,
        startedAt,
        null,
        keepTail(output, TERMINAL_REPLAY_LIMIT),
      );
    },
    output: (id, chunk) => writeChunk(requireOpen(id), chunk),
    close: (id, exit) => closeRecord(requireOpen(id), exit),
  };
}
