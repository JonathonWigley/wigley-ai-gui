import { beforeEach, describe, expect, it } from 'vitest';
import type { Files, WatchOptions } from '../../contracts/files';
import type { Paths } from '../../contracts/paths';
import { createMemoryFiles, type MemoryFiles } from '../memory-files';
import { posixPaths } from '../paths/posix-paths';
import { windowsPaths } from '../paths/windows-paths';
import {
  type AgentFormOwnerRef,
  type AgentFormStore,
  createFolderFormStore,
  RETENTION_SECONDS,
  type SavedAgentForm,
} from './form-store';

const MINE: AgentFormOwnerRef = { sessionId: 's1', projectDir: '/p' };
const ARGS = { heading: 'h' };
const NONE: ReadonlySet<string> = new Set();
const formsDir = '/forms';

let files: MemoryFiles;
let nowMs: number;
let hexCount: number;
let logLines: string[];

function storeIn(
  dir: string,
  paths: Paths = posixPaths,
  through: Files = files,
): AgentFormStore {
  return createFolderFormStore({
    files: through,
    dir,
    clock: { now: () => nowMs },
    randomHex: () => (++hexCount).toString(16).padStart(8, '0'),
    paths,
    log: (message: string) => logLines.push(message),
  });
}

function withNote(note: string): { note: string } {
  return { note };
}

function formPath(id: string): string {
  return `${formsDir}/${id}.json`;
}

async function formFiles(): Promise<string[]> {
  return (await files.list(formsDir))
    .map((entry) => entry.path)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

async function savedForm(id: string): Promise<SavedAgentForm> {
  return JSON.parse(await files.read(formPath(id))) as SavedAgentForm;
}

// A form another app saved, open and mine.
function foreignForm(id: string, fingerprint: string): SavedAgentForm {
  return {
    id,
    fingerprint,
    args: ARGS,
    body: {},
    outcome: 'open',
    returned: false,
    auto_answered: false,
    session_id: 's1',
    project_dir: '/p',
    tool_use_id: null,
    created: 9,
    updated: 9,
  };
}

function waitForQueuedWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// The memory files with every `write` rejecting.
function unwritable(): Files {
  return { ...files, write: () => Promise.reject(new Error('EACCES')) };
}

// The memory files whose `write` calls each wait for `held` before writing,
// counting the calls made.
function heldWrites(held: Promise<void>): {
  files: Files;
  calls: () => number;
} {
  let calls = 0;
  return {
    files: {
      ...files,
      write: async (path, text) => {
        calls += 1;
        await held;
        await files.write(path, text);
      },
    },
    calls: () => calls,
  };
}

// `through` with a `watch` that keeps its options' `onMissed` for the test to
// call and passes on no change it reports, so only a rescan finds a change.
function missingWatch(through: Files): { files: Files; missed: () => void } {
  let options: WatchOptions | undefined;
  return {
    files: {
      ...through,
      watch: (folder, _onChange, watchOptions) => {
        options = watchOptions;
        return files.watch(folder, () => undefined, watchOptions);
      },
    },
    missed: () => options?.onMissed?.(),
  };
}

beforeEach(() => {
  nowMs = 1_000_000;
  files = createMemoryFiles({ now: () => nowMs });
  hexCount = 0;
  logLines = [];
});

describe('createFolderFormStore', () => {
  it('writes one file per form, named by its <epoch seconds>-<8 hex> id', async () => {
    const store = storeIn(formsDir);
    const record = store.create(MINE, 'fp', ARGS, withNote('n'), null);
    await store.flushed();

    expect(record.id).toBe('1000-00000001');
    expect(await formFiles()).toEqual(['1000-00000001.json']);
  });

  it('writes the saved-form fields retro reads', async () => {
    const store = storeIn(formsDir);
    const record = store.create(MINE, 'fp', ARGS, withNote('n'), 'toolu_1');
    await store.flushed();

    const saved = await savedForm(record.id);

    expect(saved).toEqual({
      id: '1000-00000001',
      fingerprint: 'fp',
      args: { heading: 'h' },
      body: { note: 'n' },
      outcome: 'open',
      returned: false,
      auto_answered: false,
      session_id: 's1',
      project_dir: '/p',
      tool_use_id: 'toolu_1',
      created: 1000,
      updated: 1000,
    });
  });

  it('createAutoAnswered_WritesOneSubmittedReturnedAutoAnsweredFile', async () => {
    const store = storeIn(formsDir);
    const record = store.createAutoAnswered(
      MINE,
      'fp',
      ARGS,
      withNote('picked'),
      'toolu_1',
    );
    await store.flushed();

    const saved = await savedForm(record.id);

    expect(await formFiles()).toEqual([`${record.id}.json`]);
    expect(saved).toMatchObject({
      fingerprint: 'fp',
      args: ARGS,
      body: withNote('picked'),
      outcome: 'submitted',
      returned: true,
      auto_answered: true,
      session_id: 's1',
      tool_use_id: 'toolu_1',
    });
  });

  it('newestFor_PassesOverAnAutoAnsweredForm', () => {
    const store = storeIn(formsDir);
    const shown = store.create(MINE, 'fp', ARGS, withNote('mine'), null);
    nowMs = 2_000_000;
    store.createAutoAnswered(MINE, 'fp', ARGS, withNote('picked'), null);

    expect(store.newestFor('fp')?.id).toBe(shown.id);
  });

  it('recentArgs_SkipsAnAutoAnsweredForm', () => {
    const store = storeIn(formsDir);
    store.create(MINE, 'fp-1', { heading: 'shown' }, null, null);
    nowMs = 2_000_000;
    store.createAutoAnswered(MINE, 'fp-2', { heading: 'auto' }, null, null);

    expect(store.recentArgs(5)).toEqual([{ heading: 'shown' }]);
  });

  it('reads a created form back equal, open and unreturned', () => {
    const store = storeIn(formsDir);
    const record = store.create(MINE, 'fp', ARGS, withNote('n'), null);

    expect(store.newestFor('fp')).toEqual(record);
    expect(record.outcome).toBe('open');
    expect(record.returned).toBe(false);
  });

  it('writes an empty body for a form opened with no saved answers', () => {
    const store = storeIn(formsDir);
    store.create(MINE, 'fp', ARGS, null, null);

    expect(store.newestFor('fp')?.body).toEqual({});
  });

  it('rewrites the file on a draft and on the finish', async () => {
    const store = storeIn(formsDir);
    const record = store.create(MINE, 'fp', ARGS, null, null);

    await store.saveBody(record, withNote('half'));
    expect(store.newestFor('fp')?.body).toEqual(withNote('half'));
    expect((await savedForm(record.id)).body).toEqual(withNote('half'));

    store.finish(record, 'submitted', withNote('done'));
    await store.flushed();
    expect(store.newestFor('fp')).toMatchObject({
      outcome: 'submitted',
      body: withNote('done'),
    });
    expect(await savedForm(record.id)).toMatchObject({
      outcome: 'submitted',
      body: withNote('done'),
    });
  });

  it('keeps the finished body when a draft arrives after the finish', async () => {
    const store = storeIn(formsDir);
    const record = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(record, 'submitted', withNote('done'));

    await store.saveBody(record, withNote('late draft'));

    expect(store.newestFor('fp')).toMatchObject({
      outcome: 'submitted',
      body: withNote('done'),
    });
  });

  it('finds the form with this fingerprint updated last', async () => {
    const store = storeIn(formsDir);
    const older = store.create(MINE, 'fp', ARGS, withNote('older'), null);
    nowMs = 2_000_000;
    store.create(MINE, 'fp', ARGS, withNote('newer'), null);
    nowMs = 3_000_000;
    await store.saveBody(older, withNote('touched last'));

    expect(store.newestFor('fp')?.body).toEqual(withNote('touched last'));
  });

  it('recentArgs_NewestFirst_Limited', () => {
    const store = storeIn(formsDir);
    store.create(MINE, 'fp-1', { heading: 'oldest' }, null, null);
    nowMs = 2_000_000;
    store.create(MINE, 'fp-2', { heading: 'middle' }, null, null);
    nowMs = 3_000_000;
    store.create(MINE, 'fp-3', { heading: 'newest' }, null, null);

    expect(store.recentArgs(2)).toEqual([
      { heading: 'newest' },
      { heading: 'middle' },
    ]);
  });

  it('recentArgs_SkipsUnreadableFile', async () => {
    const store = storeIn(formsDir);
    store.create(MINE, 'fp', ARGS, null, null);
    await files.write(formPath('broken'), '{not json');

    await store.load();

    expect(store.recentArgs(5)).toEqual([ARGS]);
  });

  it('recentArgs_OneRecordPerFingerprint', () => {
    const store = storeIn(formsDir);
    store.create(MINE, 'fp', { heading: 'first send' }, null, null);
    nowMs = 2_000_000;
    store.create(MINE, 'other', { heading: 'other' }, null, null);
    nowMs = 3_000_000;
    store.create(MINE, 'fp', { heading: 'second send' }, null, null);

    expect(store.recentArgs(5)).toEqual([
      { heading: 'second send' },
      { heading: 'other' },
    ]);
  });

  it('finds a finished form as unreturned until it is marked returned', () => {
    const store = storeIn(formsDir);
    const record = store.create(MINE, 'fp', ARGS, null, null);
    expect(store.newestUnreturnedFinished(MINE, NONE)).toBeNull();

    store.finish(record, 'cancelled', withNote(''));
    expect(store.newestUnreturnedFinished(MINE, NONE)?.id).toBe(record.id);

    store.markReturned(record);
    expect(store.newestUnreturnedFinished(MINE, NONE)).toBeNull();
  });

  it("finds the owner's newest form in any state, never another owner's", () => {
    const store = storeIn(formsDir);
    store.create(MINE, 'fp', ARGS, null, null);
    nowMs = 2_000_000;
    const newer = store.create(MINE, 'fp2', ARGS, null, null);
    store.finish(newer, 'submitted', withNote('done'));
    nowMs = 3_000_000;
    store.create(
      { sessionId: 's2', projectDir: '/p' },
      'fp3',
      ARGS,
      null,
      null,
    );

    expect(store.newestOwned(MINE)?.id).toBe(newer.id);
  });

  it('passes over an excluded form to the older one behind it', () => {
    const store = storeIn(formsDir);
    const older = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(older, 'submitted', withNote(''));
    nowMs = 2_000_000;
    const newer = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(newer, 'submitted', withNote(''));

    expect(store.newestUnreturnedFinished(MINE, NONE)?.id).toBe(newer.id);
    expect(store.newestUnreturnedFinished(MINE, new Set([newer.id]))?.id).toBe(
      older.id,
    );
  });

  it("never finds another session's form as this session's", () => {
    const store = storeIn(formsDir);
    const theirs = store.create(
      { sessionId: 's2', projectDir: '/p' },
      'fp',
      ARGS,
      null,
      null,
    );
    store.finish(theirs, 'submitted', withNote(''));

    expect(store.newestUnreturnedFinished(MINE, NONE)).toBeNull();
  });

  it('lets the project folder decide when there is no session id', () => {
    const store = storeIn(formsDir);
    const mine = store.create(
      { sessionId: null, projectDir: '/p' },
      'fp',
      ARGS,
      null,
      null,
    );
    store.finish(mine, 'submitted', withNote(''));
    const theirs = store.create(
      { sessionId: null, projectDir: '/q' },
      'fp',
      ARGS,
      null,
      null,
    );
    store.finish(theirs, 'submitted', withNote(''));

    expect(
      store.newestUnreturnedFinished(
        { sessionId: null, projectDir: '/p' },
        NONE,
      )?.id,
    ).toBe(mine.id);
  });

  it('isOwnedBy_WindowsCaseDiffers_Owned', () => {
    const store = storeIn(formsDir, windowsPaths);
    const record = store.create(
      { sessionId: null, projectDir: 'C:\\Dev\\App' },
      'fp',
      ARGS,
      null,
      null,
    );
    store.finish(record, 'submitted', withNote(''));

    expect(
      store.newestUnreturnedFinished(
        { sessionId: null, projectDir: 'c:\\dev\\app' },
        NONE,
      )?.id,
    ).toBe(record.id);
  });

  it('finds nothing as mine with neither a session id nor a project folder, yet still pre-fills', () => {
    const nobody: AgentFormOwnerRef = { sessionId: null, projectDir: null };
    const store = storeIn(formsDir);
    const record = store.create(nobody, 'fp', ARGS, null, null);
    store.finish(record, 'submitted', withNote(''));

    expect(store.newestUnreturnedFinished(nobody, NONE)).toBeNull();
    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  it('prunes only files last written before the retention window', async () => {
    const writer = storeIn(formsDir);
    nowMs = 2_000_000_000_000 - (RETENTION_SECONDS + 60) * 1000;
    writer.create(MINE, 'old', ARGS, null, null);
    await writer.flushed();
    nowMs = 2_000_000_000_000;
    const recent = writer.create(MINE, 'recent', ARGS, null, null);
    await writer.flushed();
    const store = storeIn(formsDir);

    await store.load();
    await store.flushed();

    expect(await formFiles()).toEqual([`${recent.id}.json`]);
    expect(store.newestFor('old')).toBeNull();
    expect(store.newestFor('recent')?.id).toBe(recent.id);
  });

  it('retains saved forms for at least the 90 days retro backfills', () => {
    // retro (the marketplace's scripts/retro, ledger.STALE_DAYS) backfills 90
    // days and reads these files, so pruning sooner would starve it.
    expect(RETENTION_SECONDS).toBeGreaterThanOrEqual(90 * 24 * 60 * 60);
  });

  it('prunes a temp file a crash left, by the same age rule', async () => {
    nowMs = 2_000_000_000_000 - (RETENTION_SECONDS + 60) * 1000;
    await files.write(`${formsDir}/stale.json.tmp`, '{');
    await files.write(`${formsDir}/.stale.json.0000abcd.tmp`, '{');
    nowMs = 2_000_000_000_000;
    await files.write(`${formsDir}/fresh.json.tmp`, '{');
    await files.write(`${formsDir}/.fresh.json.0000abcd.tmp`, '{');
    const store = storeIn(formsDir);

    await store.load();
    await store.flushed();

    expect(
      (await files.list(formsDir))
        .map((entry) => entry.path)
        .filter((name) => name.endsWith('.tmp'))
        .sort(),
    ).toEqual(['.fresh.json.0000abcd.tmp', 'fresh.json.tmp']);
  });

  it('skips a corrupt file and a file that is not an object', async () => {
    const writer = storeIn(formsDir);
    const record = writer.create(MINE, 'fp', ARGS, null, null);
    await writer.flushed();
    await files.write(formPath('broken'), '{not json');
    await files.write(formPath('list'), '[1, 2]');
    const store = storeIn(formsDir);

    await store.load();

    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  it('never reads a leftover temp file as a form', async () => {
    const writer = storeIn(formsDir);
    const record = writer.create(MINE, 'fp', ARGS, null, null);
    await writer.flushed();
    const leftover = { ...record, id: 'leftover', updated: 9_999_999 };
    await files.write(
      `${formsDir}/leftover.json.tmp`,
      JSON.stringify(leftover),
    );
    const store = storeIn(formsDir);

    await store.load();

    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  it('loads a file holding a field this version does not know', async () => {
    const writer = storeIn(formsDir);
    const record = writer.create(MINE, 'fp', ARGS, null, null);
    await writer.flushed();
    const data = await savedForm(record.id);
    await files.write(
      formPath(record.id),
      JSON.stringify({ ...data, added_later: true }),
    );
    const store = storeIn(formsDir);

    await store.load();

    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  it('loads a file the Python forms server wrote', async () => {
    await files.write(
      formPath('1700000000-0a1b2c3d'),
      '{"id": "1700000000-0a1b2c3d", "fingerprint": "fp-python", ' +
        '"args": {"heading": "h"}, "body": {"note": "caf\\u00e9", ' +
        '"answers": [{"index": 1, "choice": 2, "not_applicable": false, ' +
        '"what": "", "why": ""}]}, "outcome": "submitted", "returned": false, ' +
        '"session_id": "s1", "project_dir": "/p", "tool_use_id": null, ' +
        '"created": 1700000000.25, "updated": 1700000001.5}',
    );
    const store = storeIn(formsDir);

    await store.load();

    expect(store.newestUnreturnedFinished(MINE, NONE)).toMatchObject({
      id: '1700000000-0a1b2c3d',
      fingerprint: 'fp-python',
      outcome: 'submitted',
      auto_answered: false,
      created: 1700000000.25,
      body: { note: 'café' },
    });
  });

  it('logs and throws nothing when the folder cannot be written', async () => {
    const store = storeIn(formsDir, posixPaths, unwritable());

    const record = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(record, 'submitted', withNote(''));
    const autoAnswered = store.createAutoAnswered(
      MINE,
      'fp-auto',
      ARGS,
      null,
      null,
    );
    await store.flushed();

    expect(logLines.some((line) => line.includes(record.id))).toBe(true);
    expect(logLines.some((line) => line.includes(autoAnswered.id))).toBe(true);
    expect(autoAnswered).toMatchObject({ outcome: 'submitted' });
    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  it("throws a draft's failed write with the disk's reason", async () => {
    const store = storeIn(formsDir, posixPaths, unwritable());
    const record = store.create(MINE, 'fp', ARGS, null, null);

    await expect(store.saveBody(record, withNote('half'))).rejects.toThrow(
      record.id,
    );
  });

  // Breaks if the watch is not opened, or its change is not merged.
  it('finds a form another app writes after load', async () => {
    const store = storeIn(formsDir);
    await store.load();

    await files.write(
      formPath('9-0000000a'),
      JSON.stringify(foreignForm('9-0000000a', 'other')),
    );
    await store.flushed();

    expect(store.newestFor('other')?.id).toBe('9-0000000a');
  });

  it('drops a form another app deletes', async () => {
    const store = storeIn(formsDir);
    await store.load();
    const record = store.create(MINE, 'fp', ARGS, null, null);
    await store.flushed();

    files.remove(formPath(record.id));
    await store.flushed();

    expect(store.newestFor('fp')).toBeNull();
  });

  // Breaks if any reported copy replaces the entry.
  it.each([
    { case: 'an older copy', offsetSeconds: -1, keepsOwn: true },
    { case: 'an equal copy', offsetSeconds: 0, keepsOwn: true },
    { case: 'a newer copy', offsetSeconds: 1, keepsOwn: false },
  ])(
    'keeps the newer of its own record and a reported copy: $case',
    async ({ offsetSeconds, keepsOwn }) => {
      const store = storeIn(formsDir);
      await store.load();
      const record = store.create(MINE, 'fp', ARGS, withNote('own'), null);
      await store.flushed();

      await files.write(
        formPath(record.id),
        JSON.stringify({
          ...record,
          body: withNote('copy'),
          updated: record.updated + offsetSeconds,
        }),
      );
      await store.flushed();

      if (keepsOwn) {
        expect(store.newestFor('fp')).toBe(record);
      } else {
        expect(store.newestFor('fp')?.body).toEqual(withNote('copy'));
      }
    },
  );

  // Breaks if a rescan drops an id whose write is still queued. A held write
  // of another form holds the queue, so the rescan runs while the form's own
  // write waits behind it; the watch passes on no change, so nothing re-adds
  // the form once its write lands.
  it('keeps a form whose write is still queued when a rescan misses its file', async () => {
    const held = Promise.withResolvers<void>();
    const watched = missingWatch(heldWrites(held.promise).files);
    const store = storeIn(formsDir, posixPaths, watched.files);
    await store.load();
    store.create(MINE, 'first', ARGS, null, null);

    watched.missed();
    const record = store.create(MINE, 'fp', ARGS, null, null);
    held.resolve();
    await store.flushed();

    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  // Breaks if a rescan drops an id whose last write failed.
  it('keeps a form whose write failed when a rescan misses its file', async () => {
    const watched = missingWatch(unwritable());
    const store = storeIn(formsDir, posixPaths, watched.files);
    await store.load();
    const record = store.create(MINE, 'fp', ARGS, null, null);
    await store.flushed();

    watched.missed();
    await store.flushed();

    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  // Breaks if `onMissed` is ignored.
  it('rescans the folder when the watch may have missed changes', async () => {
    const watched = missingWatch(files);
    const store = storeIn(formsDir, posixPaths, watched.files);
    await store.load();
    await files.write(
      formPath('9-0000000a'),
      JSON.stringify(foreignForm('9-0000000a', 'other')),
    );
    await store.flushed();
    expect(store.newestFor('other')).toBeNull();

    watched.missed();
    await store.flushed();

    expect(store.newestFor('other')?.id).toBe('9-0000000a');
  });

  // Breaks if writes run in parallel.
  it('writes in call order behind a held write', async () => {
    const held = Promise.withResolvers<void>();
    const holding = heldWrites(held.promise);
    const store = storeIn(formsDir, posixPaths, holding.files);

    const record = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(record, 'submitted', withNote('done'));
    await waitForQueuedWork();
    expect(holding.calls()).toBe(1);

    held.resolve();
    await store.flushed();

    expect(holding.calls()).toBe(2);
    expect((await savedForm(record.id)).body).toEqual(withNote('done'));
  });

  it('logs a failed markReturned and still holds the form returned', async () => {
    let isFailing = false;
    const store = storeIn(formsDir, posixPaths, {
      ...files,
      write: (path, text) =>
        isFailing
          ? Promise.reject(new Error('EBUSY'))
          : files.write(path, text),
    });
    const record = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(record, 'submitted', withNote('done'));
    await store.flushed();

    isFailing = true;
    store.markReturned(record);
    await store.flushed();

    expect(store.newestUnreturnedFinished(MINE, NONE)).toBeNull();
    expect(logLines.some((line) => line.includes(record.id))).toBe(true);
  });

  it('finds a saved form after load when the folder cannot be watched', async () => {
    const writer = storeIn(formsDir);
    const record = writer.create(MINE, 'fp', ARGS, null, null);
    await writer.flushed();
    const store = storeIn(formsDir, posixPaths, {
      ...files,
      watch: () => {
        throw new Error('EMFILE');
      },
    });

    await store.load();

    expect(store.newestFor('fp')?.id).toBe(record.id);
    expect(logLines).toContain('form folder not watched: EMFILE');
  });
});
