import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import {
  createStashStore,
  STASHED_FILE,
  type StashRecord,
} from './stash-store';

function record(host: string, at: number, note?: string): StashRecord {
  const base = {
    hostSessionId: host,
    projectDir: `/projects/${host}`,
    profile: 'work',
    title: `${host} title`,
    at,
  };
  return note === undefined ? base : { ...base, note };
}

function setUp() {
  const data = createMemoryFiles();
  return { data, store: createStashStore(data) };
}

describe('createStashStore', () => {
  it('records_MissingFile_Empty', async () => {
    const { store } = setUp();

    expect(await store.records()).toEqual([]);
  });

  it('add_SameSessionAgain_ReplacesAndMovesLast', async () => {
    const { store } = setUp();

    await store.add(record('a', 1, 'first'));
    await store.add(record('b', 2));
    await store.add(record('a', 3, 'again'));

    expect(await store.records()).toEqual([
      record('b', 2),
      record('a', 3, 'again'),
    ]);
  });

  it('remove_HeldAndUnheld_ReturnsTheRecordOrNull', async () => {
    const { store } = setUp();
    await store.add(record('a', 1, 'note'));
    await store.add(record('b', 2));

    expect(await store.remove('a')).toEqual(record('a', 1, 'note'));
    expect(await store.remove('a')).toBeNull();
    expect(await store.records()).toEqual([record('b', 2)]);
  });

  it('addAndRemove_Concurrent_EachReadsTheLastWrite', async () => {
    const { store } = setUp();

    await Promise.all([
      store.add(record('a', 1)),
      store.add(record('b', 2)),
      store.remove('a'),
    ]);

    expect(await store.records()).toEqual([record('b', 2)]);
  });

  it.each([
    { given: 'not JSON', text: '{oops' },
    { given: 'not an array', text: '{}' },
    { given: 'a record missing its title', text: '[{"hostSessionId":"a"}]' },
    {
      given: 'a note that is no string',
      text: JSON.stringify([{ ...record('a', 1), note: 5 }]),
    },
    {
      given: 'a headless flag that is no boolean',
      text: JSON.stringify([{ ...record('a', 1), headless: 'yes' }]),
    },
  ])(
    'recordsAddRemove_UnreadableFile_RejectAndKeepIt given $given',
    async ({ text }) => {
      const { data, store } = setUp();
      await data.write(STASHED_FILE, text);

      await expect(store.records()).rejects.toThrow(STASHED_FILE);
      await expect(store.add(record('b', 2))).rejects.toThrow(STASHED_FILE);
      await expect(store.remove('a')).rejects.toThrow(STASHED_FILE);
      expect(await data.read(STASHED_FILE)).toBe(text);
    },
  );
});
