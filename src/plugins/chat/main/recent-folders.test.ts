import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import type { RecentFolder } from '../contract';
import {
  addRecentFolder,
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
    paths: posixPaths,
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

  it('addRecentFolder_WindowsCaseDiffers_OneEntry', () => {
    const earlier: RecentFolder[] = [
      { projectDir: 'C:\\Dev\\App', profile: 'work', lastUsed: 10 },
    ];
    const added: RecentFolder = {
      projectDir: 'c:\\dev\\app\\',
      profile: 'work',
      lastUsed: 20,
    };

    expect(addRecentFolder(earlier, added, windowsPaths)).toEqual([added]);
  });

  it('record_full_dropsTheOldest', async () => {
    const test = setUp();
    const full: RecentFolder[] = Array.from(
      { length: MAX_RECENT_FOLDERS },
      (_, index) => ({
        projectDir: `/p${index}`,
        profile: 'work',
        lastUsed: 1000 - index,
      }),
    );
    const oldest = full[MAX_RECENT_FOLDERS - 1].projectDir;
    await test.data.write(RECENT_FOLDERS_FILE, JSON.stringify(full));

    await test.recent.record('/new', 'work');

    const saved = await test.saved();
    expect(saved).toHaveLength(MAX_RECENT_FOLDERS);
    expect(saved[0].projectDir).toBe('/new');
    expect(saved.map((folder) => folder.projectDir)).not.toContain(oldest);
  });

  it('list_missingFile_empty', async () => {
    expect(await setUp().recent.list()).toEqual([]);
  });

  it('list_unreadableFile_emptyAndLogged', async () => {
    const test = setUp();
    await test.data.write(RECENT_FOLDERS_FILE, '{oops');

    expect(await test.recent.list()).toEqual([]);
    expect(test.logged.some((line) => line.includes(RECENT_FOLDERS_FILE))).toBe(
      true,
    );
  });

  it('list_readFails_emptyAndLogged', async () => {
    const test = setUp();
    test.data.read = () => Promise.reject(new Error('EACCES: denied'));

    expect(await test.recent.list()).toEqual([]);
    expect(test.logged).toContainEqual(
      expect.stringContaining('EACCES: denied'),
    );
  });

  it('record_readFails_rejectsAndKeepsTheFile', async () => {
    const test = setUp();
    const earlier = JSON.stringify([
      { projectDir: '/a', profile: 'work', lastUsed: 10 },
    ]);
    await test.data.write(RECENT_FOLDERS_FILE, earlier);
    const read = test.data.read;
    test.data.read = () => Promise.reject(new Error('EIO: i/o error'));

    await expect(test.recent.record('/b', 'work')).rejects.toThrow('EIO');

    test.data.read = read;
    expect(await test.data.read(RECENT_FOLDERS_FILE)).toBe(earlier);
  });

  it('record_unparseableFile_rejectsAndKeepsTheFile', async () => {
    const test = setUp();
    await test.data.write(RECENT_FOLDERS_FILE, '{oops');

    await expect(test.recent.record('/b', 'work')).rejects.toThrow();

    expect(await test.data.read(RECENT_FOLDERS_FILE)).toBe('{oops');
  });

  it('record_missingFile_writesTheFirstEntry', async () => {
    const test = setUp();

    await test.recent.record('/a', 'work');

    expect(await test.saved()).toEqual([
      { projectDir: '/a', profile: 'work', lastUsed: 1000 },
    ]);
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
