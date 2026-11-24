import {
  existsSync,
  type FSWatcher,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMissingFile } from '../../contracts/files';
import type { OsName } from '../../contracts/platform';
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

// When set, `link` and `rename` run these in place of the real calls.
const linkStandIn = vi.hoisted(() => ({
  current: null as ((from: string, to: string) => Promise<void>) | null,
}));
const renameStandIn = vi.hoisted(() => ({
  current: null as ((from: string, to: string) => Promise<void>) | null,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    link: (from: string, to: string) =>
      (linkStandIn.current ?? fs.link)(from, to),
    rename: (from: string, to: string) =>
      (renameStandIn.current ?? fs.rename)(from, to),
  };
});

// Each wait the adapter asks `node:timers/promises` for, which resolves at
// once.
const delays = vi.hoisted(() => [] as number[]);
vi.mock('node:timers/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:timers/promises')>()),
  setTimeout: (ms: number) => {
    delays.push(ms);
    return Promise.resolve();
  },
}));

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
  renameStandIn.current = null;
  delays.length = 0;
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

  // Breaks on no retry, a retry on any code, an off-by-one in the try count,
  // or the temp file left after the last failure.
  it.each<{
    method: 'write' | 'writeBytes';
    code: string;
    times: number;
    result: string;
    rejects: boolean;
    expected: string | number[];
    waits: number[];
  }>([
    {
      method: 'write',
      code: 'EPERM',
      times: 2,
      result: 'writes the new text',
      rejects: false,
      expected: 'new',
      waits: [10, 20],
    },
    {
      method: 'writeBytes',
      code: 'EBUSY',
      times: 1,
      result: 'writes the new bytes',
      rejects: false,
      expected: [1, 2],
      waits: [10],
    },
    {
      method: 'write',
      code: 'EPERM',
      times: 5,
      result: 'rejects and keeps the old text',
      rejects: true,
      expected: 'old',
      waits: [10, 20, 40, 80],
    },
    {
      method: 'write',
      code: 'EACCES',
      times: 1,
      result: 'rejects at once and keeps the old text',
      rejects: true,
      expected: 'old',
      waits: [],
    },
  ])(
    '$method with a rename failing $code $times times $result',
    async ({ method, code, times, rejects, expected, waits }) => {
      const file = path.join(root, 'z.txt');
      writeFileSync(file, 'old');
      const actual =
        await vi.importActual<typeof import('node:fs/promises')>(
          'node:fs/promises',
        );
      let failures = 0;
      renameStandIn.current = async (from, to) => {
        if (failures < times) {
          failures += 1;
          throw Object.assign(new Error(`rename failed: ${code}`), { code });
        }
        await actual.rename(from, to);
      };

      const written =
        method === 'write'
          ? files.write(file, 'new')
          : files.writeBytes(file, new Uint8Array([1, 2]));
      const error = await written.then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(rejects ? errorCode(error) : error).toBe(rejects ? code : null);
      const stored =
        typeof expected === 'string'
          ? await files.read(file)
          : [...(await files.readBytes(file))];
      expect(stored).toEqual(expected);
      expect(await files.list(root)).toEqual([{ path: 'z.txt', kind: 'file' }]);
      expect(delays).toEqual(waits);
    },
  );

  // A rename failing EPERM stands in for Windows, where a rename onto a
  // folder fails EPERM and would be retried.
  it('copy_OntoFolder_RejectsWithEisdirNamingItBeforeAnyRename', async () => {
    const from = path.join(root, 'a.txt');
    const to = path.join(root, 'd');
    writeFileSync(from, 'new');
    mkdirSync(to);
    let renames = 0;
    renameStandIn.current = async () => {
      renames += 1;
      throw Object.assign(new Error('rename failed: EPERM'), { code: 'EPERM' });
    };

    const error = await files.copy(from, to).catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('EISDIR');
    expect((error as Error).message).toContain(to);
    expect(renames).toBe(0);
    expect(delays).toEqual([]);
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

  // Breaks if an event naming only a write's temp file drops the target,
  // reports the temp file's name, or reports a target a failed write never
  // made.
  it.each<{
    name: string;
    targetBefore: boolean;
    act: (temp: string, target: string) => void;
    reports: string[];
  }>([
    {
      name: 'temp file then rename',
      targetBefore: false,
      act: (temp, target) => {
        writeFileSync(temp, 'new');
        renameSync(temp, target);
      },
      reports: ['tasks.json'],
    },
    {
      name: 'temp file only, target present',
      targetBefore: true,
      act: (temp) => writeFileSync(temp, 'new'),
      reports: ['tasks.json'],
    },
    {
      name: 'temp file only, no target',
      targetBefore: false,
      act: (temp) => {
        writeFileSync(temp, 'new');
        rmSync(temp);
      },
      reports: [],
    },
    {
      name: 'target and temp file in one window',
      targetBefore: false,
      act: (temp, target) => {
        writeFileSync(target, 'new');
        writeFileSync(temp, 'newer');
      },
      reports: ['tasks.json'],
    },
  ])(
    'watch_TempFileEvent_ReportsItsTargetOnceWhenPresent: $name',
    { timeout: 10000 },
    async ({ targetBefore, act, reports: expected }) => {
      const target = path.join(root, 'tasks.json');
      const temp = path.join(root, '.tasks.json.0a1b2c3d.tmp');
      if (targetBefore) {
        writeFileSync(target, 'old');
      }
      const reports: string[] = [];
      const watch = files.watch(root, (changed) => reports.push(changed));
      try {
        act(temp, target);
        // Reported after every earlier event, so the wait covers them.
        writeFileSync(path.join(root, 'done.txt'), '');
        await vi.waitFor(() => expect(reports).toContain('done.txt'), {
          timeout: 5000,
        });
        await waitMs(3 * QUIET_MS);
      } finally {
        watch.dispose();
      }

      expect(reports.filter((changed) => changed !== 'done.txt')).toEqual(
        expected,
      );
    },
  );

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

  // Breaks if a watch opening or closing on macOS stops telling the other
  // live watches they may have missed changes, or tells the watch itself.
  it.each<{ os: OsName; missedAfterOpen: number; missedAfterClose: number }>([
    { os: 'macos', missedAfterOpen: 1, missedAfterClose: 2 },
    { os: 'linux', missedAfterOpen: 0, missedAfterClose: 0 },
  ])(
    'watch_AnotherWatchOpensThenCloses_CallsOnMissedOnMacOS: $os',
    async ({ os, missedAfterOpen, missedAfterClose }) => {
      const osFiles = createNodeFiles({ trashItem: async () => {}, os });
      let firstMissed = 0;
      let secondMissed = 0;
      const first = osFiles.watch(root, () => {}, {
        onMissed: () => (firstMissed += 1),
      });
      try {
        const second = osFiles.watch(path.join(root, 'other'), () => {}, {
          onMissed: () => (secondMissed += 1),
        });
        await waitMs(3 * QUIET_MS);
        const afterOpen = firstMissed;
        second.dispose();
        await waitMs(3 * QUIET_MS);

        expect([afterOpen, firstMissed, secondMissed]).toEqual([
          missedAfterOpen,
          missedAfterClose,
          0,
        ]);
      } finally {
        first.dispose();
      }
    },
  );

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
