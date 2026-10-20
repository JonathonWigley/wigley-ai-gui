import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryFiles, type MemoryFiles } from './memory-files';
import { scopedFiles } from './scoped-files';

const ROOT = '/data/plugins/forms';

let inner: MemoryFiles;

beforeEach(() => {
  inner = createMemoryFiles();
});

describe('scopedFiles', () => {
  it('read_PathInsideRoot_ReadsUnderRoot', async () => {
    await inner.write(`${ROOT}/layouts/a/layout.js`, 'text');

    const text = await scopedFiles(inner, ROOT).read(
      'layouts/./b/../a/layout.js',
    );

    expect(text).toBe('text');
  });

  it('write_ParentEscape_RejectsBeforeWriting', async () => {
    const scoped = scopedFiles(inner, ROOT);

    await expect(scoped.write('../x', 'text')).rejects.toThrow(
      `../x is outside ${ROOT}`,
    );
    expect(await inner.list('/', { recursive: true })).toEqual([]);
  });

  it('write_AbsolutePath_Rejects', async () => {
    const scoped = scopedFiles(inner, ROOT);

    await expect(scoped.write('/etc/x', 'text')).rejects.toThrow(
      `/etc/x is outside ${ROOT}`,
    );
    expect(await inner.list('/', { recursive: true })).toEqual([]);
  });

  it('write_BackslashPath_Rejects', async () => {
    const scoped = scopedFiles(inner, ROOT);

    await expect(scoped.write('a\\..\\..\\x', 'text')).rejects.toThrow(
      `a\\..\\..\\x is outside ${ROOT}`,
    );
    expect(await inner.list('/', { recursive: true })).toEqual([]);
  });

  it('write_DrivePrefixPath_Rejects', async () => {
    const scoped = scopedFiles(inner, ROOT);

    await expect(scoped.write('C:x', 'text')).rejects.toThrow(
      `C:x is outside ${ROOT}`,
    );
    expect(await inner.list('/', { recursive: true })).toEqual([]);
  });

  it('watch_ParentEscape_Throws', () => {
    const scoped = scopedFiles(inner, ROOT);

    expect(() => scoped.watch('layouts/../..', () => {})).toThrow(
      `layouts/../.. is outside ${ROOT}`,
    );
  });

  it('watch_WriteUnderFolder_ReportsRelativePath', async () => {
    const scoped = scopedFiles(inner, ROOT);
    const reports: string[] = [];
    scoped.watch('layouts', (changed) => reports.push(changed));

    await scoped.write('layouts/a/layout.js', 'text');

    expect(reports).toEqual(['a/layout.js']);
  });
});
