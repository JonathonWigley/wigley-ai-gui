import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryFiles, type MemoryFiles } from './memory-files';

let files: MemoryFiles;

beforeEach(() => {
  files = createMemoryFiles();
});

describe('createMemoryFiles', () => {
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

    expect(await files.stat('/h/e')).toEqual({ isFolder: true });
    expect(await files.list('/h')).toEqual([{ path: 'e', kind: 'folder' }]);
  });
});
