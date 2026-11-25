// The app-side seam main plugins use to run shells in the session host, one per app session.

export interface TerminalSpawn {
  id: string; // the app session id
  command: string; // the resolved shell program
  args: readonly string[];
  cwd: string;
  cols: number;
  rows: number;
}
export interface TerminalExit {
  code: number | null;
  signal: number | null;
  error: string | null;
}
export interface TerminalEvents {
  data(chunk: string): void;
  closed(exit: TerminalExit): void;
}
export interface TerminalProcess {
  readonly id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  // Stops this subscriber's events; the shell keeps running. A later `attach` to the same id is allowed after a
  // detach; a second `attach` while one subscriber is live replaces it (the old one gets no more events).
  detach(): void;
}
// `running` is false while the shell is ending; an exited shell leaves the host's list at once.
export interface TerminalInfo {
  id: string;
  startedAt: number;
  running: boolean;
}
export interface TerminalAttach {
  process: TerminalProcess;
  replay: string;
}
// UTF-16 code units of output a shell's replay keeps; cut with `keepTail` (`src/shared/keep-tail.ts`).
export const TERMINAL_REPLAY_LIMIT = 256 * 1024;
export interface TerminalHost {
  // Never throws. A spawn the host refuses, or one under an id a live shell holds, closes `events` with the reason
  // ("a terminal with id <id> already exists", "the session host did not start: …").
  spawn(request: TerminalSpawn, events: TerminalEvents): TerminalProcess;
  // The shell's replay, then live output through `events`. Live output starts in a later macrotask than the one that
  // resolves the promise, so a caller that writes `replay` in the continuation of its `await` has written it before the
  // first live chunk. Null only when the host answered that it holds no shell with that id. Rejects when the shell may
  // still run: "the session host did not start: …" or "the session host did not answer the attach of terminal <id>".
  attach(id: string, events: TerminalEvents): Promise<TerminalAttach | null>;
  // Every shell the host answered with, so `[]` means it holds none. Rejects when it could not ask: "the session host
  // did not start: …" or "the session host did not answer its terminal list".
  list(): Promise<TerminalInfo[]>;
}
