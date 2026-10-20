import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileEntry } from '../../contracts/files';
import { createNodeFiles } from './node-files';

const files = createNodeFiles();
let root: string;

function byPath(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => a.path.localeCompare(b.path));
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wigley-node-files-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createNodeFiles', () => {
  it('write_MissingParents_CreatesThemAndWritesText', async () => {
    const file = path.join(root, 'x', 'y', 'z.txt');

    await files.write(file, 'hello');

    expect(await files.read(file)).toBe('hello');
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

  it('watch_TwoWritesInABurst_ReportsOnce', async () => {
    const reports: string[] = [];
    const watch = files.watch(root, (changed) => reports.push(changed));
    try {
      const file = path.join(root, 'z.txt');
      await files.write(file, 'first');
      await new Promise((resolve) => setTimeout(resolve, 20));
      await files.write(file, 'second');
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      watch.close();
    }

    expect(reports).toEqual(['z.txt']);
  });
});
