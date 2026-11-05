import { describe, expect, it, vi } from 'vitest';
import type { PageChannel } from '../../../contracts/plugin';
import type { DocsChannel } from '../contract';
import { createWikiMainSource } from './wiki-main-source';

const MAIN_PATH = '/real/wiki/Main.md';
const ONE_SHELF = '## Shelf one\n\n[a](a.md)\n';
const TWO_SHELVES = '## Shelf one\n\n## Shelf two\n';

// Lets every settled promise's chain run.
const settled = () => new Promise((resolve) => setTimeout(resolve));

// A channel whose `readDoc`, `watchDoc` and `wikiMainPath` answer as `answers`
// says, each read held in `reads` until the test settles it when `holdsReads`.
function setUp(
  answers: {
    holdsReads?: boolean;
    read?: () => Promise<string | null>;
    watch?: () => Promise<void>;
    path?: () => Promise<string>;
  } = {},
) {
  const reads: PromiseWithResolvers<string | null>[] = [];
  const readDoc = vi.fn(() => {
    if (answers.holdsReads === true) {
      const read = Promise.withResolvers<string | null>();
      reads.push(read);
      return read.promise;
    }
    return answers.read?.() ?? Promise.resolve(ONE_SHELF);
  });
  const watchDoc = vi.fn(
    (_id: string, _path: string | null) =>
      answers.watch?.() ?? Promise.resolve(),
  );
  const wikiMainPath = vi.fn(
    () => answers.path?.() ?? Promise.resolve(MAIN_PATH),
  );
  const invoke = (method: string, ...args: unknown[]): unknown => {
    if (method === 'readDocIfPresent') {
      return readDoc();
    }
    if (method === 'wikiMainPath') {
      return wikiMainPath();
    }
    return watchDoc(args[0] as string, args[1] as string | null);
  };
  const changed = vi.fn();
  const answered = vi.fn();
  const logs: string[] = [];
  const source = createWikiMainSource({
    viewId: 'machine',
    channel: { invoke } as unknown as PageChannel<DocsChannel>,
    log: (line) => logs.push(line),
    changed,
    answered,
  });
  return {
    source,
    reads,
    readDoc,
    watchDoc,
    wikiMainPath,
    changed,
    answered,
    logs,
  };
}

describe('createWikiMainSource', () => {
  it('diskChanged_LaterDifferentText_ChangedRunsOnceWithTheNewShelves', async () => {
    let text = ONE_SHELF;
    const test = setUp({ read: () => Promise.resolve(text) });
    await test.source.start();
    test.changed.mockClear();
    text = TWO_SHELVES;

    test.source.diskChanged({ viewId: 'machine:main', path: MAIN_PATH });
    await settled();

    expect(test.changed).toHaveBeenCalledOnce();
    expect(test.source.shelves().map((shelf) => shelf.title)).toEqual([
      'Shelf one',
      'Shelf two',
    ]);
    expect(test.logs.at(-1)).toBe('read Main.md: 2 shelves');
  });

  it('reread_SameText_ChangedDoesNotRunAgain', async () => {
    const test = setUp();
    await test.source.start();
    expect(test.changed).toHaveBeenCalledOnce();

    await test.source.reread();

    expect(test.readDoc).toHaveBeenCalledTimes(2);
    expect(test.changed).toHaveBeenCalledOnce();
  });

  it.each([
    {
      given: 'the file is absent',
      read: () => Promise.resolve(null),
      fileState: 'absent',
      logged: 'no Main.md: the file is absent',
    },
    {
      given: 'the read rejects',
      read: () => Promise.reject(new Error('denied')),
      fileState: 'unreadable',
      logged: 'no Main.md: denied',
    },
  ])(
    'start_$given: IsNoMainAndChangedRanOnce',
    async ({ read, fileState, logged }) => {
      const test = setUp({ read });

      await test.source.start();

      expect(test.source.fileState()).toBe(fileState);
      expect(test.source.shelves()).toEqual([]);
      expect(test.source.isRead()).toBe(true);
      expect(test.changed).toHaveBeenCalledOnce();
      expect(test.logs).toEqual([logged]);
    },
  );

  it('reread_WatchRejectedAtStart_TriesAgainUntilOneResolves', async () => {
    let isFolderThere = false;
    const test = setUp({
      watch: () =>
        isFolderThere ? Promise.resolve() : Promise.reject(new Error('no dir')),
    });
    await test.source.start();
    expect(test.logs).toContain('not watching Main.md: no dir');
    expect(test.watchDoc).toHaveBeenCalledOnce();
    isFolderThere = true;

    await test.source.reread();
    expect(test.watchDoc).toHaveBeenCalledTimes(2);

    await test.source.reread();
    expect(test.watchDoc).toHaveBeenCalledTimes(2);
  });

  it('reread_PathRejectedAtStart_AsksAgainAndGoesOnToWatchAndRead', async () => {
    let isPathKnown = false;
    const test = setUp({
      path: () =>
        isPathKnown
          ? Promise.resolve(MAIN_PATH)
          : Promise.reject(new Error('no path')),
    });
    await test.source.start();
    expect(test.source.path()).toBeNull();
    expect(test.source.isRead()).toBe(true);
    expect(test.source.fileState()).toBe('unreadable');
    expect(test.changed).toHaveBeenCalledOnce();
    expect(test.watchDoc).not.toHaveBeenCalled();
    isPathKnown = true;

    await test.source.reread();

    expect(test.wikiMainPath).toHaveBeenCalledTimes(2);
    expect(test.source.path()).toBe(MAIN_PATH);
    expect(test.watchDoc).toHaveBeenCalledExactlyOnceWith(
      'machine:main',
      MAIN_PATH,
    );
    expect(test.source.fileState()).toBe('exists');
  });

  it('reread_FileGoesAway_ChangedRunsOnceAndTheFileIsAbsent', async () => {
    let isThere = true;
    const test = setUp({
      read: () => Promise.resolve(isThere ? ONE_SHELF : null),
    });
    await test.source.start();
    test.changed.mockClear();
    isThere = false;

    await test.source.reread();
    await test.source.reread();

    expect(test.changed).toHaveBeenCalledOnce();
    expect(test.source.fileState()).toBe('absent');
    expect(test.source.shelves()).toEqual([]);
  });

  it.each([
    {
      given: 'the same text answers',
      thirdRead: () => Promise.resolve(ONE_SHELF),
      fileState: 'exists',
      changes: 0,
      shelves: ['Shelf one'],
      logs: ['no Main.md: denied'],
    },
    {
      given: 'another text answers',
      thirdRead: () => Promise.resolve(TWO_SHELVES),
      fileState: 'exists',
      changes: 1,
      shelves: ['Shelf one', 'Shelf two'],
      logs: ['no Main.md: denied', 'read Main.md: 2 shelves'],
    },
    {
      given: 'the file turns out absent',
      thirdRead: () => Promise.resolve(null),
      fileState: 'absent',
      changes: 1,
      shelves: [],
      logs: ['no Main.md: denied', 'no Main.md: the file is absent'],
    },
    {
      given: 'another rejection answers',
      thirdRead: () => Promise.reject(new Error('still denied')),
      fileState: 'unreadable',
      changes: 0,
      shelves: ['Shelf one'],
      logs: ['no Main.md: denied'],
    },
  ])(
    'reread_RejectedAfterAText_KeepsItsShelvesUntil: $given',
    async ({ thirdRead, fileState, changes, shelves, logs }) => {
      const answers = [
        () => Promise.resolve<string | null>(ONE_SHELF),
        () => Promise.reject(new Error('denied')),
        thirdRead,
      ];
      const test = setUp({ read: () => answers.shift()!() });
      await test.source.start();
      test.changed.mockClear();
      test.logs.length = 0;

      await test.source.reread();
      const whileRejected = {
        fileState: test.source.fileState(),
        changes: test.changed.mock.calls.length,
        shelves: test.source.shelves().length,
      };
      await test.source.reread();

      expect(whileRejected).toEqual({
        fileState: 'unreadable',
        changes: 0,
        shelves: 1,
      });
      expect({
        fileState: test.source.fileState(),
        changes: test.changed.mock.calls.length,
        shelves: test.source.shelves().map((shelf) => shelf.title),
        logs: test.logs,
      }).toEqual({ fileState, changes, shelves, logs });
    },
  );

  it.each([
    {
      given: 'the file turns out absent',
      secondRead: () => Promise.resolve(null),
      fileState: 'absent',
      changes: 1,
      shelves: [],
    },
    {
      given: 'a text answers',
      secondRead: () => Promise.resolve(TWO_SHELVES),
      fileState: 'exists',
      changes: 1,
      shelves: ['Shelf one', 'Shelf two'],
    },
    {
      given: 'another rejection answers',
      secondRead: () => Promise.reject(new Error('still denied')),
      fileState: 'unreadable',
      changes: 0,
      shelves: [],
    },
  ])(
    'reread_RejectedFirst_ChangedRunsAgainOnlyOnAnAnswer: $given',
    async ({ secondRead, fileState, changes, shelves }) => {
      const answers = [
        () => Promise.reject(new Error('denied')),
        secondRead,
      ] as (() => Promise<string | null>)[];
      const test = setUp({ read: () => answers.shift()!() });
      await test.source.start();
      test.changed.mockClear();

      await test.source.reread();

      expect({
        fileState: test.source.fileState(),
        changes: test.changed.mock.calls.length,
        shelves: test.source.shelves().map((shelf) => shelf.title),
      }).toEqual({ fileState, changes, shelves });
    },
  );

  it('reread_AbsentThenRejectedThenAbsent_StaysAbsentWithNoChange', async () => {
    const answers = [
      () => Promise.resolve<string | null>(null),
      () => Promise.reject(new Error('denied')),
      () => Promise.resolve<string | null>(null),
    ];
    const test = setUp({ read: () => answers.shift()!() });
    await test.source.start();
    test.changed.mockClear();

    await test.source.reread();
    expect(test.source.fileState()).toBe('unreadable');
    await test.source.reread();

    expect(test.source.fileState()).toBe('absent');
    expect(test.changed).not.toHaveBeenCalled();
  });

  it.each([
    { given: 'a text', reads: [ONE_SHELF], answers: 1, changes: 1 },
    {
      given: 'one text twice',
      reads: [ONE_SHELF, ONE_SHELF],
      answers: 2,
      changes: 1,
    },
    { given: 'absent twice', reads: [null, null], answers: 2, changes: 1 },
    { given: 'a rejection', reads: ['reject'], answers: 0, changes: 1 },
    {
      given: 'a text, a rejection and the same text',
      reads: [ONE_SHELF, 'reject', ONE_SHELF],
      answers: 2,
      changes: 1,
    },
    {
      given: 'absent, a rejection and absent',
      reads: [null, 'reject', null],
      answers: 2,
      changes: 1,
    },
    {
      given: 'a rejection and a text',
      reads: ['reject', ONE_SHELF],
      answers: 1,
      changes: 2,
    },
  ])(
    'answered_HearsEachReadThatAnswers: $given',
    async ({ reads, answers, changes }) => {
      const left = [...reads];
      const test = setUp({
        read: () => {
          const next = left.shift() as string | null;
          return next === 'reject'
            ? Promise.reject(new Error('denied'))
            : Promise.resolve(next);
        },
      });

      for (const _read of reads) {
        await test.source.reread();
      }

      expect({
        answers: test.answered.mock.calls.length,
        changes: test.changed.mock.calls.length,
      }).toEqual({ answers, changes });
    },
  );

  it('diskChanged_AnotherViewsId_StartsNoRead', async () => {
    const test = setUp();
    await test.source.start();

    test.source.diskChanged({ viewId: 'machine', path: MAIN_PATH });
    await settled();

    expect(test.readDoc).toHaveBeenCalledOnce();
  });

  it('reread_OlderReadLandsAfterANewerOne_DrawsNothing', async () => {
    const test = setUp({ holdsReads: true });
    const started = test.source.start();
    await settled();
    test.reads[0].resolve(ONE_SHELF);
    await started;
    test.changed.mockClear();
    void test.source.reread();
    void test.source.reread();
    await settled();
    const [, older, newer] = test.reads;

    newer.resolve(TWO_SHELVES);
    await settled();
    test.answered.mockClear();
    older.resolve('## Stale\n');
    await settled();

    expect(test.answered).not.toHaveBeenCalled();
    expect(test.changed).toHaveBeenCalledOnce();
    expect(test.source.shelves().map((shelf) => shelf.title)).toEqual([
      'Shelf one',
      'Shelf two',
    ]);
  });

  it('start_WatchesBeforeItReads_AndASecondCallReturnsTheSamePromise', async () => {
    const test = setUp();
    const order: string[] = [];
    test.watchDoc.mockImplementation(async () => {
      order.push('watch');
    });
    test.readDoc.mockImplementation(async () => {
      order.push('read');
      return ONE_SHELF;
    });

    const first = test.source.start();
    expect(test.source.start()).toBe(first);
    await first;

    expect(order).toEqual(['watch', 'read']);
    expect(test.wikiMainPath).toHaveBeenCalledOnce();
  });

  it('reread_BeforeStart_RunsStart', async () => {
    const test = setUp();

    await test.source.reread();

    expect(test.readDoc).toHaveBeenCalledOnce();
    expect(test.source.isRead()).toBe(true);
  });

  it('dispose_StopsTheWatchAndDropsALateRead', async () => {
    const test = setUp({ holdsReads: true });
    void test.source.start();
    await settled();

    test.source.dispose();
    test.reads[0].resolve(ONE_SHELF);
    await settled();

    expect(test.watchDoc).toHaveBeenLastCalledWith('machine:main', null);
    expect(test.changed).not.toHaveBeenCalled();
    expect(test.answered).not.toHaveBeenCalled();
  });
});
