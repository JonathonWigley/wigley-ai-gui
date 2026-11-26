import type {
  AgentFormEndKind,
  AgentFormOwnerInfo,
} from '../../contracts/agent-forms';
import type { Clock, RandomHex } from '../../contracts/ambient';
import { type Files, readIfPresent } from '../../contracts/files';
import type { PluginLog } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import { errorText } from '../error-text';
import { isJsonObject } from '../json';
import { createSerialQueue } from '../serial-queue';

// retro's backfill reaches back 90 days (scripts/factory/ledger.py STALE_DAYS).
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
  // The service answered the form itself and showed none, so the answers are
  // not the user's.
  auto_answered: boolean;
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
// (createMemoryFormStore) keeps them in memory only. Every write changes the
// record at once and every read answers at once; the folder store's disk
// steps follow in call order.
export interface AgentFormStore {
  // Reads the folder into the index, starts watching it and prunes the forms
  // past retention, settling once the read and the prune have. Never rejects:
  // a failure is logged. A second call returns the first call's promise.
  load(): Promise<void>;
  create(
    owner: AgentFormOwnerRef,
    fingerprint: string,
    args: unknown,
    body: unknown,
    toolUseId: string | null,
  ): SavedAgentForm;
  // A form the service answered itself, saved whole: submitted with `body`,
  // returned and auto-answered. A failed write is logged, never thrown.
  createAutoAnswered(
    owner: AgentFormOwnerRef,
    fingerprint: string,
    args: unknown,
    body: unknown,
    toolUseId: string | null,
  ): SavedAgentForm;
  // A finished form keeps the body it finished with: a late draft is dropped
  // and the promise resolves. Rejects with an Error naming the form and the
  // disk's reason when the write fails.
  saveBody(record: SavedAgentForm, body: unknown): Promise<void>;
  finish(
    record: SavedAgentForm,
    outcome: AgentFormEndKind,
    body: unknown,
  ): void;
  markReturned(record: SavedAgentForm): void;
  // The newest by `updated` with this fingerprint, from any owner and in any
  // state but auto-answered: what a re-sent form is pre-filled from.
  newestFor(fingerprint: string): SavedAgentForm | null;
  // The newest finished form of this owner that no tool reply has carried,
  // passing over the forms whose ids are in `excluding`.
  newestUnreturnedFinished(
    owner: AgentFormOwnerRef,
    excluding: ReadonlySet<string>,
  ): FinishedSavedAgentForm | null;
  // The newest by `updated` of this owner's forms, in any state.
  newestOwned(owner: AgentFormOwnerRef): SavedAgentForm | null;
  // The args of the newest forms by `updated` that were not auto-answered,
  // newest first: one per fingerprint, at most `limit`.
  recentArgs(limit: number): unknown[];
  // Settles once every disk step queued before the call has settled.
  flushed(): Promise<void>;
}

const FORM_FILE_SUFFIX = '.json';
// What a crash between the write and the rename leaves behind: a legacy
// `<id>.json.tmp`, or the `Files` temp `.<id>.json.<8 hex>.tmp`.
const TEMPORARY_FILE_SUFFIX = '.tmp';

export function isFinished(
  record: SavedAgentForm,
): record is FinishedSavedAgentForm {
  return record.outcome !== 'open';
}

// With no session id the project folder decides, compared as the same path;
// with neither, nothing is anyone's, so one session never gets another's
// answers.
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
    auto_answered: fields.auto_answered === true,
    session_id: stringOrNull(fields.session_id),
    project_dir: stringOrNull(fields.project_dir),
    tool_use_id: stringOrNull(fields.tool_use_id),
    created: numberOrZero(fields.created),
    updated: numberOrZero(fields.updated),
  };
}

// Whether `name`, an entry of the folder, is a form file: `<id>.json`, never a
// dotfile such as a `Files` temp file.
function isFormFileName(name: string): boolean {
  return name.endsWith(FORM_FILE_SUFFIX) && !name.startsWith('.');
}

// The form `text` holds; null when it does not parse or holds no form.
function parsedForm(text: string): SavedAgentForm | null {
  try {
    return savedFormFrom(JSON.parse(text));
  } catch {
    return null;
  }
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
  const newestFirst = records
    .filter((record) => !record.auto_answered)
    .toSorted((a, b) => b.updated - a.updated);
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
  'newestFor' | 'newestUnreturnedFinished' | 'newestOwned' | 'recentArgs'
> {
  return {
    newestFor: (fingerprint) =>
      newestUpdated(
        readAll().filter(
          (record) =>
            record.fingerprint === fingerprint && !record.auto_answered,
        ),
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
    newestOwned: (owner) =>
      newestUpdated(
        readAll().filter((record) => isOwnedBy(record, owner, paths)),
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
    auto_answered: false,
    session_id: owner.sessionId,
    project_dir: owner.projectDir,
    tool_use_id: toolUseId,
    created: now,
    updated: now,
  };
}

// A new open form's record as one the service answered itself, submitted
// with the record's body and already returned.
export function autoAnsweredRecord(record: SavedAgentForm): SavedAgentForm {
  return {
    ...record,
    outcome: 'submitted',
    returned: true,
    auto_answered: true,
  };
}

// The saved-form folder `dir`, read and written through `files`; `log` takes
// its lines. Every read answers from an index of the folder's forms, which
// `load` fills and a watch of the folder keeps current. Every write changes
// the record and the index at once and queues the disk write; every disk
// step (write, scan, re-read, prune) runs in one queue in call order. A
// failed write is logged and never thrown, since losing the copy must not
// cost the live form — except a draft's, which saveBody rejects with so the
// page can show it unsaved — and the index keeps the record. A file that does
// not parse is skipped.
export function createFolderFormStore(deps: {
  files: Files;
  dir: string;
  clock: Clock;
  randomHex: RandomHex;
  paths: Paths;
  log: PluginLog;
}): AgentFormStore {
  const { files, dir, clock, randomHex, paths, log } = deps;
  const index = new Map<string, SavedAgentForm>();
  const queue = createSerialQueue();
  // Writes queued and not yet settled, per id, and the ids whose last write
  // failed: a file missing for either is the disk lagging the index.
  const queuedWrites = new Map<string, number>();
  const failedWrites = new Set<string>();
  let loading: Promise<void> | null = null;
  let isRescanQueued = false;

  const fileOf = (name: string) => paths.join(dir, name);
  const idOf = (name: string) => name.slice(0, -FORM_FILE_SUFFIX.length);
  const isAheadOfDisk = (id: string) =>
    (queuedWrites.get(id) ?? 0) > 0 || failedWrites.has(id);
  const dropUnlessAheadOfDisk = (id: string) => {
    if (!isAheadOfDisk(id)) {
      index.delete(id);
    }
  };

  // Stamps the record, indexes it and queues its write, which settles the
  // promise returned.
  const save = (record: SavedAgentForm): Promise<void> => {
    record.updated = clock.now() / 1000;
    index.set(record.id, record);
    const { id } = record;
    const text = JSON.stringify(record);
    queuedWrites.set(id, (queuedWrites.get(id) ?? 0) + 1);
    return queue.run(async () => {
      try {
        await files.write(fileOf(`${id}${FORM_FILE_SUFFIX}`), text);
        failedWrites.delete(id);
      } catch (error) {
        failedWrites.add(id);
        throw new Error(`could not save form ${id}: ${errorText(error)}`, {
          cause: error,
        });
      } finally {
        queuedWrites.set(id, (queuedWrites.get(id) ?? 1) - 1);
      }
    });
  };
  const saveOrLog = (record: SavedAgentForm) => {
    save(record).catch((error: unknown) => log(errorText(error)));
  };

  // Reads the form file `name` into the index: a newer copy replaces the
  // entry, an older or equal one keeps it, and a missing or corrupt file
  // drops it. Returns the id the file holds, or null when it holds none.
  const merge = async (name: string): Promise<string | null> => {
    let text: string | null;
    try {
      text = await readIfPresent(files, fileOf(name));
    } catch (error) {
      log(`could not read ${name}: ${errorText(error)}`);
      return idOf(name);
    }
    const record = text === null ? null : parsedForm(text);
    if (record === null) {
      dropUnlessAheadOfDisk(idOf(name));
      return null;
    }
    const entry = index.get(record.id);
    if (entry === undefined || record.updated > entry.updated) {
      index.set(record.id, record);
    }
    return record.id;
  };

  // Lists the folder, merges every form file and drops each entry whose file
  // is gone.
  const scan = async () => {
    let names: string[];
    try {
      names = (await files.list(dir))
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.path);
    } catch (error) {
      log(`could not list ${dir}: ${errorText(error)}`);
      return;
    }
    const found = new Set<string>();
    for (const name of names.filter(isFormFileName)) {
      const id = await merge(name);
      if (id !== null) {
        found.add(id);
      }
    }
    // Deleting the entry iterated now is safe in a Map.
    for (const id of index.keys()) {
      if (!found.has(id)) {
        dropUnlessAheadOfDisk(id);
      }
    }
  };

  // Deletes every form file, and any temp file a crash left, last written more
  // than RETENTION_SECONDS ago.
  const prune = async () => {
    const cutoffMs = clock.now() - RETENTION_SECONDS * 1000;
    let names: string[];
    try {
      names = (await files.list(dir)).map((entry) => entry.path);
    } catch (error) {
      log(`could not list ${dir}: ${errorText(error)}`);
      return;
    }
    const prunable = names.filter(
      (name) =>
        name.endsWith(FORM_FILE_SUFFIX) || name.endsWith(TEMPORARY_FILE_SUFFIX),
    );
    for (const name of prunable) {
      try {
        if ((await files.modified(fileOf(name))) < cutoffMs) {
          await files.deleteFile(fileOf(name));
          if (isFormFileName(name)) {
            dropUnlessAheadOfDisk(idOf(name));
          }
        }
      } catch (error) {
        log(`could not prune ${name}: ${errorText(error)}`);
      }
    }
  };

  const rescan = () => {
    if (isRescanQueued) {
      return;
    }
    isRescanQueued = true;
    void queue.run(async () => {
      isRescanQueued = false;
      await scan();
    });
  };

  const startLoad = async () => {
    try {
      files.watch(
        dir,
        (name) => {
          if (isFormFileName(name)) {
            void queue.run(() => merge(name));
          }
        },
        {
          recursive: false,
          onMissed: rescan,
          onError: (error) =>
            log(`form folder watch failed: ${errorText(error)}`),
        },
      );
    } catch (error) {
      log(`form folder not watched: ${errorText(error)}`);
    }
    await queue.run(scan);
    await queue.run(prune);
  };

  return {
    load: () => {
      loading ??= startLoad();
      return loading;
    },
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
      saveOrLog(record);
      return record;
    },
    createAutoAnswered: (owner, fingerprint, args, body, toolUseId) => {
      const record = autoAnsweredRecord(
        openRecord(owner, fingerprint, args, body, toolUseId, clock, randomHex),
      );
      saveOrLog(record);
      return record;
    },
    saveBody: (record, body) => {
      if (isFinished(record)) {
        return Promise.resolve();
      }
      record.body = body;
      return save(record);
    },
    finish: (record, outcome, body) => {
      record.body = body;
      record.outcome = outcome;
      saveOrLog(record);
    },
    markReturned: (record) => {
      record.returned = true;
      saveOrLog(record);
    },
    ...formQueries(() => [...index.values()], paths),
    flushed: () => queue.settled(),
  };
}
