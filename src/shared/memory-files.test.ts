import { beforeEach, describe, expect, it } from 'vitest';
import { describeFilesContract } from './files-contract.test-support';
import { createMemoryFiles, type MemoryFiles } from './memory-files';

let files: MemoryFiles;

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

beforeEach(() => {
  files = createMemoryFiles();
});

describe('createMemoryFiles', () => {
  describeFilesContract(() => ({ files, at: (relative) => `/h/${relative}` }));

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

  it('modified_Rename_CarriesTheStampToTheNewPath', async () => {
    const clock = { now: () => 5000 };
    const stamped = createMemoryFiles(clock);
    await stamped.write('/h/a.md', 'one');
    await stamped.write('/h/s/b.md', 'two');
    clock.now = () => 9000;

    await stamped.rename('/h/a.md', '/h/c.md');
    await stamped.rename('/h/s', '/h/t');

    expect(await stamped.modified('/h/c.md')).toBe(5000);
    expect(await stamped.modified('/h/t/b.md')).toBe(5000);
    await expect(stamped.modified('/h/a.md')).rejects.toThrow('/h/a.md');
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
      's',
      's/SKILL.md',
      's/ref.md',
      't',
      't/SKILL.md',
      't/ref.md',
    ]);
  });

  it('makeFolder reports each folder a new nested folder made', async () => {
    const recursive: string[] = [];
    const topOnly: string[] = [];
    files.watch('/h', (changed) => recursive.push(changed));
    files.watch('/h', (changed) => topOnly.push(changed), { recursive: false });

    await files.makeFolder('/h/a/b');

    expect(recursive).toEqual(['a', 'a/b']);
    expect(topOnly).toEqual(['a']);
  });

  it('makeFolder reports nothing for a folder that already exists', async () => {
    await files.makeFolder('/h/a');
    const reports: string[] = [];
    files.watch('/h', (changed) => reports.push(changed));

    await files.makeFolder('/h/a');

    expect(reports).toEqual([]);
  });

  it.each(['trash', 'remove'] as const)(
    '%s reports an empty folder once',
    async (method) => {
      await files.makeFolder('/h/e');
      const reports: string[] = [];
      files.watch('/h', (changed) => reports.push(changed));

      await files[method]('/h/e');

      expect(reports).toEqual(['e']);
    },
  );

  it('rename reports both names of an empty folder', async () => {
    await files.makeFolder('/h/e');
    const reports: string[] = [];
    files.watch('/h', (changed) => reports.push(changed));

    await files.rename('/h/e', '/h/f');

    expect(reports.sort()).toEqual(['e', 'f']);
  });

  it.each(['trash', 'remove'] as const)(
    'reports a folder that only files made when removing its parent with %s',
    async (method) => {
      await files.write('/h/s/sub/f.md', 'f');
      const reports: string[] = [];
      files.watch('/h', (changed) => reports.push(changed));

      await files[method]('/h/s');

      expect(reports.sort()).toEqual(['s', 's/sub', 's/sub/f.md']);
    },
  );

  it('reports a folder that only files made under both names when its parent is renamed', async () => {
    await files.write('/h/s/sub/f.md', 'f');
    const reports: string[] = [];
    files.watch('/h', (changed) => reports.push(changed));

    await files.rename('/h/s', '/h/t');

    expect(reports.sort()).toEqual([
      's',
      's/sub',
      's/sub/f.md',
      't',
      't/sub',
      't/sub/f.md',
    ]);
  });

  it('watch_NotRecursive_SubfolderChange_ReportsSubfolderName', async () => {
    const reports: string[] = [];
    files.watch('/h', (changed) => reports.push(changed), { recursive: false });

    await files.write('/h/s/a.md', 'text');

    expect(reports).toEqual(['s']);
  });

  it('watch_NotRecursive_SubfolderTrashed_ReportsSubfolderNameOnce', async () => {
    await files.write('/h/s/a.md', 'a');
    await files.write('/h/s/b.md', 'b');
    const reports: string[] = [];
    files.watch('/h', (changed) => reports.push(changed), { recursive: false });

    await files.trash('/h/s');

    expect(reports).toEqual(['s']);
  });

  it('watch_NotRecursive_SubfolderRenamed_ReportsBothNamesOnce', async () => {
    await files.write('/h/s/a.md', 'a');
    await files.write('/h/s/b.md', 'b');
    const reports: string[] = [];
    files.watch('/h', (changed) => reports.push(changed), { recursive: false });

    await files.rename('/h/s', '/h/t');

    expect(reports.sort()).toEqual(['s', 't']);
  });

  it('watch_NotRecursive_FolderChangeReported', async () => {
    const reports: string[] = [];
    files.watch('/h', (changed) => reports.push(changed), { recursive: false });

    await files.write('/h/a.md', 'text');

    expect(reports).toEqual(['a.md']);
  });

  it('rename_FolderIntoItself_RejectsAndMovesNothing', async () => {
    await files.write('/h/s/ref.md', 'ref');

    await expect(files.rename('/h/s', '/h/s/t')).rejects.toThrow('/h/s');

    expect(await files.read('/h/s/ref.md')).toBe('ref');
    expect(await files.stat('/h/s/t')).toBeNull();
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

  it('trash_LastFileInFolder_KeepsTheFolder', async () => {
    await files.write('/h/s/a.md', 'one');

    await files.trash('/h/s/a.md');

    expect(await files.stat('/h/s')).toEqual({ isFolder: true, isLink: false });
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
});
