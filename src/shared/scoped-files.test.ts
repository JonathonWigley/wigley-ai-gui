import { beforeEach, describe, expect, it } from 'vitest';
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

  it('write_ParentEscape_RejectsBeforeWriting', async () => {
    const scoped = scopedFiles(inner, ROOT, posixPaths);

    await expect(scoped.write('../x', 'text')).rejects.toThrow(
      `../x is outside ${ROOT}`,
    );
    expect(await inner.list('/', { recursive: true })).toEqual([]);
  });

  it('writeBytes_ParentEscape_RejectsBeforeWriting', async () => {
    const scoped = scopedFiles(inner, ROOT, posixPaths);

    await expect(
      scoped.writeBytes('../x.png', new Uint8Array([1])),
    ).rejects.toThrow(`../x.png is outside ${ROOT}`);
    expect(await inner.list('/', { recursive: true })).toEqual([]);
  });

  it('write_AbsolutePath_Rejects', async () => {
    const scoped = scopedFiles(inner, ROOT, posixPaths);

    await expect(scoped.write('/etc/x', 'text')).rejects.toThrow(
      `/etc/x is outside ${ROOT}`,
    );
    expect(await inner.list('/', { recursive: true })).toEqual([]);
  });

  it('write_BackslashPath_Rejects', async () => {
    const scoped = scopedFiles(inner, ROOT, posixPaths);

    await expect(scoped.write('a\\..\\..\\x', 'text')).rejects.toThrow(
      `a\\..\\..\\x is outside ${ROOT}`,
    );
    expect(await inner.list('/', { recursive: true })).toEqual([]);
  });

  it('write_DrivePrefixPath_Rejects', async () => {
    const scoped = scopedFiles(inner, ROOT, posixPaths);

    await expect(scoped.write('C:x', 'text')).rejects.toThrow(
      `C:x is outside ${ROOT}`,
    );
    expect(await inner.list('/', { recursive: true })).toEqual([]);
  });

  it('watch_ParentEscape_Throws', () => {
    const scoped = scopedFiles(inner, ROOT, posixPaths);

    expect(() => scoped.watch('layouts/../..', () => {})).toThrow(
      `layouts/../.. is outside ${ROOT}`,
    );
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

  it('rename_DestinationOutsideRoot_RejectsBeforeMoving', async () => {
    await inner.write(`${ROOT}/a.md`, 'text');
    const scoped = scopedFiles(inner, ROOT, posixPaths);

    await expect(scoped.rename('a.md', '../x')).rejects.toThrow(
      `../x is outside ${ROOT}`,
    );
    expect(await scoped.read('a.md')).toBe('text');
  });

  it('readStart_ParentEscape_RejectsBeforeReading', async () => {
    const calls: string[] = [];
    const recorded = recordingCalls(calls);

    await expect(
      scopedFiles(recorded, ROOT, posixPaths).readStart('../x', 4),
    ).rejects.toThrow(`../x is outside ${ROOT}`);
    expect(calls).toEqual([]);
  });

  it('readBytes_ParentEscape_RejectsBeforeReading', async () => {
    const calls: string[] = [];
    const recorded = recordingCalls(calls);

    await expect(
      scopedFiles(recorded, ROOT, posixPaths).readBytes('../x.png'),
    ).rejects.toThrow(`../x.png is outside ${ROOT}`);
    expect(calls).toEqual([]);
  });

  it('modified_ParentEscape_RejectsBeforeReading', async () => {
    const calls: string[] = [];
    const recorded = recordingCalls(calls);

    await expect(
      scopedFiles(recorded, ROOT, posixPaths).modified('../x'),
    ).rejects.toThrow(`../x is outside ${ROOT}`);
    expect(calls).toEqual([]);
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
    ).rejects.toThrow(`link.md is outside ${ROOT}`);
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
    ).rejects.toThrow('link.md is outside C:\\Root');
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

// `inner` with `readStart`, `readBytes` and `modified` pushing each path asked
// onto `calls`.
function recordingCalls(calls: string[]): MemoryFiles {
  return {
    ...inner,
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
  };
}
