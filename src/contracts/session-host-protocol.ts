import type { HostedExit, HostedSpawn, PipeLine } from './session-host';

// The version of the wire between an app and its session host, newline JSON. Any
// shape change below that an app and a host both read needs a bump, once one has shipped.
export const SESSION_HOST_PROTOCOL = 1;

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
// Frozen: never change this shape. One process a host holds: `startedAt` is epoch ms; `code` and `signal` are its
// exit, null while it runs; `log` is its pipe log's absolute path.
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
// Answers the `subscribe` with `requestId`: `running` is whether process `id` runs; `log` its pipe log's absolute path,
// null when the host holds no such process.
export interface SubscribeReply {
  type: 'subscribe';
  requestId: number;
  id: string;
  running: boolean;
  log: string | null;
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
  | StopAllMessage;
// Every message a host sends an app.
export type HostMessage =
  | HelloReply
  | ListReply
  | SubscribeReply
  | StopAllReply
  | LineEvent
  | ClosedEvent;

const HOST_RECORD_NAME = /^host-v(\d+)\.json$/;
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

// Frozen: never change this shape. The protocol a `hostRecordFile` name holds; null for any other name.
export function hostRecordProtocol(fileName: string): number | null {
  const match = HOST_RECORD_NAME.exec(fileName);
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
