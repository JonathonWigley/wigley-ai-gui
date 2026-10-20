import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { RecentFolder } from '../contract';
import {
  createRecentFolders,
  MAX_RECENT_FOLDERS,
  RECENT_FOLDERS_FILE,
} from './recent-folders';

function setUp() {
  const data = createMemoryFiles();
  const logged: string[] = [];
  let now = 1000;
  const recent = createRecentFolders({
    data,
    clock: { now: () => now },
    log: (source, message) => logged.push(`[${source}] ${message}`),
  });
  return {
    data,
    logged,
    recent,
    setNow: (value: number) => {
      now = value;
    },
    saved: async (): Promise<RecentFolder[]> =>
      JSON.parse(await data.read(RECENT_FOLDERS_FILE)),
  };
}

describe('createRecentFolders', () => {
  it('record_newestFirstDeduplicated', async () => {
    const test = setUp();
    const earlier: RecentFolder[] = [
      { projectDir: '/a', profile: 'work', lastUsed: 10 },
      { projectDir: '/b', profile: 'personal', lastUsed: 5 },
    ];
    await test.data.write(RECENT_FOLDERS_FILE, JSON.stringify(earlier));
    test.setNow(2000);

    await test.recent.record('/b', 'work');

    expect(await test.saved()).toEqual([
      { projectDir: '/b', profile: 'work', lastUsed: 2000 },
      { projectDir: '/a', profile: 'work', lastUsed: 10 },
    ]);
  });

  it('record_keepsAtMostTwenty', async () => {
    const test = setUp();
    const twenty: RecentFolder[] = Array.from({ length: 20 }, (_, index) => ({
      projectDir: `/p${index}`,
      profile: 'work',
      lastUsed: 100 - index,
    }));
    await test.data.write(RECENT_FOLDERS_FILE, JSON.stringify(twenty));

    await test.recent.record('/new', 'work');

    const saved = await test.saved();
    expect(MAX_RECENT_FOLDERS).toBe(20);
    expect(saved).toHaveLength(20);
    expect(saved[0].projectDir).toBe('/new');
    expect(saved.map((folder) => folder.projectDir)).not.toContain('/p19');
  });

  it('list_missingFile_empty', async () => {
    expect(await setUp().recent.list()).toEqual([]);
  });

  it('list_unreadableFile_emptyAndLogged', async () => {
    const test = setUp();
    await test.data.write(RECENT_FOLDERS_FILE, '{oops');

    expect(await test.recent.list()).toEqual([]);
    expect(
      test.logged.some((line) =>
        line.startsWith('[chat] recent-folders.json unreadable:'),
      ),
    ).toBe(true);
  });

  it('record_concurrentWritesKeepBoth', async () => {
    const test = setUp();

    await Promise.all([
      test.recent.record('/a', 'work'),
      test.recent.record('/b', 'personal'),
    ]);

    expect((await test.saved()).map((folder) => folder.projectDir)).toEqual([
      '/b',
      '/a',
    ]);
  });
});
