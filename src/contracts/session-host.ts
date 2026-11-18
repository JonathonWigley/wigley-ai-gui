import type { Disposable } from './disposable';

export type PipeDirection = 'in' | 'out' | 'err';
// One line a hosted process read on stdin (`in`) or wrote (`out`, `err`), without its newline.
// `seq` counts from 1 per process; `at` is epoch ms.
export interface PipeLine {
  seq: number;
  dir: PipeDirection;
  at: number;
  text: string;
}
// How the host reads a process busy from its pipe lines: busy while a main turn is open, a message is open, or
// background work runs; idle when none holds. Every key is a top-level key of a JSON line, and a nullable field set
// to null turns its part off. A stdout line whose `key` equals `value` ends the main turn (Claude: `type` is
// `result`); a stdout line whose `key` holds a value of `busyStdoutValues` opens it, as a stdin line whose `key`
// holds a value of `busyStdinValues` does.
export interface IdleRule {
  key: string;
  value: string;
  busyStdoutValues: readonly string[];
  busyStdinValues: readonly string[];
  // A stdout line whose top-level `sideKey` holds a value that is not null belongs to side work and opens no turn
  // (Claude: `parent_tool_use_id`, set on a subagent's own lines).
  sideKey: string | null;
  // A busy stdin line whose top-level `messageIdKey` holds a string opens that message (Claude: `uuid`). A busy
  // stdin line with no id opens the turn, as a busy stdout line does.
  messageIdKey: string | null;
  // Ends an open message: a stdout line whose `key` equals `value`, whose `idKey` names the message and whose
  // `stateKey` holds one of `endStates` (Claude: `command_lifecycle`, `command_uuid`, `state`, `completed`,
  // `cancelled`, `discarded`, `refused`). A turn-end line also ends each message its `turnEndIdsKey` list names
  // (Claude: `user_message_uuids`).
  messageEnd: {
    value: string;
    idKey: string;
    stateKey: string;
    endStates: readonly string[];
  } | null;
  turnEndIdsKey: string | null;
  // Background work: a stdout line whose top-level keys equal every pair of `match` sets the background count to
  // the number of items of its `listKey` array whose `kindKey` holds one of `kinds` (Claude: `{ type: 'system',
  // subtype: 'background_tasks_changed' }`, `tasks`, `task_type`, `local_agent`).
  background: {
    match: Readonly<Record<string, string>>;
    listKey: string;
    kindKey: string;
    kinds: readonly string[];
  } | null;
}
// The keys leading from a JSON line's root to one value, the last key naming the value.
export type KeyPath = readonly string[];
export interface HostedSpawn {
  id: string;
  command: string;
  args: readonly string[];
  cwd: string;
  // With `inheritEnv` true: laid over the host's own environment, after the host drops `ELECTRON_RUN_AS_NODE` and
  // every name in `unsetEnv` from it; a name in both `unsetEnv` and `env` takes `env`'s value. With `inheritEnv`
  // false: the child's whole environment.
  env: Readonly<Record<string, string>>;
  // True for a spawn the host starts later (a prepared run), whose child takes the host's environment under `env`.
  // False for a live start, whose child environment is exactly `env`.
  inheritEnv: boolean;
  // Names the harness says the child must not inherit from the host's environment. Read only when `inheritEnv`.
  unsetEnv: readonly string[];
  // Lines written to stdin right after the spawn, in order, each logged as `in` like a `write`.
  stdin: readonly string[];
  idleRule: IdleRule;
  // Dropped from each stdout line before the host logs or delivers it, so a replay reads what a live subscriber read.
  // A line holding none of them, or not JSON, passes byte for byte; keys are matched on the parsed line.
  droppedOutKeys: readonly KeyPath[];
}
export interface HostedExit {
  code: number | null;
  signal: string | null;
  error: string | null;
}
// A spawn the host starts at `at` (epoch ms; at or before now starts at once). `record` is the app's JSON, handed back
// untouched on the run. `skipWhileBusy` is a hosted process id: when that process runs and its idle rule reads it
// busy at `at`, the host skips the spawn and records a skipped run.
export interface PendingSpawn {
  at: number;
  spawn: HostedSpawn;
  record: unknown;
  skipWhileBusy: string | null;
}
// Frozen: never change this shape; a newer host imports an older host's `runsFile`. A run the host started or skipped
// from a pending entry. `id` is the entry's `spawn.id`; `startedAt` is when the host spawned or skipped it; `exit` is
// null while it runs and for a skipped run, and holds `error` for a spawn that failed.
export interface HostedRun {
  id: string;
  record: unknown;
  startedAt: number;
  skipped: boolean;
  exit: HostedExit | null;
}
export interface HostedProcessEvents {
  line(line: PipeLine): void; // live `out` and `err` lines only; `in` lines are logged, never echoed
  closed(exit: HostedExit): void; // once; `error` is set when the spawn failed
  // Once, to the events `spawn` was given, when the OS reports the process's pid; never to an `attach`'s events.
  spawned(pid: number): void;
}
export interface HostedProcess {
  readonly id: string;
  readonly pid: number | null; // the OS pid once the host reports it; null before and after the process runs
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
  // Replaces every pending entry this app sent before. The client keeps the last list and sends it again on each
  // connect, so a new host takes it over.
  setPending(entries: readonly PendingSpawn[]): void;
  // Every run the current host started or skipped that no `forgetRuns` dropped, oldest first. Rejects as `list` does.
  listRuns(): Promise<HostedRun[]>;
  // Drops the runs with these ids from the host's runs record.
  forgetRuns(ids: readonly string[]): void;
  // Hears each run the host starts or skips while this app is connected.
  onRunStarted(listener: (run: HostedRun) => void): Disposable;
  // Hears each time the client connects to a host after its first connect: a new host after a host death, an update
  // or a login start. Runs the host started while no app was connected reach the app only through `listRuns`.
  onConnected(listener: () => void): Disposable;
}
