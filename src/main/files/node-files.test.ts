import {
  existsSync,
  type FSWatcher,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMissingFile } from '../../contracts/files';
import { describeFilesContract } from '../../shared/files-contract.test-support';
import { osPlatform } from '../../shared/os-platform';
import { createNodeFiles } from './node-files';

// The real `watch`, keeping each watcher it opens so a test can make one fail.
const watchers = vi.hoisted(() => [] as FSWatcher[]);
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    watch: (...args: Parameters<typeof fs.watch>) => {
      const watcher = fs.watch(...args);
      watchers.push(watcher);
      return watcher;
    },
  };
});

// When set, `link` runs this in place of the real call.
const linkStandIn = vi.hoisted(() => ({
  current: null as ((from: string, to: string) => Promise<void>) | null,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    link: (from: string, to: string) =>
      (linkStandIn.current ?? fs.link)(from, to),
  };
});

const QUIET_MS = 100;

const files = createNodeFiles({
  trashItem: () => Promise.reject(new Error('no test here trashes a path')),
  os: osPlatform(process.platform),
});
let root: string;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wigley-node-files-'));
  linkStandIn.current = null;
});

// Whether `folder`'s volume finds a name in any case.
function isCaseInsensitive(folder: string): boolean {
  const probe = path.join(folder, 'case-probe');
  writeFileSync(probe, '');
  try {
    return existsSync(path.join(folder, 'CASE-PROBE'));
  } finally {
    rmSync(probe);
  }
}

// Whether this process may create a symlink: Windows refuses with `EPERM`
// unless Developer Mode is on or the process is elevated.
function canCreateSymlink(): boolean {
  const folder = mkdtempSync(path.join(tmpdir(), 'wigley-symlink-probe-'));
  try {
    symlinkSync(path.join(folder, 'target'), path.join(folder, 'link'));
    return true;
  } catch (error) {
    if (errorCode(error) === 'EPERM') {
      return false;
    }
    throw error;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const canSymlink = canCreateSymlink();

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createNodeFiles', () => {
  describeFilesContract(() => ({
    files,
    at: (relative) => path.join(root, ...relative.split('/')),
  }));

  it('write_ExistingFile_LeavesNoTempFileBehind', async () => {
    const file = path.join(root, 'z.txt');

    await files.write(file, 'first');
    await files.write(file, 'second');

    expect(await files.list(root)).toEqual([{ path: 'z.txt', kind: 'file' }]);
    expect(await files.read(file)).toBe('second');
  });

  it('readBytes_FileWrittenToDisk_ReturnsTheSameBytes', async () => {
    const file = path.join(root, 'shot.png');
    writeFileSync(file, Buffer.from([0, 255, 137]));

    expect([...(await files.readBytes(file))]).toEqual([0, 255, 137]);
  });

  it('modified_ReturnsTheMtimeInMilliseconds', async () => {
    const file = path.join(root, 'a.txt');
    writeFileSync(file, 'hello');
    const mtime = new Date('2026-01-02T03:04:05.000Z');
    utimesSync(file, mtime, mtime);

    expect(await files.modified(file)).toBe(1767323045000);
  });

  it('read_Folder_IsNotMissingFile', async () => {
    const error = await files.read(root).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(isMissingFile(error)).toBe(false);
  });

  it('watch_TwoWritesInABurst_ReportsOnce', { timeout: 10000 }, async () => {
    const reports: string[] = [];
    const watch = files.watch(root, (changed) => reports.push(changed));
    try {
      const file = path.join(root, 'z.txt');
      await files.write(file, 'first');
      await waitMs(20);
      await files.write(file, 'second');
      await vi.waitFor(() => expect(reports).not.toHaveLength(0), {
        timeout: 5000,
      });
      await waitMs(3 * QUIET_MS);
    } finally {
      watch.dispose();
    }

    expect(reports).toEqual(['z.txt']);
  });

  it(
    'watch_NotRecursive_ReportsOnlyTheFolderOwnEntries',
    { timeout: 10000 },
    async () => {
      mkdirSync(path.join(root, 'sub'));
      const reports: string[] = [];
      const watch = files.watch(root, (changed) => reports.push(changed), {
        recursive: false,
      });
      try {
        await files.write(path.join(root, 'sub', 'a.txt'), 'nested');
        await files.write(path.join(root, 'b.txt'), 'direct');
        await vi.waitFor(() => expect(reports).toContain('b.txt'), {
          timeout: 5000,
        });
      } finally {
        watch.dispose();
      }

      // The OS may report `sub` itself, its contents having changed.
      expect(reports.filter((changed) => changed !== 'sub')).toEqual(['b.txt']);
    },
  );

  it('watch_WatcherErrors_ClosesAndReportsTheErrorOnce', async () => {
    const reports: string[] = [];
    const errors: unknown[] = [];
    const failure = new Error('watch failed');
    const watch = files.watch(root, (changed) => reports.push(changed), {
      onError: (error) => errors.push(error),
    });
    try {
      watchers.at(-1)?.emit('error', failure);
      watchers.at(-1)?.emit('error', new Error('second failure'));
      await files.write(path.join(root, 'z.txt'), 'text');
      await waitMs(3 * QUIET_MS);
    } finally {
      watch.dispose();
    }

    expect(errors).toEqual([failure]);
    expect(reports).toEqual([]);
  });

  it('watch_WatcherErrorsWithNoOnError_ClosesSilently', async () => {
    const reports: string[] = [];
    const watch = files.watch(root, (changed) => reports.push(changed));
    try {
      watchers.at(-1)?.emit('error', new Error('watch failed'));
      await files.write(path.join(root, 'z.txt'), 'text');
      await waitMs(3 * QUIET_MS);
    } finally {
      watch.dispose();
    }

    expect(reports).toEqual([]);
  });

  it.skipIf(!canSymlink)(
    'stat_FileFolderAndLink_IsFolderAndIsLink',
    async () => {
      writeFileSync(path.join(root, 'a.md'), 'text');
      mkdirSync(path.join(root, 'folder'));
      writeFileSync(path.join(root, 'folder', 'b.md'), 'text');
      symlinkSync(path.join(root, 'folder'), path.join(root, 'link'));

      expect(await files.stat(path.join(root, 'a.md'))).toEqual({
        isFolder: false,
        isLink: false,
      });
      expect(await files.stat(root)).toEqual({ isFolder: true, isLink: false });
      expect(await files.stat(path.join(root, 'link'))).toEqual({
        isFolder: true,
        isLink: true,
      });
      expect(await files.stat(path.join(root, 'link', 'b.md'))).toEqual({
        isFolder: false,
        isLink: false,
      });
    },
  );

  it.skipIf(!canSymlink)('stat_DanglingLink_Null', async () => {
    symlinkSync(path.join(root, 'gone.md'), path.join(root, 'link.md'));

    expect(await files.stat(path.join(root, 'link.md'))).toBeNull();
  });

  it.skipIf(!canSymlink)('realPath_Symlink_ReturnsTarget', async () => {
    writeFileSync(path.join(root, 'real.md'), 'text');
    symlinkSync(path.join(root, 'real.md'), path.join(root, 'link.md'));

    expect(await files.realPath(path.join(root, 'link.md'))).toBe(
      realpathSync(path.join(root, 'real.md')),
    );
    const error = await files
      .realPath(path.join(root, 'none'))
      .catch((caught: unknown) => caught);
    expect(isMissingFile(error)).toBe(true);
  });

  it.skipIf(!canSymlink)(
    'rename_DestinationIsBrokenSymlink_RejectsAndKeepsBoth',
    async () => {
      writeFileSync(path.join(root, 'a.md'), 'one');
      symlinkSync(path.join(root, 'gone.md'), path.join(root, 'b.md'));

      await expect(
        files.rename(path.join(root, 'a.md'), path.join(root, 'b.md')),
      ).rejects.toThrow(path.join(root, 'b.md'));

      expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('one');
      expect(lstatSync(path.join(root, 'b.md')).isSymbolicLink()).toBe(true);
    },
  );

  it('rename_CaseOnlyOnCaseInsensitiveVolume_Renames', async ({ skip }) => {
    if (!isCaseInsensitive(root)) {
      skip();
    }
    writeFileSync(path.join(root, 'readme.md'), 'one');

    await files.rename(
      path.join(root, 'readme.md'),
      path.join(root, 'README.md'),
    );

    expect(await files.list(root)).toEqual([
      { path: 'README.md', kind: 'file' },
    ]);
    expect(readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('one');
  });

  it('rename_FileAppearsAtDestinationMidMove_RejectsAndKeepsBoth', async () => {
    writeFileSync(path.join(root, 'a.md'), 'one');
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    linkStandIn.current = async (from, to) => {
      writeFileSync(to, 'two');
      await actual.link(from, to);
    };

    await expect(
      files.rename(path.join(root, 'a.md'), path.join(root, 'b.md')),
    ).rejects.toThrow(path.join(root, 'b.md'));

    expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('one');
    expect(readFileSync(path.join(root, 'b.md'), 'utf8')).toBe('two');
  });

  it('rename_VolumeTakesNoHardLink_RenamesInstead', async () => {
    writeFileSync(path.join(root, 'a.md'), 'one');
    linkStandIn.current = async () => {
      throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
    };

    await files.rename(path.join(root, 'a.md'), path.join(root, 'b.md'));

    expect(readFileSync(path.join(root, 'b.md'), 'utf8')).toBe('one');
    expect(await files.stat(path.join(root, 'a.md'))).toBeNull();
  });

  it.skipIf(!canSymlink)('rename_Symlink_MovesTheLinkItself', async () => {
    writeFileSync(path.join(root, 'real.md'), 'one');
    symlinkSync(path.join(root, 'real.md'), path.join(root, 'a.md'));

    await files.rename(path.join(root, 'a.md'), path.join(root, 'b.md'));

    expect(lstatSync(path.join(root, 'b.md')).isSymbolicLink()).toBe(true);
    expect(await files.stat(path.join(root, 'a.md'))).toBeNull();
  });
});
