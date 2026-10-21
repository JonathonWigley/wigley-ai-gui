import { beforeEach, describe, expect, it } from 'vitest';
import { isMissingFile } from '../contracts/files';
import { createMemoryFiles, type MemoryFiles } from './memory-files';

let files: MemoryFiles;

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

beforeEach(() => {
  files = createMemoryFiles();
});

describe('createMemoryFiles', () => {
  it('modified_StampsTheClockAtEachWrite', async () => {
    const clock = { now: () => 5000 };
    const stamped = createMemoryFiles(clock);

    await stamped.write('/h/a.md', 'one');
    expect(await stamped.modified('/h/a.md')).toBe(5000);

    clock.now = () => 7000;
    await stamped.write('/h/a.md', 'two');
    expect(await stamped.modified('/h/a.md')).toBe(7000);
  });

  it('modified_NoClock_IsZero', async () => {
    await files.write('/h/a.md', 'one');

    expect(await files.modified('/h/a.md')).toBe(0);
  });

  it('modified_MissingFile_Rejects', async () => {
    await expect(files.modified('/nope')).rejects.toThrow('no file at /nope');
  });

  it('readStart_CutInsideACharacter_LeavesItOut', async () => {
    await files.write('/h/a.md', 'aé');

    expect(await files.readStart('/h/a.md', 2)).toBe('a');
  });

  it('rename_DestinationExists_RejectsAndKeepsBoth', async () => {
    await files.write('/h/a.md', 'one');
    await files.write('/h/b.md', 'two');

    await expect(files.rename('/h/a.md', '/h/b.md')).rejects.toThrow(
      '/h/b.md already exists',
    );

    expect(await files.read('/h/a.md')).toBe('one');
    expect(await files.read('/h/b.md')).toBe('two');
  });

  it('rename_Folder_MovesSubtreeAndReports', async () => {
    await files.write('/h/s/SKILL.md', 'skill');
    await files.write('/h/s/ref.md', 'ref');
    const reports: string[] = [];
    files.watch('/h', (changed) => reports.push(changed));

    await files.rename('/h/s', '/h/t');

    expect(await files.read('/h/t/ref.md')).toBe('ref');
    expect(await files.stat('/h/s')).toBeNull();
    expect(reports.sort()).toEqual([
      's/SKILL.md',
      's/ref.md',
      't/SKILL.md',
      't/ref.md',
    ]);
  });

  it('rename_SourceMissing_RejectsAsMissingFile', async () => {
    await files.makeFolder('/h');

    const error = await files
      .rename('/h/none.md', '/h/b.md')
      .catch((caught: unknown) => caught);

    expect(isMissingFile(error)).toBe(true);
    expect(await files.stat('/h/b.md')).toBeNull();
  });

  it('rename_DestinationParentMissing_RejectsAsMissingFileAndKeepsSource', async () => {
    await files.write('/h/a.md', 'one');

    const error = await files
      .rename('/h/a.md', '/h/none/b.md')
      .catch((caught: unknown) => caught);

    expect(isMissingFile(error)).toBe(true);
    expect(await files.read('/h/a.md')).toBe('one');
    expect(await files.stat('/h/none')).toBeNull();
  });

  it('rename_FolderIntoItself_RejectsAndMovesNothing', async () => {
    await files.write('/h/s/ref.md', 'ref');

    await expect(files.rename('/h/s', '/h/s/t')).rejects.toThrow('/h/s');

    expect(await files.read('/h/s/ref.md')).toBe('ref');
    expect(await files.stat('/h/s/t')).toBeNull();
  });

  it('makeFolder_ExistingFolder_Resolves', async () => {
    await files.write('/h/e/a.md', 'a');

    await expect(files.makeFolder('/h/e')).resolves.toBeUndefined();
  });

  it('makeFolder_ExistingFile_RejectsWithEexist', async () => {
    await files.write('/h/a.md', 'one');

    await expect(files.makeFolder('/h/a.md')).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await files.read('/h/a.md')).toBe('one');
  });

  it('realPath_MissingPath_RejectsAsMissingFile', async () => {
    const error = await files
      .realPath('/h/none.md')
      .catch((caught: unknown) => caught);

    expect(isMissingFile(error)).toBe(true);
  });

  it('trash_Folder_RemovesItsFiles', async () => {
    await files.write('/h/s/SKILL.md', 'skill');
    await files.write('/h/s/ref.md', 'ref');
    await files.write('/h/x.md', 'x');

    await files.trash('/h/s');

    expect(await files.stat('/h/s')).toBeNull();
    expect(await files.stat('/h/s/ref.md')).toBeNull();
    expect(await files.read('/h/x.md')).toBe('x');
    await expect(files.trash('/h/none')).rejects.toThrow('/h/none');
  });

  it('makeFolder_EmptyFolder_StatsAndLists', async () => {
    await files.makeFolder('/h/e');

    expect(await files.stat('/h/e')).toEqual({ isFolder: true, isLink: false });
    expect(await files.list('/h')).toEqual([{ path: 'e', kind: 'folder' }]);
  });

  it('rename_LastFileInFolder_KeepsTheFolder', async () => {
    await files.write('/h/s/a.md', 'one');

    await files.rename('/h/s/a.md', '/h/b.md');

    expect(await files.stat('/h/s')).toEqual({ isFolder: true, isLink: false });
    expect(await files.list('/h/s')).toEqual([]);
  });

  it('trash_LastFileInFolder_KeepsTheFolder', async () => {
    await files.write('/h/s/a.md', 'one');

    await files.trash('/h/s/a.md');

    expect(await files.stat('/h/s')).toEqual({ isFolder: true, isLink: false });
  });

  it('makeFolder_UnderAFile_RejectsWithEnotdir', async () => {
    await files.write('/h/f', 'file');

    const error = await files
      .makeFolder('/h/f/x')
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('ENOTDIR');
    expect(await files.read('/h/f')).toBe('file');
  });

  it('write_OntoAFolder_RejectsWithEisdir', async () => {
    await files.makeFolder('/h/folder');

    const error = await files
      .write('/h/folder', 'text')
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('EISDIR');
    expect(await files.stat('/h/folder')).toEqual({
      isFolder: true,
      isLink: false,
    });
  });

  it('write_ParentIsAFile_RejectsWithEexist', async () => {
    await files.write('/h/f', 'file');

    const error = await files
      .write('/h/f/x.md', 'text')
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('EEXIST');
    expect(await files.read('/h/f')).toBe('file');
  });

  it('write_AncestorAboveParentIsAFile_RejectsWithEnotdir', async () => {
    await files.write('/h/f', 'file');

    const error = await files
      .write('/h/f/x/y.md', 'text')
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('ENOTDIR');
  });

  it('rename_DestinationParentIsFile_RejectsWithEnotdir', async () => {
    await files.write('/h/a.md', 'one');
    await files.write('/h/f', 'file');

    const error = await files
      .rename('/h/a.md', '/h/f/b.md')
      .catch((caught: unknown) => caught);

    expect(errorCode(error)).toBe('ENOTDIR');
    expect(await files.read('/h/a.md')).toBe('one');
  });
});
