import { isJsonObject } from '../../../shared/json';
import type {
  CloneClaim,
  CloneFacts,
  CloneHandoff,
  CloneStranded,
  CloneWarmup,
  EditorState,
  PoolClone,
  PoolHolder,
  PoolState,
  QueueTicket,
} from '../contract';

// What one read of a pool's `state.json` found. `invalid` names the first field path it could not read
// (`clones.3.facts.editor`), so a half-written file reads as `invalid`.
export type StateFileRead =
  | { kind: 'pool'; pool: PoolState }
  | { kind: 'unknownVersion'; version: unknown }
  | { kind: 'invalid'; reason: string };

const EDITOR_STATES: readonly EditorState[] = [
  'ready',
  'busy',
  'play',
  'closed',
  'unknown',
];
const CLAIM_KINDS = ['agent', 'hold'] as const;
const STRANDED_REASONS = ['expired-dirty', 'session-ended-dirty'] as const;
const WARMUP_STATES = ['running', 'done', 'failed'] as const;
const CLONE_KEY = /^[1-9]\d*$/;

// Reads unity-pool's state file, version 1 only (its README, § State file). Every time turns from Unix seconds to
// epoch milliseconds; clones come sorted by number, the queue in the file's order; `sessions` is not read.
export function readStateFile(text: string): StateFileRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'invalid', reason: 'not JSON' };
  }
  if (!isJsonObject(parsed)) {
    return { kind: 'invalid', reason: 'not a JSON object' };
  }
  if (parsed.version !== 1) {
    return { kind: 'unknownVersion', version: parsed.version };
  }
  try {
    return { kind: 'pool', pool: readPool(parsed) };
  } catch (error) {
    if (error instanceof UnreadField) {
      return { kind: 'invalid', reason: error.message };
    }
    throw error;
  }
}

// A field the file holds in a shape version 1 does not allow; its message is the reason.
class UnreadField extends Error {}

type Fields = Record<string, unknown>;

function readPool(file: Fields): PoolState {
  const clones = requireRecord(file.clones, 'clones');
  const queue = file.queue;
  if (!Array.isArray(queue)) {
    throw unread(queue, 'queue', 'an array');
  }
  return {
    pool: requireString(file.pool, 'pool'),
    updatedAt: requireTime(file.updatedAt, 'updatedAt'),
    clones: Object.entries(clones)
      .map(([key, clone]) => readClone(key, clone))
      .sort((a, b) => a.number - b.number),
    queue: queue.map((ticket, index) =>
      readTicket(requireRecord(ticket, `queue.${index}`), `queue.${index}`),
    ),
  };
}

function readClone(key: string, value: unknown): PoolClone {
  const at = `clones.${key}`;
  if (!CLONE_KEY.test(key)) {
    throw new UnreadField(`${at} is not a clone number`);
  }
  const clone = requireRecord(value, at);
  return {
    number: Number(key),
    path: requireString(clone.path, `${at}.path`),
    facts: readFacts(requireRecord(clone.facts, `${at}.facts`), `${at}.facts`),
    claim: optionalRecord(clone.claim, `${at}.claim`, readClaim),
    handoff: optionalRecord(clone.handoff, `${at}.handoff`, readHandoff),
    stranded: optionalRecord(clone.stranded, `${at}.stranded`, readStranded),
    lastHolder: optionalRecord(
      clone.lastHolder,
      `${at}.lastHolder`,
      readHolder,
    ),
    lastReleasedAt: nullableTime(
      clone.lastReleasedAt ?? null,
      `${at}.lastReleasedAt`,
    ),
    warmup: optionalRecord(clone.warmup, `${at}.warmup`, readWarmup),
  };
}

function readFacts(facts: Fields, at: string): CloneFacts {
  const editor = requireString(facts.editor, `${at}.editor`);
  return {
    branch: nullableString(facts.branch, `${at}.branch`),
    dirty: nullableBoolean(facts.dirty, `${at}.dirty`),
    // A word from a newer unity-pool must not hide the pool.
    editor: EDITOR_STATES.find((state) => state === editor) ?? 'unknown',
    probedAt: nullableTime(facts.probedAt, `${at}.probedAt`),
  };
}

function readHolder(holder: Fields, at: string): PoolHolder {
  return {
    session: nullableString(holder.session, `${at}.session`),
    row: nullableString(holder.row, `${at}.row`),
  };
}

function readClaim(claim: Fields, at: string): CloneClaim {
  return {
    ...readHolder(claim, at),
    kind: requireWord(claim.kind, `${at}.kind`, CLAIM_KINDS),
    since: requireTime(claim.since, `${at}.since`),
    renewedAt: requireTime(claim.renewedAt, `${at}.renewedAt`),
  };
}

function readHandoff(handoff: Fields, at: string): CloneHandoff {
  return {
    ...readHolder(handoff, at),
    until: requireTime(handoff.until, `${at}.until`),
  };
}

function readStranded(stranded: Fields, at: string): CloneStranded {
  return {
    ...readHolder(stranded, at),
    since: requireTime(stranded.since, `${at}.since`),
    reason: requireWord(stranded.reason, `${at}.reason`, STRANDED_REASONS),
  };
}

function readWarmup(warmup: Fields, at: string): CloneWarmup {
  return {
    state: requireWord(warmup.state, `${at}.state`, WARMUP_STATES),
    startedAt: requireTime(warmup.startedAt, `${at}.startedAt`),
    finishedAt: nullableTime(warmup.finishedAt, `${at}.finishedAt`),
    error: nullableString(warmup.error, `${at}.error`),
  };
}

function readTicket(ticket: Fields, at: string): QueueTicket {
  if (typeof ticket.longWait !== 'boolean') {
    throw unread(ticket.longWait, `${at}.longWait`, 'a boolean');
  }
  return {
    session: requireString(ticket.session, `${at}.session`),
    row: nullableString(ticket.row, `${at}.row`),
    branch: requireString(ticket.branch, `${at}.branch`),
    enqueuedAt: requireTime(ticket.enqueuedAt, `${at}.enqueuedAt`),
    polledAt: requireTime(ticket.polledAt, `${at}.polledAt`),
    longWait: ticket.longWait,
  };
}

function unread(value: unknown, at: string, expected: string): UnreadField {
  return new UnreadField(
    value === undefined ? `${at} is missing` : `${at} is not ${expected}`,
  );
}

function requireRecord(value: unknown, at: string): Fields {
  if (!isJsonObject(value)) {
    throw unread(value, at, 'an object');
  }
  return value;
}

// A missing member reads as null, as a null one does.
function optionalRecord<T>(
  value: unknown,
  at: string,
  read: (fields: Fields, at: string) => T,
): T | null {
  return value === undefined || value === null
    ? null
    : read(requireRecord(value, at), at);
}

function requireString(value: unknown, at: string): string {
  if (typeof value !== 'string') {
    throw unread(value, at, 'a string');
  }
  return value;
}

function nullableString(value: unknown, at: string): string | null {
  return value === null ? null : requireString(value, at);
}

function nullableBoolean(value: unknown, at: string): boolean | null {
  if (value !== null && typeof value !== 'boolean') {
    throw unread(value, at, 'a boolean or null');
  }
  return value;
}

function requireWord<W extends string>(
  value: unknown,
  at: string,
  words: readonly W[],
): W {
  const word = words.find((allowed) => allowed === value);
  if (word === undefined) {
    throw unread(value, at, `one of ${words.join(', ')}`);
  }
  return word;
}

// Unix seconds in the file, epoch milliseconds in the app.
function requireTime(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw unread(value, at, 'a number');
  }
  return Math.round(value * 1000);
}

function nullableTime(value: unknown, at: string): number | null {
  return value === null ? null : requireTime(value, at);
}
