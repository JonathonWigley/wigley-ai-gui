import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { Clock, RandomHex } from '../../contracts/ambient';
import type { FormBody, SessionInfo } from '../../contracts/forms';
import type { Log } from '../../contracts/log';
import type { FinishedOutcome } from './round';

// retro's backfill reaches back 90 days (scripts/retro/ledger.py STALE_DAYS).
export const RETENTION_SECONDS = 90 * 24 * 60 * 60;

export type SavedOutcome = 'open' | FinishedOutcome;

// Whose round a file is: a restart hands back only the owner's own rounds.
export type RoundOwner = Pick<SessionInfo, 'sessionId' | 'projectDir'>;

// One round's file. The field names are the saved-round format retro reads.
export interface SavedRound {
  id: string;
  fingerprint: string;
  // The ask_round arguments as sent.
  args: unknown;
  // The answers as last saved; a file another version wrote may hold any shape.
  body: unknown;
  outcome: SavedOutcome;
  // A tool reply carried the finished answers.
  returned: boolean;
  session_id: string | null;
  project_dir: string | null;
  tool_use_id: string | null;
  // Epoch seconds.
  created: number;
  updated: number;
}

export type FinishedSavedRound = SavedRound & { outcome: FinishedOutcome };

// The saved-round folder: every draft and every finish, so a round's answers
// outlive a deadline, a replacing round and an app restart. A disk failure is
// logged and never thrown: losing the copy must not cost the live round.
export interface RoundStore {
  create(
    owner: RoundOwner,
    fingerprint: string,
    args: unknown,
    body: FormBody | null,
    toolUseId: string | null,
  ): SavedRound;
  // A finished round keeps the body it finished with: a late draft is dropped.
  saveBody(record: SavedRound, body: FormBody): void;
  finish(record: SavedRound, outcome: FinishedOutcome, body: FormBody): void;
  markReturned(record: SavedRound): void;
  // The newest by `updated` with this fingerprint, from any owner and in any
  // state: what a re-sent round is pre-filled from.
  newestFor(fingerprint: string): SavedRound | null;
  // The newest finished round of this owner that no tool reply has carried.
  newestUnreturnedFinished(owner: RoundOwner): FinishedSavedRound | null;
  // Deletes every round file, and any temp file a crash left, last written more
  // than RETENTION_SECONDS ago.
  prune(): void;
}

const ROUND_FILE_SUFFIX = '.json';
// What a crash between the write and the rename leaves behind.
const TEMPORARY_FILE_SUFFIX = '.tmp';

function isFinished(record: SavedRound): record is FinishedSavedRound {
  return record.outcome !== 'open';
}

// With no session id the project folder decides; with neither, as under
// Codex, nothing is anyone's, so one session never gets another's answers.
function isOwnedBy(record: SavedRound, owner: RoundOwner): boolean {
  if (owner.sessionId !== null) {
    return record.session_id === owner.sessionId;
  }
  if (owner.projectDir === null) {
    return false;
  }
  return record.session_id === null && record.project_dir === owner.projectDir;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function isSavedOutcome(value: unknown): value is SavedOutcome {
  return value === 'open' || value === 'submitted' || value === 'cancelled';
}

// Reads the fields this version knows, so a field a newer version added never
// hides a file from this one.
function savedRoundFrom(data: unknown): SavedRound | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }
  const fields = data as Record<string, unknown>;
  const outcome = fields.outcome ?? 'open';
  const hasIdentity =
    typeof fields.id === 'string' &&
    typeof fields.fingerprint === 'string' &&
    Object.hasOwn(fields, 'args') &&
    Object.hasOwn(fields, 'body');
  if (!hasIdentity || !isSavedOutcome(outcome)) {
    return null;
  }
  return {
    id: fields.id as string,
    fingerprint: fields.fingerprint as string,
    args: fields.args,
    body: fields.body,
    outcome,
    returned: fields.returned === true,
    session_id: stringOrNull(fields.session_id),
    project_dir: stringOrNull(fields.project_dir),
    tool_use_id: stringOrNull(fields.tool_use_id),
    created: numberOrZero(fields.created),
    updated: numberOrZero(fields.updated),
  };
}

function roundFileNames(roundsDir: string): string[] {
  try {
    return readdirSync(roundsDir).filter((name) =>
      name.endsWith(ROUND_FILE_SUFFIX),
    );
  } catch {
    return [];
  }
}

function readSavedRound(filePath: string): SavedRound | null {
  try {
    return savedRoundFrom(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    // A corrupt or unreadable file is skipped, never fatal.
    return null;
  }
}

function readAllRounds(roundsDir: string): SavedRound[] {
  const records: SavedRound[] = [];
  for (const name of roundFileNames(roundsDir)) {
    const record = readSavedRound(path.join(roundsDir, name));
    if (record !== null) {
      records.push(record);
    }
  }
  return records;
}

function newestUpdated<T extends SavedRound>(records: T[]): T | null {
  let newest: T | null = null;
  for (const record of records) {
    if (newest === null || record.updated > newest.updated) {
      newest = record;
    }
  }
  return newest;
}

// Rewrites the whole file through a temp file and a rename, so a crash
// mid-write leaves the previous file intact.
function writeRecord(
  roundsDir: string,
  record: SavedRound,
  clock: Clock,
  log: Log,
): void {
  record.updated = clock.now() / 1000;
  const filePath = path.join(roundsDir, `${record.id}${ROUND_FILE_SUFFIX}`);
  const temporaryPath = `${filePath}${TEMPORARY_FILE_SUFFIX}`;
  try {
    mkdirSync(roundsDir, { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify(record), 'utf8');
    renameSync(temporaryPath, filePath);
  } catch (error) {
    log('forms', `could not save round ${record.id}: ${errorText(error)}`);
  }
}

function pruneFileNames(roundsDir: string): string[] {
  try {
    return readdirSync(roundsDir).filter(
      (name) =>
        name.endsWith(ROUND_FILE_SUFFIX) ||
        name.endsWith(`${ROUND_FILE_SUFFIX}${TEMPORARY_FILE_SUFFIX}`),
    );
  } catch {
    return [];
  }
}

function pruneOlderThan(roundsDir: string, cutoffMs: number, log: Log): void {
  for (const name of pruneFileNames(roundsDir)) {
    try {
      const filePath = path.join(roundsDir, name);
      if (statSync(filePath).mtimeMs < cutoffMs) {
        unlinkSync(filePath);
      }
    } catch (error) {
      log('forms', `could not prune ${name}: ${errorText(error)}`);
    }
  }
}

export function createRoundStore(deps: {
  roundsDir: string;
  clock: Clock;
  randomHex: RandomHex;
  log: Log;
}): RoundStore {
  const { roundsDir, clock, randomHex, log } = deps;
  const write = (record: SavedRound) =>
    writeRecord(roundsDir, record, clock, log);
  return {
    create: (owner, fingerprint, args, body, toolUseId) => {
      const now = clock.now() / 1000;
      // Field order is Python's dataclass order, so a file reads the same.
      const record: SavedRound = {
        id: `${Math.floor(now)}-${randomHex()}`,
        fingerprint,
        args,
        body: body ?? {},
        outcome: 'open',
        returned: false,
        session_id: owner.sessionId,
        project_dir: owner.projectDir,
        tool_use_id: toolUseId,
        created: now,
        updated: now,
      };
      write(record);
      return record;
    },
    saveBody: (record, body) => {
      if (isFinished(record)) {
        return;
      }
      record.body = body;
      write(record);
    },
    finish: (record, outcome, body) => {
      record.body = body;
      record.outcome = outcome;
      write(record);
    },
    markReturned: (record) => {
      record.returned = true;
      write(record);
    },
    newestFor: (fingerprint) =>
      newestUpdated(
        readAllRounds(roundsDir).filter(
          (record) => record.fingerprint === fingerprint,
        ),
      ),
    newestUnreturnedFinished: (owner) =>
      newestUpdated(
        readAllRounds(roundsDir).filter(
          (record): record is FinishedSavedRound =>
            isFinished(record) && !record.returned && isOwnedBy(record, owner),
        ),
      ),
    prune: () =>
      pruneOlderThan(roundsDir, clock.now() - RETENTION_SECONDS * 1000, log),
  };
}
