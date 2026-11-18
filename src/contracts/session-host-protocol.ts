import type {
  HostedExit,
  HostedRun,
  HostedSpawn,
  PendingSpawn,
  PipeLine,
} from './session-host';

// The version of the wire between an app and its session host, newline JSON. Any
// shape change below that an app and a host both read needs a bump, once one has shipped.
export const SESSION_HOST_PROTOCOL = 4;

// Frozen: never change this shape. Asks a host for its protocol version.
export interface HelloMessage {
  type: 'hello';
  requestId: number;
}
// Frozen: never change this shape. The host's protocol version, answering the `hello` with `requestId`.
export interface HelloReply {
  type: 'hello';
  requestId: number;
  protocol: number;
}
// Frozen: never change this shape. Asks a host for every process it holds.
export interface ListMessage {
  type: 'list';
  requestId: number;
}
// Frozen: never change this shape. One process a host holds: `startedAt` is epoch ms; `running` is false once it is
// ending; `code` and `signal` are its exit, null until then; `log` is its pipe log's absolute path.
export interface ListedProcess {
  id: string;
  startedAt: number;
  running: boolean;
  code: number | null;
  signal: string | null;
  log: string;
}
// Frozen: never change this shape. Every process the host holds, answering the `list` with `requestId`.
export interface ListReply {
  type: 'list';
  requestId: number;
  processes: ListedProcess[];
}
// Frozen: never change this shape, or that it gets no reply. Tells a host to drain; it carries nothing.
export interface DrainMessage {
  type: 'drain';
}
// Frozen: never change this shape. One line of a pipe log file, one JSON object per line: a `PipeLine` as stored.
export interface PipeLogRecord {
  seq: number;
  dir: 'in' | 'out' | 'err';
  at: number;
  text: string;
}
// Frozen: never change this shape. The file `host-v<protocol>.json` in the host folder, written by the host once it
// listens: the protocol it speaks, the channel it listens on, its process id.
export interface SessionHostRecord {
  protocol: number;
  channel: string;
  pid: number;
}

// Versioned: the messages below may change with SESSION_HOST_PROTOCOL.

// A host's wait at each step of ending a process, and from a process's exit to destroying pipes still held open.
export const HOST_END_GRACE_MS = 3000;

// Asks the host to start the process `request` describes.
export interface SpawnMessage {
  type: 'spawn';
  request: HostedSpawn;
}
// One line for process `id`'s stdin, without its newline.
export interface WriteMessage {
  type: 'write';
  id: string;
  text: string;
}
// Asks the host to close process `id`'s stdin.
export interface EndInputMessage {
  type: 'endInput';
  id: string;
}
// Asks the host to send `signal` to process `id`.
export interface KillMessage {
  type: 'kill';
  id: string;
  signal: 'SIGTERM' | 'SIGKILL';
}
// Asks for process `id`'s live `line` and `closed` events on this connection.
export interface SubscribeMessage {
  type: 'subscribe';
  requestId: number;
  id: string;
}
// Answers the `subscribe` with `requestId`: `running` is whether process `id` runs and is not ending; `log` its pipe
// log's absolute path. A null `log` means this connection was not subscribed: with `running` false the host holds no
// such running process; with `running` true the log is incomplete, since an append failed. `pid` is the process's OS
// pid while `running` is true and the host knows it; null otherwise.
export interface SubscribeReply {
  type: 'subscribe';
  requestId: number;
  id: string;
  running: boolean;
  log: string | null;
  pid: number | null;
}
// Asks to stop process `id`'s events on this connection.
export interface UnsubscribeMessage {
  type: 'unsubscribe';
  id: string;
}
// The keep window for idle processes while no app is connected, in minutes.
export interface SetKeepIdleMessage {
  type: 'setKeepIdle';
  minutes: number;
}
// Asks the host to stop every process it holds.
export interface StopAllMessage {
  type: 'stopAll';
  requestId: number;
}
// Answers the `stopAll` with `requestId`.
export interface StopAllReply {
  type: 'stopAll';
  requestId: number;
}
// A live `out` or `err` line of process `id`.
export interface LineEvent {
  type: 'line';
  id: string;
  line: PipeLine;
}
// Process `id` closed with `exit`.
export interface ClosedEvent {
  type: 'closed';
  id: string;
  exit: HostedExit;
}
// Process `id` started as OS process `pid`; sent only to the connection that spawned it.
export interface SpawnedEvent {
  type: 'spawned';
  id: string;
  pid: number;
}
// Replaces every pending entry the app sent before.
export interface SetPendingMessage {
  type: 'setPending';
  entries: PendingSpawn[];
}
// Asks for every run the host started or skipped that no `forgetRuns` dropped.
export interface ListRunsMessage {
  type: 'listRuns';
  requestId: number;
}
// Answers the `listRuns` with `requestId`, oldest run first.
export interface ListRunsReply {
  type: 'listRuns';
  requestId: number;
  runs: HostedRun[];
}
// Drops the runs with these ids from the host's runs record.
export interface ForgetRunsMessage {
  type: 'forgetRuns';
  ids: string[];
}
// Pushed to every connected client when the host starts or skips a pending entry.
export interface RunStartedEvent {
  type: 'runStarted';
  run: HostedRun;
}

// Every message an app sends a host.
export type ClientMessage =
  | HelloMessage
  | ListMessage
  | DrainMessage
  | SpawnMessage
  | WriteMessage
  | EndInputMessage
  | KillMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | SetKeepIdleMessage
  | StopAllMessage
  | SetPendingMessage
  | ListRunsMessage
  | ForgetRunsMessage;
// Every message a host sends an app.
export type HostMessage =
  | HelloReply
  | ListReply
  | SubscribeReply
  | StopAllReply
  | LineEvent
  | ClosedEvent
  | SpawnedEvent
  | ListRunsReply
  | RunStartedEvent;

const HOST_RECORD_NAME = /^host-v(\d+)\.json$/;
const RUNS_FILE_NAME = /^runs-v(\d+)\.json$/;
const HOST_CHILDREN_NAME = /^host-v\d+\.\d+\.children\.json$/;
const PIPE_LOG_NAME_CHARACTER = /[a-z0-9._-]/;

// Frozen: never change this name. The host folder's subfolder holding the pipe logs.
export const HOST_LOGS_FOLDER = 'logs';

// Frozen: never change this shape. The name of a host's `SessionHostRecord` file in the host folder.
export function hostRecordFile(protocol: number): string {
  return `host-v${protocol}.json`;
}

// Frozen: never change this shape. The name of a host's own log file in the host folder.
export function hostLogFile(protocol: number): string {
  return `host-v${protocol}.log`;
}

// The name the next host gives a `hostLogFile`, keeping a dead host's last words.
export function previousHostLogFile(protocol: number): string {
  return `host-v${protocol}.previous.log`;
}

// Frozen: never change this shape. The file in the host folder where host `pid` records its children, for a later host
// of any protocol to end what it leaves. Each host has its own, so none can overwrite another's.
export function hostChildrenFile(protocol: number, pid: number): string {
  return `host-v${protocol}.${pid}.children.json`;
}

// Frozen: never change this rule. Whether a file in the host folder is a `hostChildrenFile`.
export function isHostChildrenFile(fileName: string): boolean {
  return HOST_CHILDREN_NAME.test(fileName);
}

// One process on a `HostChildrenRecord`. Frozen with it.
export interface RecordedHostChild {
  pid: number;
  // As `OsProcesses.report` gives it, and compared whole, so its format is frozen too.
  startedAt: string;
  command: string;
}

// Frozen: never change this shape. What a `hostChildrenFile` holds.
export interface HostChildrenRecord {
  writer: { pid: number; startedAt: string };
  children: RecordedHostChild[];
}

// Frozen: never change this shape. The protocol a `hostRecordFile` name holds; null for any other name.
export function hostRecordProtocol(fileName: string): number | null {
  const match = HOST_RECORD_NAME.exec(fileName);
  return match === null ? null : Number(match[1]);
}

// The host folder's pending table of host protocol `protocol`, holding `PendingSpawn[]`. Not frozen: a drain drops it.
export function pendingFile(protocol: number): string {
  return `pending-v${protocol}.json`;
}

// Frozen: never change this name; a newer host imports an older host's runs. The host folder's runs record of host
// protocol `protocol`, holding `HostedRun[]`.
export function runsFile(protocol: number): string {
  return `runs-v${protocol}.json`;
}

// Frozen: never change this shape. The protocol a `runsFile` name holds; null for any other name.
export function runsFileProtocol(fileName: string): number | null {
  const match = RUNS_FILE_NAME.exec(fileName);
  return match === null ? null : Number(match[1]);
}

// Frozen: never change this name rule. The name of process `id`'s pipe log in `HOST_LOGS_FOLDER`: each character in
// `[a-z0-9._-]` kept, every other UTF-8 byte as `%` and two uppercase hex digits.
export function pipeLogFile(id: string): string {
  let name = '';
  for (const byte of new TextEncoder().encode(id)) {
    const character = String.fromCharCode(byte);
    name += PIPE_LOG_NAME_CHARACTER.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `${name}.jsonl`;
}
