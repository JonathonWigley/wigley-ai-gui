import { beforeEach, describe, expect, it } from 'vitest';
import type { Files } from '../contracts/files';
import { createMemoryFiles, type MemoryFiles } from './memory-files';
import { posixPaths } from './paths/posix-paths';
import { windowsPaths } from './paths/windows-paths';
import { scopedFiles } from './scoped-files';

const ROOT = '/data/plugins/forms';

let inner: MemoryFiles;

beforeEach(() => {
  inner = createMemoryFiles();
});

describe('scopedFiles', () => {
  it('read_PathInsideRoot_ReadsUnderRoot', async () => {
    await inner.write(`${ROOT}/layouts/a/layout.js`, 'text');

    const text = await scopedFiles(inner, ROOT, posixPaths).read(
      'layouts/./b/../a/layout.js',
    );

    expect(text).toBe('text');
  });

  it.each(['../x', '/etc/x', 'a\\..\\..\\x', 'C:x'])(
    'rejects writing %s before any I/O',
    async (path) => {
      const calls: string[] = [];
      const scoped = scopedFiles(recordingCalls(calls), ROOT, posixPaths);

      await expect(scoped.write(path, 'text')).rejects.toThrow(path);
      expect(calls).toEqual([]);
    },
  );

  it.each([
    {
      method: 'writeBytes',
      path: '../x.png',
      call: (scoped: Files) =>
        scoped.writeBytes('../x.png', new Uint8Array([1])),
    },
    {
      method: 'watch',
      path: 'layouts/../..',
      call: (scoped: Files) => scoped.watch('layouts/../..', () => {}),
    },
    {
      method: 'rename',
      path: '../y',
      call: (scoped: Files) => scoped.rename('a.md', '../y'),
    },
    {
      method: 'readStart',
      path: '../z',
      call: (scoped: Files) => scoped.readStart('../z', 4),
    },
    {
      method: 'readBytes',
      path: '../w.png',
      call: (scoped: Files) => scoped.readBytes('../w.png'),
    },
    {
      method: 'modified',
      path: '../v',
      call: (scoped: Files) => scoped.modified('../v'),
    },
    {
      method: 'append',
      path: '../a.log',
      call: (scoped: Files) => scoped.append('../a.log', 'x'),
    },
  ])('$method rejects $path before any I/O', async ({ path, call }) => {
    const calls: string[] = [];
    const scoped = scopedFiles(recordingCalls(calls), ROOT, posixPaths);

    await expect(
      Promise.resolve().then(async () => void (await call(scoped))),
    ).rejects.toThrow(path);
    expect(calls).toEqual([]);
  });

  it('watch_WriteUnderFolder_ReportsRelativePath', async () => {
    const scoped = scopedFiles(inner, ROOT, posixPaths);
    const reports: string[] = [];
    scoped.watch('layouts', (changed) => reports.push(changed));

    await scoped.write('layouts/a/layout.js', 'text');

    expect(reports).toEqual(['a/layout.js']);
  });

  it('watch_Options_PassedThrough', async () => {
    const scoped = scopedFiles(inner, ROOT, posixPaths);
    const reports: string[] = [];
    scoped.watch('layouts', (changed) => reports.push(changed), {
      recursive: false,
    });

    await scoped.write('layouts/a/layout.js', 'text');
    await scoped.write('layouts/b.js', 'text');

    expect(reports).toEqual(['a', 'b.js']);
  });

  it('readStart_PathInsideRoot_ReadsUnderRoot', async () => {
    await inner.write(`${ROOT}/a.txt`, 'abcdef');

    expect(
      await scopedFiles(inner, ROOT, posixPaths).readStart('a.txt', 2),
    ).toBe('ab');
  });

  it('realPath_PathInsideRoot_ReturnsRelative', async () => {
    await inner.write(`${ROOT}/a/b.md`, 'text');

    expect(
      await scopedFiles(inner, ROOT, posixPaths).realPath('a/./b.md'),
    ).toBe('a/b.md');
  });

  it('realPath_LinkLeadingOutsideRoot_Rejects', async () => {
    const linked = withRealPaths({
      [ROOT]: ROOT,
      [`${ROOT}/link.md`]: '/elsewhere/x.md',
    });

    await expect(
      scopedFiles(linked, ROOT, posixPaths).realPath('link.md'),
    ).rejects.toThrow('link.md');
  });

  it('realPath_WindowsSeparators_ReturnsSlashJoinedRelative', async () => {
    const root = 'C:\\data\\forms';
    const windows = withRealPaths({
      [root]: root,
      [`${root}\\a\\b.md`]: 'C:\\data\\forms\\a\\b.md',
    });

    expect(
      await scopedFiles(windows, root, windowsPaths).realPath('a/b.md'),
    ).toBe('a/b.md');
  });

  it('scopedFiles_WindowsRoot_JoinsWithBackslash', async () => {
    const root =
      'C:\\Users\\jo\\AppData\\Roaming\\wigley-ai-gui\\plugins\\forms';
    const calls: string[] = [];
    const recorded: MemoryFiles = {
      ...inner,
      read: async (path) => {
        calls.push(path);
        return 'text';
      },
    };

    await scopedFiles(recorded, root, windowsPaths).read(
      'layouts/default/layout.js',
    );

    expect(calls).toEqual([
      'C:\\Users\\jo\\AppData\\Roaming\\wigley-ai-gui\\plugins\\forms\\layouts\\default\\layout.js',
    ]);
  });

  it('realPath_WindowsCaseDiffers_ReturnsSlashRelative', async () => {
    const windows = withRealPaths({
      'C:\\Root': 'c:\\root',
      'C:\\Root\\a\\b.md': 'C:\\Root\\a\\b.md',
    });

    expect(
      await scopedFiles(windows, 'C:\\Root', windowsPaths).realPath('a/b.md'),
    ).toBe('a/b.md');
  });

  it('realPath_WindowsLinkOutside_Rejects', async () => {
    const windows = withRealPaths({
      'C:\\Root': 'C:\\Root',
      'C:\\Root\\link.md': 'C:\\Elsewhere\\x.md',
    });

    await expect(
      scopedFiles(windows, 'C:\\Root', windowsPaths).realPath('link.md'),
    ).rejects.toThrow('link.md');
  });
});

// `inner` with `realPath` answering from `realPaths`, keyed by the path asked.
function withRealPaths(realPaths: Record<string, string>): MemoryFiles {
  return {
    ...inner,
    realPath: async (path) => {
      const real = realPaths[path];
      if (real === undefined) {
        throw new Error(`no real path for ${path}`);
      }
      return real;
    },
  };
}

// `inner` with every method these tests call pushing each path asked onto
// `calls`.
function recordingCalls(calls: string[]): MemoryFiles {
  return {
    ...inner,
    write: async (path, text) => {
      calls.push(path);
      return inner.write(path, text);
    },
    writeBytes: async (path, bytes) => {
      calls.push(path);
      return inner.writeBytes(path, bytes);
    },
    rename: async (from, to) => {
      calls.push(from, to);
      return inner.rename(from, to);
    },
    watch: (folder, onChange, options) => {
      calls.push(folder);
      return inner.watch(folder, onChange, options);
    },
    readStart: async (path, maxBytes) => {
      calls.push(path);
      return inner.readStart(path, maxBytes);
    },
    readBytes: async (path) => {
      calls.push(path);
      return inner.readBytes(path);
    },
    modified: async (path) => {
      calls.push(path);
      return inner.modified(path);
    },
    append: async (path, text) => {
      calls.push(path);
      return inner.append(path, text);
    },
  };
}
