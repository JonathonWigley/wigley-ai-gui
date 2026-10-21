import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import {
  ARCHIVED_SESSIONS_FILE,
  createArchivedSessions,
} from './archived-sessions';

const UNREADABLE = `${ARCHIVED_SESSIONS_FILE} is not a JSON array of session ids`;

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
});
