import { describe, expect, it } from 'vitest';
import { type Files, isMissingFile } from '../contracts/files';

// One contract test's adapter, fresh for the test, and `at`, which turns a
// slash path under the test's empty home folder into the adapter's path.
export interface FilesUnderTest {
  files: Files;
  at(relative: string): string;
}

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (caught: unknown) => caught,
  );
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

// The behaviour every `Files` adapter shares, which callers rely on whichever
// adapter they hold. `current` returns the adapter under test, called inside
// each test.
export function describeFilesContract(current: () => FilesUnderTest): void {
  describe('Files contract', () => {
    it('write_MissingParents_CreatesThemAndWritesText', async () => {
      const { files, at } = current();

      await files.write(at('x/y/z.txt'), 'hello');

      expect(await files.read(at('x/y/z.txt'))).toBe('hello');
    });

    it('writeBytes_BinaryBytes_ReadBackTheSameBytes', async () => {
      const { files, at } = current();

      await files.writeBytes(at('x/shot.png'), new Uint8Array([0, 255, 137]));

      expect([...(await files.readBytes(at('x/shot.png')))]).toEqual([
        0, 255, 137,
      ]);
      expect(await files.list(at('x'))).toEqual([
        { path: 'shot.png', kind: 'file' },
      ]);
    });

    it.each([
      {
        method: 'read',
        call: (files: Files, file: string) => files.read(file),
      },
      {
        method: 'readStart',
        call: (files: Files, file: string) => files.readStart(file, 10),
      },
      {
        method: 'readBytes',
        call: (files: Files, file: string) => files.readBytes(file),
      },
      {
        method: 'modified',
        call: (files: Files, file: string) => files.modified(file),
      },
      {
        method: 'realPath',
        call: (files: Files, file: string) => files.realPath(file),
      },
    ])(
      '$method of a missing file rejects as a missing file naming it',
      async ({ call }) => {
        const { files, at } = current();

        const error = await rejectionOf(call(files, at('missing.txt')));

        expect(isMissingFile(error)).toBe(true);
        expect(error).toMatchObject({
          message: expect.stringContaining(at('missing.txt')),
        });
      },
    );

    it.each([
      { limit: 3, expected: 'hel' },
      { limit: 100, expected: 'hello' },
    ])(
      'readStart with limit $limit returns $expected',
      async ({ limit, expected }) => {
        const { files, at } = current();
        await files.write(at('a.txt'), 'hello');

        expect(await files.readStart(at('a.txt'), limit)).toBe(expected);
      },
    );

    it('readStart_CutInsideACharacter_LeavesItOut', async () => {
      const { files, at } = current();
      await files.write(at('a.md'), 'aé');

      expect(await files.readStart(at('a.md'), 2)).toBe('a');
    });

    it('list_MissingFolder_ReturnsEmpty', async () => {
      const { files, at } = current();

      expect(await files.list(at('missing'))).toEqual([]);
    });

    it('list_Recursive_ReturnsRelativeSlashPaths', async () => {
      const { files, at } = current();
      await files.write(at('top/a.txt'), 'a');
      await files.write(at('top/sub/b.txt'), 'b');

      const entries = await files.list(at('top'), { recursive: true });

      expect([...entries].sort((a, b) => a.path.localeCompare(b.path))).toEqual(
        [
          { path: 'a.txt', kind: 'file' },
          { path: 'sub', kind: 'folder' },
          { path: 'sub/b.txt', kind: 'file' },
        ],
      );
    });

    it('stat_MissingPath_Null', async () => {
      const { files, at } = current();
      await files.write(at('a'), 'text');

      expect(await files.stat(at('none'))).toBeNull();
      expect(await files.stat(at('a/b'))).toBeNull();
    });

    it('makeFolder_EmptyFolder_StatsAndLists', async () => {
      const { files, at } = current();

      await files.makeFolder(at('top/e'));

      expect(await files.stat(at('top/e'))).toEqual({
        isFolder: true,
        isLink: false,
      });
      expect(await files.list(at('top'))).toEqual([
        { path: 'e', kind: 'folder' },
      ]);
    });

    it('makeFolder_ExistingFolder_Resolves', async () => {
      const { files, at } = current();
      await files.write(at('e/a.md'), 'a');

      await expect(files.makeFolder(at('e'))).resolves.toBeUndefined();
    });

    it('makeFolder_ExistingFile_RejectsWithEexistAndKeepsIt', async () => {
      const { files, at } = current();
      await files.write(at('a.md'), 'one');

      const error = await rejectionOf(files.makeFolder(at('a.md')));

      expect(errorCode(error)).toBe('EEXIST');
      expect(await files.read(at('a.md'))).toBe('one');
    });

    it('makeFolder_UnderAFile_RejectsWithEnotdirAndKeepsIt', async () => {
      const { files, at } = current();
      await files.write(at('f'), 'file');

      const error = await rejectionOf(files.makeFolder(at('f/x')));

      expect(errorCode(error)).toBe('ENOTDIR');
      expect(await files.read(at('f'))).toBe('file');
    });

    it('write_OntoAFolder_RejectsAndKeepsTheFolder', async () => {
      const { files, at } = current();
      await files.makeFolder(at('top/folder'));

      await expect(files.write(at('top/folder'), 'text')).rejects.toThrow();

      expect(await files.list(at('top'))).toEqual([
        { path: 'folder', kind: 'folder' },
      ]);
    });

    it('write_ParentIsAFile_RejectsWithEexistAndKeepsIt', async () => {
      const { files, at } = current();
      await files.write(at('f'), 'file');

      const error = await rejectionOf(files.write(at('f/x.md'), 'text'));

      expect(errorCode(error)).toBe('EEXIST');
      expect(await files.read(at('f'))).toBe('file');
    });

    it('write_AncestorAboveParentIsAFile_RejectsWithEnotdir', async () => {
      const { files, at } = current();
      await files.write(at('f'), 'file');

      const error = await rejectionOf(files.write(at('f/x/y.md'), 'text'));

      expect(errorCode(error)).toBe('ENOTDIR');
    });

    it('rename_File_Moves', async () => {
      const { files, at } = current();
      await files.write(at('a.md'), 'one');

      await files.rename(at('a.md'), at('b.md'));

      expect(await files.read(at('b.md'))).toBe('one');
      expect(await files.stat(at('a.md'))).toBeNull();
    });

    it('rename_Folder_MovesItsFiles', async () => {
      const { files, at } = current();
      await files.write(at('s/ref.md'), 'ref');

      await files.rename(at('s'), at('t'));

      expect(await files.read(at('t/ref.md'))).toBe('ref');
      expect(await files.stat(at('s'))).toBeNull();
    });

    it('rename_LastFileInFolder_KeepsTheFolder', async () => {
      const { files, at } = current();
      await files.write(at('s/a.md'), 'one');

      await files.rename(at('s/a.md'), at('b.md'));

      expect(await files.stat(at('s'))).toEqual({
        isFolder: true,
        isLink: false,
      });
      expect(await files.list(at('s'))).toEqual([]);
    });

    it('rename_DestinationExists_RejectsNamingItAndKeepsBoth', async () => {
      const { files, at } = current();
      await files.write(at('a.md'), 'one');
      await files.write(at('b.md'), 'two');

      await expect(files.rename(at('a.md'), at('b.md'))).rejects.toThrow(
        at('b.md'),
      );

      expect(await files.read(at('a.md'))).toBe('one');
      expect(await files.read(at('b.md'))).toBe('two');
    });

    it('rename_SourceMissing_RejectsAsMissingFile', async () => {
      const { files, at } = current();
      await files.makeFolder(at('top'));

      const error = await rejectionOf(
        files.rename(at('top/none.md'), at('top/b.md')),
      );

      expect(isMissingFile(error)).toBe(true);
      expect(await files.stat(at('top/b.md'))).toBeNull();
    });

    it('rename_DestinationParentMissing_RejectsAsMissingFileAndKeepsSource', async () => {
      const { files, at } = current();
      await files.write(at('a.md'), 'one');

      const error = await rejectionOf(
        files.rename(at('a.md'), at('none/b.md')),
      );

      expect(isMissingFile(error)).toBe(true);
      expect(await files.read(at('a.md'))).toBe('one');
      expect(await files.stat(at('none'))).toBeNull();
    });

    it('rename_DestinationParentIsFile_RejectsWithEnotdirAndKeepsBoth', async () => {
      const { files, at } = current();
      await files.write(at('a.md'), 'one');
      await files.write(at('f'), 'file');

      const error = await rejectionOf(files.rename(at('a.md'), at('f/b.md')));

      expect(errorCode(error)).toBe('ENOTDIR');
      expect(await files.read(at('a.md'))).toBe('one');
      expect(await files.read(at('f'))).toBe('file');
    });
  });
}
