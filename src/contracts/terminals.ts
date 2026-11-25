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
  spawn(request: TerminalSpawn, events: TerminalEvents): TerminalProcess;
  attach(id: string, events: TerminalEvents): Promise<TerminalAttach | null>;
  list(): Promise<TerminalInfo[]>;
}
