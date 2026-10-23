import {
  existsSync,
  type FSWatcher,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FileEntry, isMissingFile } from '../../contracts/files';
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

// Every path `trash` hands to `trashItem`.
const trashed: string[] = [];
const files = createNodeFiles({
  trashItem: async (file) => {
    trashed.push(file);
  },
});
let root: string;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function byPath(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => a.path.localeCompare(b.path));
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wigley-node-files-'));
  trashed.length = 0;
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
  it('write_MissingParents_CreatesThemAndWritesText', async () => {
    const file = path.join(root, 'x', 'y', 'z.txt');

    await files.write(file, 'hello');

    expect(await files.read(file)).toBe('hello');
  });

  it('writeBytes_BinaryBytes_ReadBackTheSameBytes', async () => {
    const file = path.join(root, 'x', 'shot.png');

    await files.writeBytes(file, new Uint8Array([0, 255, 137]));

    expect([...readFileSync(file)]).toEqual([0, 255, 137]);
    expect(await files.list(path.join(root, 'x'))).toEqual([
      { path: 'shot.png', kind: 'file' },
    ]);
  });

  it('write_ExistingFile_LeavesNoTempFileBehind', async () => {
    const file = path.join(root, 'z.txt');

    await files.write(file, 'first');
    await files.write(file, 'second');

    expect(await files.list(root)).toEqual([{ path: 'z.txt', kind: 'file' }]);
    expect(await files.read(file)).toBe('second');
  });

  it('list_MissingFolder_ReturnsEmpty', async () => {
    expect(await files.list(path.join(root, 'missing'))).toEqual([]);
  });

  it('list_Recursive_ReturnsRelativeSlashPaths', async () => {
    await files.write(path.join(root, 'a.txt'), 'a');
    await files.write(path.join(root, 'sub', 'b.txt'), 'b');

    const entries = await files.list(root, { recursive: true });

    expect(byPath(entries)).toEqual([
      { path: 'a.txt', kind: 'file' },
      { path: 'sub', kind: 'folder' },
      { path: 'sub/b.txt', kind: 'file' },
    ]);
  });

  it('read_MissingFile_RejectsNamingThePath', async () => {
    const file = path.join(root, 'missing.txt');

    await expect(files.read(file)).rejects.toThrow(file);
  });

  it('read_MissingFile_IsMissingFile', async () => {
    const error = await files
      .read(path.join(root, 'missing.txt'))
      .catch((caught: unknown) => caught);

    expect(isMissingFile(error)).toBe(true);
  });

  it('readBytes_BinaryFile_ReturnsTheSameBytes', async () => {
    const file = path.join(root, 'shot.png');
    writeFileSync(file, Buffer.from([0, 255, 137]));

    expect([...(await files.readBytes(file))]).toEqual([0, 255, 137]);
  });

  it('readBytes_MissingFile_IsMissingFile', async () => {
    const error = await files
      .readBytes(path.join(root, 'missing.png'))
      .catch((caught: unknown) => caught);

    expect(isMissingFile(error)).toBe(true);
  });

  it('readStart_ShorterLimit_ReturnsTheFirstBytes', async () => {
    const file = path.join(root, 'a.txt');
    writeFileSync(file, 'hello');

    expect(await files.readStart(file, 3)).toBe('hel');
  });

  it('readStart_LongerLimit_ReturnsTheWholeFile', async () => {
    const file = path.join(root, 'a.txt');
    writeFileSync(file, 'hello');

    expect(await files.readStart(file, 100)).toBe('hello');
  });

  it('readStart_CutInsideACharacter_LeavesItOut', async () => {
    const file = path.join(root, 'a.txt');
    writeFileSync(file, Buffer.from([0x61, 0xc3, 0xa9]));

    expect(await files.readStart(file, 2)).toBe('a');
  });

  it('readStart_MissingFile_RejectsNamingThePath', async () => {
    const file = path.join(root, 'missing.txt');

    await expect(files.readStart(file, 10)).rejects.toThrow(file);
  });

  it('modified_ReturnsTheMtimeInMilliseconds', async () => {
    const file = path.join(root, 'a.txt');
    writeFileSync(file, 'hello');
    const mtime = new Date('2026-01-02T03:04:05.000Z');
    utimesSync(file, mtime, mtime);

    expect(await files.modified(file)).toBe(1767323045000);
  });

  it('modified_MissingFile_RejectsNamingThePath', async () => {
    const file = path.join(root, 'missing.txt');

    await expect(files.modified(file)).rejects.toThrow(file);
  });

  it('read_Folder_IsNotMissingFile', async () => {
    const error = await files.read(root).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(isMissingFile(error)).toBe(false);
  });

  it('watch_TwoWritesInABurst_ReportsOnce', async () => {
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
      watch.close();
    }

    expect(reports).toEqual(['z.txt']);
  });

  it('watch_WatcherErrors_ClosesAndReportsTheErrorOnce', async () => {
    const reports: string[] = [];
    const errors: unknown[] = [];
    const failure = new Error('watch failed');
    const watch = files.watch(
      root,
      (changed) => reports.push(changed),
      (error) => errors.push(error),
    );
    try {
      watchers.at(-1)?.emit('error', failure);
      watchers.at(-1)?.emit('error', new Error('second failure'));
      await files.write(path.join(root, 'z.txt'), 'text');
      await waitMs(3 * QUIET_MS);
    } finally {
      watch.close();
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
      watch.close();
    }

    expect(reports).toEqual([]);
  });

  it('stat_MissingPath_Null', async () => {
    writeFileSync(path.join(root, 'a'), 'text');

    expect(await files.stat(path.join(root, 'none'))).toBeNull();
    expect(await files.stat(path.join(root, 'a', 'b'))).toBeNull();
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

  it('makeFolder_MissingParents_MakesThem', async () => {
    const folder = path.join(root, 'x', 'y', 'z');

    await files.makeFolder(folder);

    expect(statSync(folder).isDirectory()).toBe(true);
    await expect(files.makeFolder(folder)).resolves.toBeUndefined();
  });

  it('rename_File_Moves', async () => {
    writeFileSync(path.join(root, 'a.md'), 'one');

    await files.rename(path.join(root, 'a.md'), path.join(root, 'b.md'));

    expect(readFileSync(path.join(root, 'b.md'), 'utf8')).toBe('one');
    expect(await files.stat(path.join(root, 'a.md'))).toBeNull();
  });

  it('rename_Folder_MovesItsFiles', async () => {
    mkdirSync(path.join(root, 's'));
    writeFileSync(path.join(root, 's', 'ref.md'), 'ref');

    await files.rename(path.join(root, 's'), path.join(root, 't'));

    expect(readFileSync(path.join(root, 't', 'ref.md'), 'utf8')).toBe('ref');
  });

  it('rename_DestinationExists_RejectsAndKeepsBoth', async () => {
    writeFileSync(path.join(root, 'a.md'), 'one');
    writeFileSync(path.join(root, 'b.md'), 'two');

    await expect(
      files.rename(path.join(root, 'a.md'), path.join(root, 'b.md')),
    ).rejects.toThrow(`${path.join(root, 'b.md')} already exists`);

    expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('one');
    expect(readFileSync(path.join(root, 'b.md'), 'utf8')).toBe('two');
  });

  it.skipIf(!canSymlink)(
    'rename_DestinationIsBrokenSymlink_RejectsAndKeepsBoth',
    async () => {
      writeFileSync(path.join(root, 'a.md'), 'one');
      symlinkSync(path.join(root, 'gone.md'), path.join(root, 'b.md'));

      await expect(
        files.rename(path.join(root, 'a.md'), path.join(root, 'b.md')),
      ).rejects.toThrow(`${path.join(root, 'b.md')} already exists`);

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
    ).rejects.toThrow(`${path.join(root, 'b.md')} already exists`);

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

  it('rename_SourceMissing_RejectsAsMissingFile', async () => {
    const error = await files
      .rename(path.join(root, 'none.md'), path.join(root, 'b.md'))
      .catch((caught: unknown) => caught);

    expect(isMissingFile(error)).toBe(true);
  });

  it('rename_DestinationParentMissing_RejectsAsMissingFile', async () => {
    writeFileSync(path.join(root, 'a.md'), 'one');

    const error = await files
      .rename(path.join(root, 'a.md'), path.join(root, 'none', 'b.md'))
      .catch((caught: unknown) => caught);

    expect(isMissingFile(error)).toBe(true);
    expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('one');
  });

  it('rename_DestinationParentIsFile_RejectsAndKeepsSource', async () => {
    writeFileSync(path.join(root, 'a.md'), 'one');
    writeFileSync(path.join(root, 'f'), 'file');

    await expect(
      files.rename(path.join(root, 'a.md'), path.join(root, 'f', 'b.md')),
    ).rejects.toThrow();

    expect(readFileSync(path.join(root, 'a.md'), 'utf8')).toBe('one');
    expect(readFileSync(path.join(root, 'f'), 'utf8')).toBe('file');
  });

  it('makeFolder_UnderAFile_RejectsWithEnotdir', async () => {
    writeFileSync(path.join(root, 'f'), 'file');

    const error = await files
      .makeFolder(path.join(root, 'f', 'x'))
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('ENOTDIR');
  });

  it('write_OntoAFolder_RejectsAndKeepsFolder', async () => {
    mkdirSync(path.join(root, 'folder'));

    await expect(
      files.write(path.join(root, 'folder'), 'text'),
    ).rejects.toThrow();

    expect(statSync(path.join(root, 'folder')).isDirectory()).toBe(true);
    expect(await files.list(root)).toEqual([
      { path: 'folder', kind: 'folder' },
    ]);
  });

  it('write_ParentIsAFile_RejectsWithEexist', async () => {
    writeFileSync(path.join(root, 'f'), 'file');

    const error = await files
      .write(path.join(root, 'f', 'x.md'), 'text')
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('EEXIST');
  });

  it('write_AncestorAboveParentIsAFile_RejectsWithEnotdir', async () => {
    writeFileSync(path.join(root, 'f'), 'file');

    const error = await files
      .write(path.join(root, 'f', 'x', 'y.md'), 'text')
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('ENOTDIR');
  });

  it('makeFolder_ExistingFile_RejectsWithEexist', async () => {
    writeFileSync(path.join(root, 'f'), 'file');

    const error = await files
      .makeFolder(path.join(root, 'f'))
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('EEXIST');
  });

  it('trash_Path_HandsItToTrashItem', async () => {
    await files.trash(path.join(root, 'a.md'));

    expect(trashed).toEqual([path.join(root, 'a.md')]);
  });
});
