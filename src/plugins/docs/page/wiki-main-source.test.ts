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
    read?: () => Promise<string>;
    watch?: () => Promise<void>;
    path?: () => Promise<string>;
  } = {},
) {
  const reads: PromiseWithResolvers<string>[] = [];
  const readDoc = vi.fn(() => {
    if (answers.holdsReads === true) {
      const read = Promise.withResolvers<string>();
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
    if (method === 'readDoc') {
      return readDoc();
    }
    if (method === 'wikiMainPath') {
      return wikiMainPath();
    }
    return watchDoc(args[0] as string, args[1] as string | null);
  };
  const changed = vi.fn();
  const logs: string[] = [];
  const source = createWikiMainSource({
    viewId: 'machine',
    channel: { invoke } as unknown as PageChannel<DocsChannel>,
    log: (line) => logs.push(line),
    changed,
  });
  return { source, reads, readDoc, watchDoc, wikiMainPath, changed, logs };
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

  it('start_ReadRejects_IsNoMainAndChangedRanOnce', async () => {
    const test = setUp({ read: () => Promise.reject(new Error('gone')) });

    await test.source.start();

    expect(test.source.exists()).toBe(false);
    expect(test.source.shelves()).toEqual([]);
    expect(test.source.isRead()).toBe(true);
    expect(test.changed).toHaveBeenCalledOnce();
    expect(test.logs).toEqual(['no Main.md: gone']);
  });

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
    expect(test.source.exists()).toBe(false);
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
    expect(test.source.exists()).toBe(true);
  });

  it('reread_FileGoesAway_ChangedRunsOnceAndExistsIsFalse', async () => {
    let isThere = true;
    const test = setUp({
      read: () =>
        isThere
          ? Promise.resolve(ONE_SHELF)
          : Promise.reject(new Error('gone')),
    });
    await test.source.start();
    test.changed.mockClear();
    isThere = false;

    await test.source.reread();
    await test.source.reread();

    expect(test.changed).toHaveBeenCalledOnce();
    expect(test.source.exists()).toBe(false);
    expect(test.source.shelves()).toEqual([]);
  });

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
    older.resolve('## Stale\n');
    await settled();

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
  });
});
