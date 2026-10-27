import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import {
  ARCHIVED_SESSIONS_FILE,
  createArchivedSessions,
} from './archived-sessions';

const UNREADABLE = ARCHIVED_SESSIONS_FILE;

function setUp() {
  const data = createMemoryFiles();
  return {
    data,
    archived: createArchivedSessions(data),
    saved: async (): Promise<unknown> =>
      JSON.parse(await data.read(ARCHIVED_SESSIONS_FILE)),
  };
}

describe('createArchivedSessions', () => {
  it('ids_MissingFile_Empty', async () => {
    const test = setUp();

    expect(await test.archived.ids()).toEqual(new Set());
  });

  it('set_ArchiveThenRestore_KeepsOrder', async () => {
    const test = setUp();

    await test.archived.set('s1', true);
    await test.archived.set('s2', true);
    await test.archived.set('s1', false);

    expect(await test.saved()).toEqual(['s2']);
    expect(await test.archived.ids()).toEqual(new Set(['s2']));
  });

  it('set_ConcurrentSameId_WritesItOnce', async () => {
    const test = setUp();

    await Promise.all([
      test.archived.set('s1', true),
      test.archived.set('s1', true),
    ]);

    expect(await test.saved()).toEqual(['s1']);
  });

  it('idsAndSet_UnreadableFile_RejectAndKeepIt', async () => {
    const test = setUp();
    await test.data.write(ARCHIVED_SESSIONS_FILE, '{oops');

    await expect(test.archived.ids()).rejects.toThrow(UNREADABLE);
    await expect(test.archived.set('s1', true)).rejects.toThrow(UNREADABLE);
    expect(await test.data.read(ARCHIVED_SESSIONS_FILE)).toBe('{oops');
  });

  it('set_AfterFailedWrite_StillWrites', async () => {
    const memory = createMemoryFiles();
    let writeFailures = 1;
    const data: Files = {
      ...memory,
      write: (path, text) => {
        if (writeFailures > 0) {
          writeFailures--;
          return Promise.reject(new Error('disk full'));
        }
        return memory.write(path, text);
      },
    };
    const archived = createArchivedSessions(data);

    const failed = archived.set('s1', true);
    const next = archived.set('s2', true);

    await expect(failed).rejects.toThrow('disk full');
    await next;
    expect(JSON.parse(await memory.read(ARCHIVED_SESSIONS_FILE))).toEqual([
      's2',
    ]);
  });
});
