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
import type {
  AgentFormEndKind,
  AgentFormOwnerInfo,
} from '../../contracts/agent-forms';
import type { Clock, RandomHex } from '../../contracts/ambient';
import type { Log } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import { errorText } from '../error-text';
import { isJsonObject } from '../json';

// retro's backfill reaches back 90 days (scripts/retro/ledger.py STALE_DAYS).
export const RETENTION_SECONDS = 90 * 24 * 60 * 60;

export type SavedOutcome = 'open' | AgentFormEndKind;

// Whose form a file is: a restart hands back only the owner's own forms.
export type AgentFormOwnerRef = Pick<
  AgentFormOwnerInfo,
  'sessionId' | 'projectDir'
>;

// One form's file, for every agent form type. The field names are the saved
// form format retro reads.
export interface SavedAgentForm {
  id: string;
  fingerprint: string;
  // The open tool's arguments as sent.
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

export type FinishedSavedAgentForm = SavedAgentForm & {
  outcome: AgentFormEndKind;
};

// Where a form's answers are kept: every draft and every finish. The
// folder store (createFolderFormStore) keeps them on disk, so they outlive a
// deadline, the next form and an app restart; the memory store
// (createMemoryFormStore) keeps them in memory only.
export interface AgentFormStore {
  create(
    owner: AgentFormOwnerRef,
    fingerprint: string,
    args: unknown,
    body: unknown,
    toolUseId: string | null,
  ): SavedAgentForm;
  // A finished form keeps the body it finished with: a late draft is dropped.
  // Throws an Error naming the form and the disk's reason when the write fails.
  saveBody(record: SavedAgentForm, body: unknown): void;
  finish(
    record: SavedAgentForm,
    outcome: AgentFormEndKind,
    body: unknown,
  ): void;
  markReturned(record: SavedAgentForm): void;
  // The newest by `updated` with this fingerprint, from any owner and in any
  // state: what a re-sent form is pre-filled from.
  newestFor(fingerprint: string): SavedAgentForm | null;
  // The newest finished form of this owner that no tool reply has carried,
  // passing over the forms whose ids are in `excluding`.
  newestUnreturnedFinished(
    owner: AgentFormOwnerRef,
    excluding: ReadonlySet<string>,
  ): FinishedSavedAgentForm | null;
  // The args of the newest forms by `updated`, newest first: one per
  // fingerprint, at most `limit`.
  recentArgs(limit: number): unknown[];
  // Deletes every form file, and any temp file a crash left, last written more
  // than RETENTION_SECONDS ago.
  prune(): void;
}

const FORM_FILE_SUFFIX = '.json';
// What a crash between the write and the rename leaves behind.
const TEMPORARY_FILE_SUFFIX = '.tmp';

export function isFinished(
  record: SavedAgentForm,
): record is FinishedSavedAgentForm {
  return record.outcome !== 'open';
}

// With no session id the project folder decides, compared as the same path;
// with neither, as under Codex, nothing is anyone's, so one session never
// gets another's answers.
function isOwnedBy(
  record: SavedAgentForm,
  owner: AgentFormOwnerRef,
  paths: Paths,
): boolean {
  if (owner.sessionId !== null) {
    return record.session_id === owner.sessionId;
  }
  if (owner.projectDir === null) {
    return false;
  }
  return (
    record.session_id === null &&
    record.project_dir !== null &&
    paths.samePath(record.project_dir, owner.projectDir)
  );
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
function savedFormFrom(data: unknown): SavedAgentForm | null {
  if (!isJsonObject(data)) {
    return null;
  }
  const fields = data;
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

function formFileNames(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(FORM_FILE_SUFFIX));
  } catch {
    return [];
  }
}

function readSavedForm(filePath: string): SavedAgentForm | null {
  try {
    return savedFormFrom(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    // A corrupt or unreadable file is skipped, never fatal.
    return null;
  }
}

function readAllForms(dir: string): SavedAgentForm[] {
  const records: SavedAgentForm[] = [];
  for (const name of formFileNames(dir)) {
    const record = readSavedForm(path.join(dir, name));
    if (record !== null) {
      records.push(record);
    }
  }
  return records;
}

function newestUpdated<T extends SavedAgentForm>(records: T[]): T | null {
  let newest: T | null = null;
  for (const record of records) {
    if (newest === null || record.updated > newest.updated) {
      newest = record;
    }
  }
  return newest;
}

function recentArgsOf(records: SavedAgentForm[], limit: number): unknown[] {
  const newestFirst = records.toSorted((a, b) => b.updated - a.updated);
  const seenFingerprints = new Set<string>();
  const args: unknown[] = [];
  for (const record of newestFirst) {
    if (args.length >= limit) {
      break;
    }
    if (!seenFingerprints.has(record.fingerprint)) {
      seenFingerprints.add(record.fingerprint);
      args.push(record.args);
    }
  }
  return args;
}

// The store's reads, answered over every form `readAll` returns; `paths`
// compares project folders.
export function formQueries(
  readAll: () => SavedAgentForm[],
  paths: Paths,
): Pick<
  AgentFormStore,
  'newestFor' | 'newestUnreturnedFinished' | 'recentArgs'
> {
  return {
    newestFor: (fingerprint) =>
      newestUpdated(
        readAll().filter((record) => record.fingerprint === fingerprint),
      ),
    newestUnreturnedFinished: (owner, excluding) =>
      newestUpdated(
        readAll().filter(
          (record): record is FinishedSavedAgentForm =>
            isFinished(record) &&
            !record.returned &&
            isOwnedBy(record, owner, paths) &&
            !excluding.has(record.id),
        ),
      ),
    recentArgs: (limit) => recentArgsOf(readAll(), limit),
  };
}

// A new open form's record, stamped now, with an `<epoch seconds>-<hex>` id.
export function openRecord(
  owner: AgentFormOwnerRef,
  fingerprint: string,
  args: unknown,
  body: unknown,
  toolUseId: string | null,
  clock: Clock,
  randomHex: RandomHex,
): SavedAgentForm {
  const now = clock.now() / 1000;
  // Field order is Python's dataclass order, so a file reads the same.
  return {
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
}

// Rewrites the whole file through a temp file and a rename, so a crash
// mid-write leaves the previous file intact. Throws when the write fails.
function writeRecord(dir: string, record: SavedAgentForm, clock: Clock): void {
  record.updated = clock.now() / 1000;
  const filePath = path.join(dir, `${record.id}${FORM_FILE_SUFFIX}`);
  const temporaryPath = `${filePath}${TEMPORARY_FILE_SUFFIX}`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify(record), 'utf8');
    renameSync(temporaryPath, filePath);
  } catch (error) {
    throw new Error(`could not save form ${record.id}: ${errorText(error)}`, {
      cause: error,
    });
  }
}

function writeRecordOrLog(
  dir: string,
  record: SavedAgentForm,
  clock: Clock,
  log: Log,
  logSource: string,
): void {
  try {
    writeRecord(dir, record, clock);
  } catch (error) {
    log(logSource, errorText(error));
  }
}

function pruneFileNames(dir: string): string[] {
  try {
    return readdirSync(dir).filter(
      (name) =>
        name.endsWith(FORM_FILE_SUFFIX) ||
        name.endsWith(`${FORM_FILE_SUFFIX}${TEMPORARY_FILE_SUFFIX}`),
    );
  } catch {
    return [];
  }
}

function pruneOlderThan(
  dir: string,
  cutoffMs: number,
  log: Log,
  logSource: string,
): void {
  for (const name of pruneFileNames(dir)) {
    try {
      const filePath = path.join(dir, name);
      if (statSync(filePath).mtimeMs < cutoffMs) {
        unlinkSync(filePath);
      }
    } catch (error) {
      log(logSource, `could not prune ${name}: ${errorText(error)}`);
    }
  }
}

// The saved-form folder `dir`; `logSource` names the type in its log lines.
// A disk failure is logged and never thrown, losing the copy must not cost
// the live form — except a draft's, which saveBody throws so the page can
// show it unsaved. A file that does not parse is skipped by every read.
export function createFolderFormStore(deps: {
  dir: string;
  clock: Clock;
  randomHex: RandomHex;
  paths: Paths;
  log: Log;
  logSource: string;
}): AgentFormStore {
  const { dir, clock, randomHex, paths, log, logSource } = deps;
  const write = (record: SavedAgentForm) =>
    writeRecordOrLog(dir, record, clock, log, logSource);
  return {
    create: (owner, fingerprint, args, body, toolUseId) => {
      const record = openRecord(
        owner,
        fingerprint,
        args,
        body,
        toolUseId,
        clock,
        randomHex,
      );
      write(record);
      return record;
    },
    saveBody: (record, body) => {
      if (isFinished(record)) {
        return;
      }
      record.body = body;
      writeRecord(dir, record, clock);
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
    ...formQueries(() => readAllForms(dir), paths),
    prune: () =>
      pruneOlderThan(
        dir,
        clock.now() - RETENTION_SECONDS * 1000,
        log,
        logSource,
      ),
  };
}
