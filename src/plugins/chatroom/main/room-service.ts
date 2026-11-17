import type { Clock, RandomHex } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import { isJsonObject, isStringArray } from '../../../shared/json';
import { compareText } from '../../../shared/key-hints';
import { createListeners } from '../../../shared/listeners';
import {
  createSerialQueue,
  type SerialQueue,
} from '../../../shared/serial-queue';
import {
  type ChatroomMirror,
  type Claim,
  type ClaimTarget,
  ENTRY_KINDS,
  type EntryKind,
  type MessageRef,
  type NewMessage,
  type Participant,
  participantKey,
  POST_KINDS,
  type PostKind,
  type RoomMessage,
  type RoomStore,
  USER_PARTICIPANT,
} from '../contract';
import { claimPathsOverlap, normalizeClaimPath } from './claim-paths';

export interface ChatroomLimits {
  readonly bodyCap: number;
  readonly postsPerMinute: number;
  readonly claimMinutes: number;
}

// `limits` is read at each call, so a settings change applies to the next
// one. `participants` returns the main agents of the room's live sessions and
// `USER_PARTICIPANT`: the only participants a post may name in `to`.
export interface RoomServiceDeps {
  readonly store: RoomStore;
  readonly files: Pick<Files, 'read' | 'write'>;
  readonly clock: Clock;
  readonly randomHex: RandomHex;
  limits(): ChatroomLimits;
  participants(room: string): readonly Participant[];
  readonly log: PluginLog;
}

// `to` holds participant names; `thread` null takes the `replyTo` message's
// thread, else `session:<rowId>` for an agent, else `general`.
export interface PostRequest {
  readonly room: string;
  readonly from: Participant;
  readonly kind: PostKind;
  readonly body: string;
  readonly to: readonly string[];
  readonly thread: string | null;
  readonly refs: readonly MessageRef[];
  readonly replyTo: number | null;
  readonly answerBy: number | null;
  readonly onNoAnswer: string | null;
  readonly key: string | null;
}

export type HumanPostRequest = Omit<PostRequest, 'from'>;

export type PostResult =
  | {
      readonly ok: true;
      readonly id: number;
      readonly thread: string;
      readonly duplicate: boolean;
    }
  | { readonly ok: false; readonly reason: string };

export interface EntryRequest {
  readonly room: string;
  readonly thread: string;
  readonly from: Participant;
  readonly kind: EntryKind;
  readonly body: string;
  readonly refs: readonly MessageRef[];
}

export type ReadQuery =
  | { readonly kind: 'unread' }
  | { readonly kind: 'thread'; readonly thread: string }
  | { readonly kind: 'message'; readonly id: number };

// `from` and `to` are participant names. `text` is the first non-blank line,
// cut, for an unread read, and the whole body otherwise.
export interface ReadItem {
  readonly id: number;
  readonly thread: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly kind: PostKind | EntryKind;
  readonly text: string;
  readonly refs: readonly MessageRef[];
  readonly replyTo: number | null;
  readonly answerBy: number | null;
  readonly onNoAnswer: string | null;
  readonly at: number;
}

export type ReadResult =
  | { readonly ok: true; readonly items: readonly ReadItem[] }
  | { readonly ok: false; readonly reason: string };

export interface ThreadSummary {
  readonly thread: string;
  readonly resolved: boolean;
  readonly count: number;
  readonly lastId: number;
  readonly lastAt: number;
}

// `minutes` null takes the `claimMinutes` limit.
export interface ClaimRequest {
  readonly room: string;
  readonly holder: Participant;
  readonly target: ClaimTarget;
  readonly reason: string;
  readonly minutes: number | null;
}

// `overlaps` holds the live claims of other sessions the new claim touches.
export type ClaimResult =
  | {
      readonly ok: true;
      readonly claim: Claim;
      readonly overlaps: readonly Claim[];
    }
  | { readonly ok: false; readonly reason: string };

export type ReleaseResult =
  | { readonly ok: true; readonly released: readonly Claim[] }
  | { readonly ok: false; readonly reason: string };

// The one writer of the rooms. Per room, `post`, `postHuman`, `addEntry` and
// the unread read run one at a time in call order. Agents' cursors, the user's
// cursors, resolved threads and claims live in `cursors.json`,
// `user-cursors.json`, `threads.json` and `claims.json` in plugin data, read at
// first use and written whole on each change; a write that fails is logged and
// the state kept in memory. Claims are advisory and never block.
export interface RoomService {
  // Refuses, writing nothing, a post a check or guard holds back; a retry
  // with an accepted post's `key` returns that post's id as a duplicate.
  post(request: PostRequest): Promise<PostResult>;
  // A post from `USER_PARTICIPANT`, the user's word, uncapped.
  postHuman(request: HumanPostRequest): Promise<PostResult>;
  // Writes an entry with no check, its body cut to the body cap; rejects when
  // the store does.
  addEntry(entry: EntryRequest): Promise<RoomMessage>;
  // An unread read moves the reader's cursor; a thread or message read does
  // not.
  read(
    room: string,
    reader: Participant,
    query: ReadQuery,
  ): Promise<ReadResult>;
  // The unread messages that name the reader, or carry the user's word to an
  // open thread the reader takes part in; moves no cursor.
  unreadAddressed(room: string, reader: Participant): Promise<RoomMessage[]>;
  // Posts above the user's cursor of their thread, the user's own left out.
  userUnread(room: string): Promise<RoomMessage[]>;
  // Moves the thread's user cursor up to `upToId`, never down.
  markUserRead(room: string, thread: string, upToId: number): Promise<void>;
  rooms(): Promise<string[]>;
  messages(room: string, afterId: number): Promise<RoomMessage[]>;
  // One per thread holding a message, newest `lastId` first.
  threads(room: string): Promise<ThreadSummary[]>;
  // Resolves any thread name, one with no message included; the next post
  // there opens it again.
  resolveThread(room: string, thread: string): Promise<void>;
  // Renews the holder's claim on an equal target, keeping its id.
  claim(request: ClaimRequest): Promise<ClaimResult>;
  // `claimId` null ends every claim of the holder in the room.
  release(
    room: string,
    holder: Participant,
    claimId: string | null,
  ): Promise<ReleaseResult>;
  claims(room: string): Promise<Claim[]>;
  // The live claims overlapping `target` held by a session other than the
  // asker's; writes nothing.
  claimsTouching(
    room: string,
    target: ClaimTarget,
    asker: Participant,
  ): Promise<Claim[]>;
  // Ends every claim the session row holds, in every room.
  endClaimsOf(rowId: string): Promise<Claim[]>;
  // The mirror hears every new message but its own human posts, and its
  // human posts arrive as notes, the user's word only when it is `verified`.
  addMirror(mirror: ChatroomMirror): Disposable;
  // Hears every new message, after it is stored, before any mirror does.
  onMessage(listener: (message: RoomMessage) => void): Disposable;
  // Resolves once every queued append, file write and mirror publish has
  // settled; never rejects.
  settled(): Promise<void>;
}

const CURSORS_FILE = 'cursors.json';
const USER_CURSORS_FILE = 'user-cursors.json';
const THREADS_FILE = 'threads.json';
const CLAIMS_FILE = 'claims.json';

const IDENTICAL_BODY_WINDOW_MS = 120_000;
const RATE_WINDOW_MS = 60_000;
const MINUTE_MS = 60_000;
const MAX_THREAD_LENGTH = 80;
const READ_LINE_LENGTH = 200;
const GENERAL_THREAD = 'general';
const LINE_BREAK = /[\r\n]/;

const REF_TYPES: readonly MessageRef['type'][] = [
  'file',
  'branch',
  'commit',
  'plan',
  'message',
];

const PARTICIPANT_KINDS: readonly Participant['kind'][] = [
  'agent',
  'human',
  'system',
  'mirror',
];

const USER_KEY = participantKey(USER_PARTICIPANT);

type Refusal = { readonly ok: false; readonly reason: string };

function refused(reason: string): Refusal {
  return { ok: false, reason };
}

function isPostKind(kind: string): kind is PostKind {
  return (POST_KINDS as readonly string[]).includes(kind);
}

function isEntryKind(kind: string): kind is EntryKind {
  return (ENTRY_KINDS as readonly string[]).includes(kind);
}

// A post an agent reads as talk: not an entry and not a `progress`.
function isTalk(message: RoomMessage): boolean {
  return isPostKind(message.kind) && message.kind !== 'progress';
}

function characterCount(text: string): number {
  return Array.from(text).length;
}

// `text` when it holds at most `max` characters, else its first `max - 1`
// and `…`.
function cutTo(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max
    ? text
    : characters.slice(0, max - 1).join('') + '…';
}

function firstLine(body: string): string {
  const line = body.split(/\r?\n/).find((each) => each.trim() !== '') ?? '';
  return cutTo(line.trim(), READ_LINE_LENGTH);
}

function nameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

function names(message: RoomMessage, key: string): boolean {
  return message.to.some((target) => participantKey(target) === key);
}

function readItem(message: RoomMessage, text: string): ReadItem {
  return {
    id: message.id,
    thread: message.thread,
    from: message.from.name,
    to: message.to.map((target) => target.name),
    kind: message.kind,
    text,
    refs: message.refs,
    replyTo: message.replyTo,
    answerBy: message.answerBy,
    onNoAnswer: message.onNoAnswer,
    at: message.at,
  };
}

function kindRefusal(kind: string): string | null {
  if (isPostKind(kind)) {
    return null;
  }
  const kinds = POST_KINDS.join(', ');
  return isEntryKind(kind)
    ? `${kind} is an entry the app writes; post one of ${kinds}`
    : `${kind} is not a kind; post one of ${kinds}`;
}

function bodyRefusal(body: string, bodyCap: number): string | null {
  if (body.trim() === '') {
    return 'body is empty';
  }
  const length = characterCount(body);
  return length > bodyCap
    ? `body is ${length} characters, over the cap of ${bodyCap}: put the content in a file and post its path with a short summary`
    : null;
}

function refsRefusal(refs: readonly MessageRef[]): string | null {
  for (const ref of refs) {
    if (!REF_TYPES.includes(ref.type)) {
      return `ref type ${ref.type} is not one of ${REF_TYPES.join(', ')}`;
    }
    if (ref.value.trim() === '') {
      return `a ${ref.type} ref has an empty value`;
    }
  }
  return null;
}

function questionRefusal(request: PostRequest, now: number): string | null {
  const isQuestion = request.kind === 'question';
  if (isQuestion && request.to.length === 0) {
    return 'a question names at least one participant in to';
  }
  if (!isQuestion && request.answerBy !== null) {
    return 'answerBy is only for a question';
  }
  if (!isQuestion && request.onNoAnswer !== null) {
    return 'onNoAnswer is only for a question';
  }
  if (request.answerBy !== null && request.answerBy <= now) {
    return 'answerBy must be later than now';
  }
  return null;
}

// Each name to the one participant it names, each participant once, in the
// order of first appearance.
function resolvedTargets(
  to: readonly string[],
  participants: readonly Participant[],
  from: Participant,
): { readonly ok: true; readonly targets: Participant[] } | Refusal {
  const roster = participants.map((participant) => participant.name);
  const fromKey = participantKey(from);
  const targets: Participant[] = [];
  for (const name of to) {
    const matches = participants.filter(
      (participant) => nameKey(participant.name) === nameKey(name),
    );
    if (matches.length !== 1) {
      const problem =
        matches.length === 0
          ? `no participant named "${name}"`
          : `"${name}" names ${matches.length} participants`;
      return refused(`${problem}; the room holds: ${roster.join(', ')}`);
    }
    const key = participantKey(matches[0]);
    if (from.kind === 'agent' && key === fromKey) {
      return refused('you cannot address yourself');
    }
    if (!targets.some((target) => participantKey(target) === key)) {
      targets.push(matches[0]);
    }
  }
  return { ok: true, targets };
}

function chosenThread(
  request: PostRequest,
  repliedTo: RoomMessage | null,
): { readonly ok: true; readonly thread: string } | Refusal {
  if (request.thread !== null) {
    const thread = request.thread.trim();
    const length = characterCount(thread);
    const fits =
      length >= 1 && length <= MAX_THREAD_LENGTH && !LINE_BREAK.test(thread);
    return fits
      ? { ok: true, thread }
      : refused(
          `thread must be 1 to ${MAX_THREAD_LENGTH} characters with no line break`,
        );
  }
  if (repliedTo !== null) {
    return { ok: true, thread: repliedTo.thread };
  }
  return {
    ok: true,
    thread:
      request.from.kind === 'agent'
        ? `session:${request.from.rowId}`
        : GENERAL_THREAD,
  };
}

// Checks 3 to 8: what the post may hold, its targets and its thread.
function checkedPost(
  request: PostRequest,
  messages: readonly RoomMessage[],
  now: number,
  bodyCap: number,
  participants: readonly Participant[],
):
  | { readonly ok: true; readonly thread: string; readonly to: Participant[] }
  | Refusal {
  const contentRefusal =
    bodyRefusal(request.body, bodyCap) ?? refsRefusal(request.refs);
  if (contentRefusal !== null) {
    return refused(contentRefusal);
  }
  const repliedTo =
    request.replyTo === null
      ? null
      : (messages.find((message) => message.id === request.replyTo) ?? null);
  if (request.replyTo !== null && repliedTo === null) {
    return refused(`no message #${request.replyTo} in ${request.room}`);
  }
  if (request.kind === 'answer' && repliedTo === null) {
    return refused('an answer must set replyTo');
  }
  const askRefusal = questionRefusal(request, now);
  if (askRefusal !== null) {
    return refused(askRefusal);
  }
  const targets = resolvedTargets(request.to, participants, request.from);
  if (!targets.ok) {
    return targets;
  }
  const thread = chosenThread(request, repliedTo);
  if (!thread.ok) {
    return thread;
  }
  return { ok: true, thread: thread.thread, to: targets.targets };
}

// Checks 9 and 10, for agent and mirror senders: the identical-body drop and
// the rate cap, counting only the sender's posts.
function guardHold(
  senderKey: string,
  body: string,
  messages: readonly RoomMessage[],
  now: number,
  postsPerMinute: number,
): string | null {
  const sent = messages.filter(
    (message) =>
      isPostKind(message.kind) && participantKey(message.from) === senderKey,
  );
  const repeat = sent.findLast(
    (message) =>
      message.body === body && now - message.at < IDENTICAL_BODY_WINDOW_MS,
  );
  if (repeat !== undefined) {
    const seconds = Math.floor((now - repeat.at) / 1000);
    return `dropped: the same body was posted as #${repeat.id} ${seconds} seconds ago`;
  }
  const recent = sent.filter((message) => message.at > now - RATE_WINDOW_MS);
  if (recent.length < postsPerMinute) {
    return null;
  }
  const oldestAt = Math.min(...recent.map((message) => message.at));
  const wait = Math.ceil((oldestAt + RATE_WINDOW_MS - now) / 1000);
  return `rate cap: ${postsPerMinute} posts a minute; wait ${wait} seconds`;
}

// The threads `reader` takes part in: where it posted talk, where a message
// names it, and a main agent's own `session:<rowId>`.
function threadsTakenPartIn(
  messages: readonly RoomMessage[],
  reader: Participant,
): Set<string> {
  const readerKey = participantKey(reader);
  const threads = new Set<string>();
  if (reader.kind === 'agent' && reader.agentId === null) {
    threads.add(`session:${reader.rowId}`);
  }
  for (const message of messages) {
    const talkedThere =
      isTalk(message) && participantKey(message.from) === readerKey;
    if (talkedThere || names(message, readerKey)) {
      threads.add(message.thread);
    }
  }
  return threads;
}

// What an agent's reads look at: the talk above its cursor from others, with
// the threads it takes part in and the room's resolved threads.
interface ReaderView {
  readonly readerKey: string;
  readonly unseen: readonly RoomMessage[];
  readonly takingPart: ReadonlySet<string>;
  readonly resolved: ReadonlySet<string>;
}

function readerView(
  messages: readonly RoomMessage[],
  reader: Participant,
  cursor: number,
  resolved: ReadonlySet<string>,
): ReaderView {
  const readerKey = participantKey(reader);
  return {
    readerKey,
    unseen: messages.filter(
      (message) =>
        message.id > cursor &&
        isTalk(message) &&
        participantKey(message.from) !== readerKey,
    ),
    takingPart: threadsTakenPartIn(messages, reader),
    resolved,
  };
}

function isInOpenThreadOf(view: ReaderView, message: RoomMessage): boolean {
  return (
    !view.resolved.has(message.thread) && view.takingPart.has(message.thread)
  );
}

function unreadOf(view: ReaderView): RoomMessage[] {
  return view.unseen.filter(
    (message) =>
      names(message, view.readerKey) || isInOpenThreadOf(view, message),
  );
}

function addressedOf(view: ReaderView): RoomMessage[] {
  return view.unseen.filter((message) => {
    const isUserWordToThread = message.userWord && message.to.length === 0;
    return (
      names(message, view.readerKey) ||
      (isUserWordToThread && isInOpenThreadOf(view, message))
    );
  });
}

function threadSummaries(
  messages: readonly RoomMessage[],
  resolved: ReadonlySet<string>,
): ThreadSummary[] {
  const summaries = new Map<string, ThreadSummary>();
  for (const message of messages) {
    const count = (summaries.get(message.thread)?.count ?? 0) + 1;
    summaries.set(message.thread, {
      thread: message.thread,
      resolved: resolved.has(message.thread),
      count,
      lastId: message.id,
      lastAt: message.at,
    });
  }
  return [...summaries.values()].sort((a, b) => b.lastId - a.lastId);
}

function checkedTarget(
  target: ClaimTarget,
): { readonly ok: true; readonly target: ClaimTarget } | Refusal {
  if ('paths' in target) {
    if (target.paths.length === 0) {
      return refused('a paths claim names at least one path');
    }
    const paths = new Set<string>();
    for (const path of target.paths) {
      const normalized = normalizeClaimPath(path);
      if (normalized === null) {
        return refused(`${path} is not a repo-relative path`);
      }
      paths.add(normalized);
    }
    return { ok: true, target: { paths: [...paths].sort(compareText) } };
  }
  if ('branch' in target) {
    const branch = target.branch.trim();
    return branch === ''
      ? refused('a branch claim names a branch')
      : { ok: true, target: { branch } };
  }
  const resource = target.resource.trim();
  return resource === ''
    ? refused('a resource claim names a resource')
    : { ok: true, target: { resource } };
}

function claimRefusal(request: ClaimRequest): string | null {
  if (request.reason.trim() === '') {
    return 'a claim needs a reason';
  }
  const { minutes } = request;
  if (minutes !== null && !(Number.isFinite(minutes) && minutes > 0)) {
    return `minutes is ${minutes}: give a number above 0, or none for the default`;
  }
  return null;
}

function sameTarget(a: ClaimTarget, b: ClaimTarget): boolean {
  if ('paths' in a && 'paths' in b) {
    return (
      a.paths.length === b.paths.length &&
      a.paths.every((path, index) => path === b.paths[index])
    );
  }
  if ('branch' in a && 'branch' in b) {
    return a.branch === b.branch;
  }
  return 'resource' in a && 'resource' in b && a.resource === b.resource;
}

function targetsOverlap(a: ClaimTarget, b: ClaimTarget): boolean {
  if ('paths' in a && 'paths' in b) {
    return claimPathsOverlap(a.paths, b.paths);
  }
  return sameTarget(a, b);
}

// A target as asked, its paths normalized and the unusable ones left out.
function askedTarget(target: ClaimTarget): ClaimTarget {
  if (!('paths' in target)) {
    return target;
  }
  return {
    paths: target.paths
      .map(normalizeClaimPath)
      .filter((path) => path !== null),
  };
}

function overlapping(
  claims: Iterable<Claim>,
  room: string,
  target: ClaimTarget,
  asker: Participant,
): Claim[] {
  return [...claims].filter(
    (claim) =>
      claim.room === room &&
      claim.holder.rowId !== asker.rowId &&
      targetsOverlap(claim.target, target),
  );
}

// A parsed file's state, and whether an entry of the wrong shape was dropped.
interface Parsed<T> {
  readonly value: T;
  readonly droppedEntry: boolean;
}

interface StateShape<T> {
  empty(): T;
  // null when `json` is not of the file's shape.
  parsed(json: unknown): Parsed<T> | null;
  json(value: T): unknown;
}

// One JSON file in plugin data: read at the first `value`, written whole on
// each `save`, one write at a time. A read that rejects caches nothing.
interface SavedState<T> {
  value(): Promise<T>;
  save(value: T): void;
  settled(): Promise<void>;
}

// room → (participant key, or thread for the user) → last read id.
type Cursors = Map<string, Map<string, number>>;
// room → resolved threads.
type ResolvedThreads = Map<string, Set<string>>;
// claim id → claim.
type Claims = Map<string, Claim>;

const CURSORS_SHAPE: StateShape<Cursors> = {
  empty: () => new Map(),
  parsed(json) {
    if (!isJsonObject(json)) {
      return null;
    }
    let droppedEntry = false;
    const cursors: Cursors = new Map();
    for (const [room, ids] of Object.entries(json)) {
      if (!isJsonObject(ids)) {
        droppedEntry = true;
        continue;
      }
      const roomCursors = new Map<string, number>();
      for (const [key, id] of Object.entries(ids)) {
        if (Number.isInteger(id)) {
          roomCursors.set(key, id as number);
        } else {
          droppedEntry = true;
        }
      }
      cursors.set(room, roomCursors);
    }
    return { value: cursors, droppedEntry };
  },
  json: (cursors) =>
    Object.fromEntries(
      [...cursors].map(([room, ids]) => [room, Object.fromEntries(ids)]),
    ),
};

const RESOLVED_THREADS_SHAPE: StateShape<ResolvedThreads> = {
  empty: () => new Map(),
  parsed(json) {
    if (!isJsonObject(json)) {
      return null;
    }
    let droppedEntry = false;
    const resolved: ResolvedThreads = new Map();
    for (const [room, threads] of Object.entries(json)) {
      if (isStringArray(threads)) {
        resolved.set(room, new Set(threads));
      } else {
        droppedEntry = true;
      }
    }
    return { value: resolved, droppedEntry };
  },
  json: (resolved) =>
    Object.fromEntries(
      [...resolved].map(([room, threads]) => [room, [...threads]]),
    ),
};

const CLAIMS_SHAPE: StateShape<Claims> = {
  empty: () => new Map(),
  parsed(json) {
    if (!Array.isArray(json)) {
      return null;
    }
    const whole = json.filter(isClaim);
    return {
      value: new Map(whole.map((claim) => [claim.id, claim])),
      droppedEntry: whole.length !== json.length,
    };
  },
  json: (claims) => [...claims.values()],
};

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isParticipant(value: unknown): value is Participant {
  return (
    isJsonObject(value) &&
    PARTICIPANT_KINDS.includes(value.kind as Participant['kind']) &&
    isStringOrNull(value.rowId) &&
    isStringOrNull(value.agentId) &&
    isStringOrNull(value.mirrorId) &&
    typeof value.name === 'string'
  );
}

function isClaimTarget(value: unknown): value is ClaimTarget {
  if (!isJsonObject(value)) {
    return false;
  }
  if ('paths' in value) {
    return isStringArray(value.paths);
  }
  if ('branch' in value) {
    return typeof value.branch === 'string';
  }
  return typeof value.resource === 'string';
}

function isClaim(value: unknown): value is Claim {
  return (
    isJsonObject(value) &&
    typeof value.id === 'string' &&
    typeof value.room === 'string' &&
    isParticipant(value.holder) &&
    isClaimTarget(value.target) &&
    typeof value.reason === 'string' &&
    typeof value.expiresAt === 'number'
  );
}

function createSavedState<T>(
  deps: Pick<RoomServiceDeps, 'files' | 'log'>,
  file: string,
  shape: StateShape<T>,
  onQueued: () => void,
): SavedState<T> {
  const writes = createSerialQueue();
  let loading: Promise<T> | null = null;

  const load = async (): Promise<T> => {
    const text = await readIfPresent(deps.files, file);
    if (text === null) {
      return shape.empty();
    }
    let parsed: Parsed<T> | null;
    try {
      parsed = shape.parsed(JSON.parse(text));
    } catch {
      parsed = null;
    }
    if (parsed === null || parsed.droppedEntry) {
      deps.log(`${file} unreadable, starting empty`);
    }
    return parsed?.value ?? shape.empty();
  };

  return {
    value() {
      if (loading === null) {
        const started = load();
        loading = started;
        void started.catch(() => {
          if (loading === started) {
            loading = null;
          }
        });
      }
      return loading;
    },
    save(value) {
      const text = JSON.stringify(shape.json(value));
      onQueued();
      void writes
        .run(() => deps.files.write(file, text))
        .catch((error) => deps.log(`${file} not saved: ${errorText(error)}`));
    },
    settled: () => writes.settled(),
  };
}

export function createRoomService(deps: RoomServiceDeps): RoomService {
  const roomQueues = new Map<string, SerialQueue>();
  const messageListeners = createListeners<RoomMessage>();
  const mirrors = new Set<{ readonly mirror: ChatroomMirror }>();
  const publishing = new Set<Promise<void>>();
  // Counts every queued piece of work and publish, so `settled` sees work
  // started while it waits.
  let startedWork = 0;
  const countWork = () => {
    startedWork += 1;
  };

  const agentCursors = createSavedState(
    deps,
    CURSORS_FILE,
    CURSORS_SHAPE,
    countWork,
  );
  const userCursors = createSavedState(
    deps,
    USER_CURSORS_FILE,
    CURSORS_SHAPE,
    countWork,
  );
  const resolvedThreads = createSavedState(
    deps,
    THREADS_FILE,
    RESOLVED_THREADS_SHAPE,
    countWork,
  );
  const savedClaims = createSavedState(
    deps,
    CLAIMS_FILE,
    CLAIMS_SHAPE,
    countWork,
  );
  const savedStates = [agentCursors, userCursors, resolvedThreads, savedClaims];

  const inRoomTurn = <T>(room: string, work: () => Promise<T>): Promise<T> => {
    let queue = roomQueues.get(room);
    if (queue === undefined) {
      queue = createSerialQueue();
      roomQueues.set(room, queue);
    }
    countWork();
    return queue.run(work);
  };

  const resolvedIn = async (room: string): Promise<ReadonlySet<string>> =>
    (await resolvedThreads.value()).get(room) ?? new Set();

  const reopenThread = async (room: string, thread: string) => {
    const resolved = await resolvedThreads.value();
    const threads = resolved.get(room);
    if (threads === undefined || !threads.delete(thread)) {
      return;
    }
    if (threads.size === 0) {
      resolved.delete(room);
    }
    resolvedThreads.save(resolved);
  };

  const publishTo = (mirror: ChatroomMirror, message: RoomMessage) => {
    countWork();
    const published = (async () => mirror.publish(message))().catch((error) =>
      deps.log(`mirror ${mirror.id} publish failed: ${errorText(error)}`),
    );
    publishing.add(published);
    void published.finally(() => publishing.delete(published));
  };

  // Started before the call that stored `message` resolves, and not awaited.
  const fanOut = (message: RoomMessage) => {
    messageListeners.tell(message);
    for (const { mirror } of Array.from(mirrors)) {
      const isItsOwn =
        message.from.kind === 'mirror' && message.from.mirrorId === mirror.id;
      if (!isItsOwn) {
        publishTo(mirror, message);
      }
    }
  };

  // Runs inside the room's turn. `guarded` applies the identical-body drop
  // and the rate cap.
  const postInTurn = async (
    request: PostRequest,
    userWord: boolean,
    guarded: boolean,
  ): Promise<PostResult> => {
    const badKind = kindRefusal(request.kind);
    if (badKind !== null) {
      return refused(badKind);
    }
    const messages = await deps.store.read(request.room, 0);
    const senderKey = participantKey(request.from);
    const earlier =
      request.key === null
        ? undefined
        : messages.find(
            (message) =>
              message.key === request.key &&
              participantKey(message.from) === senderKey,
          );
    if (earlier !== undefined) {
      return {
        ok: true,
        id: earlier.id,
        thread: earlier.thread,
        duplicate: true,
      };
    }
    const now = deps.clock.now();
    const limits = deps.limits();
    const checked = checkedPost(
      request,
      messages,
      now,
      limits.bodyCap,
      deps.participants(request.room),
    );
    if (!checked.ok) {
      return checked;
    }
    const hold = guarded
      ? guardHold(
          senderKey,
          request.body,
          messages,
          now,
          limits.postsPerMinute,
        )
      : null;
    if (hold !== null) {
      return refused(hold);
    }
    const message: NewMessage = {
      room: request.room,
      thread: checked.thread,
      from: request.from,
      to: checked.to,
      kind: request.kind,
      body: request.body,
      refs: request.refs,
      replyTo: request.replyTo,
      answerBy: request.answerBy,
      onNoAnswer: request.onNoAnswer,
      key: request.key,
      at: now,
      userWord,
    };
    let stored: RoomMessage;
    try {
      stored = await deps.store.append(message);
    } catch (error) {
      return refused(`could not save the message: ${errorText(error)}`);
    }
    await reopenThread(stored.room, stored.thread);
    fanOut(stored);
    return {
      ok: true,
      id: stored.id,
      thread: stored.thread,
      duplicate: false,
    };
  };

  const postFromMirror = (
    mirror: ChatroomMirror,
    sender: Participant,
    room: string,
    thread: string,
    body: string,
  ) => {
    const request: PostRequest = {
      room,
      from: sender,
      kind: 'note',
      body,
      to: [],
      thread,
      refs: [],
      replyTo: null,
      answerBy: null,
      onNoAnswer: null,
      key: null,
    };
    const logRefusal = (reason: string) =>
      deps.log(`mirror ${mirror.id} post refused: ${reason}`);
    void inRoomTurn(room, async () => {
      const result = await postInTurn(request, mirror.verified, true);
      if (!result.ok) {
        logRefusal(result.reason);
      }
    }).catch((error) => logRefusal(errorText(error)));
  };

  const unreadInTurn = async (
    room: string,
    reader: Participant,
  ): Promise<ReadItem[]> => {
    const messages = await deps.store.read(room, 0);
    const cursors = await agentCursors.value();
    const readerKey = participantKey(reader);
    const roomCursors = cursors.get(room) ?? new Map<string, number>();
    const cursor = roomCursors.get(readerKey) ?? 0;
    const view = readerView(messages, reader, cursor, await resolvedIn(room));
    const items = unreadOf(view).map((message) =>
      readItem(message, firstLine(message.body)),
    );
    const highest = messages.at(-1)?.id ?? 0;
    if (highest > cursor) {
      roomCursors.set(readerKey, highest);
      cursors.set(room, roomCursors);
      agentCursors.save(cursors);
    }
    return items;
  };

  const liveClaims = async (): Promise<Claims> => {
    const claims = await savedClaims.value();
    const now = deps.clock.now();
    for (const [id, claim] of claims) {
      if (claim.expiresAt <= now) {
        claims.delete(id);
      }
    }
    return claims;
  };

  const freshClaimId = (claims: Claims): string => {
    let id = deps.randomHex();
    while (claims.has(id)) {
      id = deps.randomHex();
    }
    return id;
  };

  return {
    post: (request) =>
      inRoomTurn(request.room, () => postInTurn(request, false, true)),
    postHuman: (request) =>
      inRoomTurn(request.room, () =>
        postInTurn({ ...request, from: USER_PARTICIPANT }, true, false),
      ),
    addEntry: (entry) =>
      inRoomTurn(entry.room, async () => {
        const stored = await deps.store.append({
          room: entry.room,
          thread: entry.thread,
          from: entry.from,
          to: [],
          kind: entry.kind,
          body: cutTo(entry.body, deps.limits().bodyCap),
          refs: entry.refs,
          replyTo: null,
          answerBy: null,
          onNoAnswer: null,
          key: null,
          at: deps.clock.now(),
          userWord: false,
        });
        fanOut(stored);
        return stored;
      }),
    async read(room, reader, query) {
      if (query.kind === 'unread') {
        const items = await inRoomTurn(room, () =>
          unreadInTurn(room, reader),
        );
        return { ok: true, items };
      }
      const messages = await deps.store.read(room, 0);
      if (query.kind === 'thread') {
        return {
          ok: true,
          items: messages
            .filter((message) => message.thread === query.thread)
            .map((message) => readItem(message, message.body)),
        };
      }
      const message = messages.find((each) => each.id === query.id);
      return message === undefined
        ? refused(`no message #${query.id} in ${room}`)
        : { ok: true, items: [readItem(message, message.body)] };
    },
    async unreadAddressed(room, reader) {
      const messages = await deps.store.read(room, 0);
      const cursor =
        (await agentCursors.value()).get(room)?.get(participantKey(reader)) ??
        0;
      return addressedOf(
        readerView(messages, reader, cursor, await resolvedIn(room)),
      );
    },
    async userUnread(room) {
      const messages = await deps.store.read(room, 0);
      const cursors = (await userCursors.value()).get(room);
      return messages.filter(
        (message) =>
          isTalk(message) &&
          participantKey(message.from) !== USER_KEY &&
          message.id > (cursors?.get(message.thread) ?? 0),
      );
    },
    async markUserRead(room, thread, upToId) {
      const cursors = await userCursors.value();
      const roomCursors = cursors.get(room) ?? new Map<string, number>();
      if (upToId <= (roomCursors.get(thread) ?? 0)) {
        return;
      }
      roomCursors.set(thread, upToId);
      cursors.set(room, roomCursors);
      userCursors.save(cursors);
    },
    rooms: () => deps.store.rooms(),
    messages: (room, afterId) => deps.store.read(room, afterId),
    async threads(room) {
      return threadSummaries(
        await deps.store.read(room, 0),
        await resolvedIn(room),
      );
    },
    async resolveThread(room, thread) {
      const resolved = await resolvedThreads.value();
      const threads = resolved.get(room) ?? new Set<string>();
      if (threads.has(thread)) {
        return;
      }
      threads.add(thread);
      resolved.set(room, threads);
      resolvedThreads.save(resolved);
    },
    async claim(request) {
      const badRequest = claimRefusal(request);
      if (badRequest !== null) {
        return refused(badRequest);
      }
      const checked = checkedTarget(request.target);
      if (!checked.ok) {
        return checked;
      }
      const claims = await liveClaims();
      const holderKey = participantKey(request.holder);
      const renewed = [...claims.values()].find(
        (claim) =>
          claim.room === request.room &&
          participantKey(claim.holder) === holderKey &&
          sameTarget(claim.target, checked.target),
      );
      const minutes = request.minutes ?? deps.limits().claimMinutes;
      const claim: Claim = {
        id: renewed?.id ?? freshClaimId(claims),
        room: request.room,
        holder: request.holder,
        target: checked.target,
        reason: request.reason.trim(),
        expiresAt: deps.clock.now() + minutes * MINUTE_MS,
      };
      claims.set(claim.id, claim);
      savedClaims.save(claims);
      return {
        ok: true,
        claim,
        overlaps: overlapping(
          claims.values(),
          request.room,
          claim.target,
          request.holder,
        ),
      };
    },
    async release(room, holder, claimId) {
      const claims = await liveClaims();
      const holderKey = participantKey(holder);
      if (claimId !== null) {
        const claim = claims.get(claimId);
        if (claim === undefined || claim.room !== room) {
          return refused(`no claim ${claimId}`);
        }
        if (participantKey(claim.holder) !== holderKey) {
          return refused(`claim ${claimId} is held by ${claim.holder.name}`);
        }
        claims.delete(claimId);
        savedClaims.save(claims);
        return { ok: true, released: [claim] };
      }
      const released = [...claims.values()].filter(
        (claim) =>
          claim.room === room && participantKey(claim.holder) === holderKey,
      );
      if (released.length > 0) {
        for (const claim of released) {
          claims.delete(claim.id);
        }
        savedClaims.save(claims);
      }
      return { ok: true, released };
    },
    async claims(room) {
      return [...(await liveClaims()).values()].filter(
        (claim) => claim.room === room,
      );
    },
    async claimsTouching(room, target, asker) {
      return overlapping(
        (await liveClaims()).values(),
        room,
        askedTarget(target),
        asker,
      );
    },
    async endClaimsOf(rowId) {
      const claims = await liveClaims();
      const ended = [...claims.values()].filter(
        (claim) => claim.holder.rowId === rowId,
      );
      if (ended.length > 0) {
        for (const claim of ended) {
          claims.delete(claim.id);
        }
        savedClaims.save(claims);
      }
      return ended;
    },
    addMirror(mirror) {
      const registration = { mirror };
      mirrors.add(registration);
      const sender: Participant = {
        kind: 'mirror',
        rowId: null,
        agentId: null,
        mirrorId: mirror.id,
        name: `you via ${mirror.id}`,
      };
      const subscription = mirror.onHumanMessage((room, thread, body) => {
        if (mirrors.has(registration)) {
          postFromMirror(mirror, sender, room, thread, body);
        }
      });
      return {
        dispose: () => {
          if (mirrors.delete(registration)) {
            subscription.dispose();
          }
        },
      };
    },
    onMessage: (listener) =>
      messageListeners.add((message) => {
        try {
          listener(message);
        } catch (error) {
          deps.log(`message listener failed: ${errorText(error)}`);
        }
      }),
    async settled() {
      let seen: number;
      do {
        seen = startedWork;
        await Promise.all([
          ...[...roomQueues.values()].map((queue) => queue.settled()),
          ...savedStates.map((state) => state.settled()),
          ...publishing,
        ]);
      } while (seen !== startedWork);
    },
  };
}
