export type PipeDirection = 'in' | 'out' | 'err';
// One line a hosted process read on stdin (`in`) or wrote (`out`, `err`), without its newline.
// `seq` counts from 1 per process; `at` is epoch ms.
export interface PipeLine {
  seq: number;
  dir: PipeDirection;
  at: number;
  text: string;
}
// A stdout line whose top-level JSON `key` equals `value` ends a turn (Claude: `type` is `result`).
// A line whose `key` holds a value its direction's list names leaves the idle state alone; any other line reads busy.
export interface IdleRule {
  key: string;
  value: string;
  ignoredStdoutValues: readonly string[];
  ignoredStdinValues: readonly string[];
}
export interface HostedSpawn {
  id: string;
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  idleRule: IdleRule;
}
export interface HostedExit {
  code: number | null;
  signal: string | null;
  error: string | null;
}
export interface HostedProcessEvents {
  line(line: PipeLine): void; // live `out` and `err` lines only; `in` lines are logged, never echoed
  closed(exit: HostedExit): void; // once; `error` is set when the spawn failed
}
export interface HostedProcess {
  readonly id: string;
  write(text: string): void; // one line; the host appends the newline and logs it as `in`
  endInput(): void;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
  // Stops this subscriber's events; the process keeps running. A later `attach` to the same id is allowed
  // after a detach; a second `attach` while one subscriber is live replaces it (the old one gets no more events).
  detach(): void;
}
export interface HostedProcessInfo {
  id: string;
  startedAt: number;
  running: boolean;
  current: boolean; // false: it lives in another protocol's host (an older one is draining)
}
export interface SessionHost {
  spawn(request: HostedSpawn, events: HostedProcessEvents): HostedProcess;
  // The whole pipe log so far, then live lines past its last seq through `events`.
  // Live lines start in a later macrotask than the one that resolves the promise, so a caller that replays `log`
  // in the continuation of its `await` has replayed the whole log before the first live line.
  // Null only when the current-version host answered that it holds no running process with that id. Rejects when the
  // process may still run: the host did not start, its connection dropped, it did not answer in time, or it cannot
  // replay the process because the pipe log is unreadable or incomplete.
  attach(
    id: string,
    events: HostedProcessEvents,
  ): Promise<{ process: HostedProcess; log: readonly PipeLine[] } | null>;
  // Every process the hosts answered with, so `[]` means they hold none. Rejects when it could not ask: the current host
  // did not start, its connection dropped, or it or another host with a record did not answer in time. A record whose
  // channel has no listener counts as no host. `running` is false for a process past its keep window and ending: a
  // caller may start its session again, since that process reads no more input.
  list(): Promise<HostedProcessInfo[]>;
  setKeepIdleMinutes(minutes: number): void;
  // Never rejects. Resolves once the current host has stopped every process, or could not be reached, or its reply
  // limit ran out.
  stopAll(): Promise<void>;
}
