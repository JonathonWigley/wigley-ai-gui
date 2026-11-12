import { describe, expect, it, vi } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { BacklogChunk, ChunkEdit } from '../contract';
import { rowKey } from '../row-key';
import {
  type ChunkPlan,
  type ChunkStore,
  createChunkStore,
} from './chunk-store';

const FILE = 'chunks.json';
const NOW = 1700;

function chunk(
  id: string,
  repo: string,
  name: string,
  titles: string[],
  fields: Partial<BacklogChunk> = {},
): BacklogChunk {
  return {
    id,
    repo,
    name,
    titles,
    headless: false,
    sessionId: null,
    ...fields,
  };
}

const A = chunk('A', 'r', 'Alpha', ['a1', 'a2']);
const B = chunk('B', 'r', 'Beta', ['b1', 'b2']);
const S = chunk('S', 'r', 'Started', ['s1'], { sessionId: 'sess' });
const O = chunk('O', 's', 'Other', ['o1']);

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// A store over plugin data holding `chunks` (no file when null). `held` lists
// the sessions chat holds; `restored` is what `deps.restored` returns. Each
// new id is `new1`, `new2`, …; `changes` holds each `changed` call's chunks.
// The clock reads NOW.
async function storeOver(
  chunks: BacklogChunk[] | null,
  {
    held = ['sess'],
    restored = () => Promise.resolve(),
    isHeld,
  }: {
    held?: string[];
    restored?: () => Promise<void>;
    isHeld?: (sessionId: string) => boolean;
  } = {},
) {
  const data = createMemoryFiles();
  if (chunks !== null) {
    await data.write(FILE, JSON.stringify({ chunks }));
  }
  let made = 0;
  const changes: BacklogChunk[][] = [];
  const logged: string[] = [];
  const store = createChunkStore({
    data,
    randomHex: () => `new${String(++made)}`,
    clock: { now: () => NOW },
    restored,
    isHeld: isHeld ?? ((sessionId) => held.includes(sessionId)),
    log: (message) => logged.push(message),
    changed: (next) => changes.push(next),
  });
  return {
    store,
    data,
    changes,
    logged,
    saved: async (): Promise<BacklogChunk[]> =>
      (JSON.parse(await data.read(FILE)) as { chunks: BacklogChunk[] }).chunks,
  };
}

describe('chunk store', () => {
  it.each<{ case: string; edit: ChunkEdit; result: BacklogChunk[] | string }>([
    {
      case: 'keys empty',
      edit: { type: 'remove', keys: [] },
      result: 'No follow-ups given',
    },
    {
      case: 'a new chunk of keys of two repos',
      edit: {
        type: 'add',
        keys: [rowKey('r', 'x'), rowKey('s', 'y')],
        chunkId: null,
      },
      result: "y is in s; a chunk holds one repo's follow-ups",
    },
    {
      case: 'a new chunk',
      edit: {
        type: 'add',
        keys: [rowKey('r', 'n1'), rowKey('r', 'n2')],
        chunkId: null,
      },
      result: [A, B, S, O, chunk('new1', 'r', 'n1', ['n1', 'n2'])],
    },
    {
      case: 'an add to no such chunk',
      edit: { type: 'add', keys: [rowKey('r', 'x')], chunkId: 'Z' },
      result: 'No chunk Z',
    },
    {
      case: 'an add to a started chunk',
      edit: { type: 'add', keys: [rowKey('r', 'x')], chunkId: 'S' },
      result: 'Started has started; its follow-ups cannot change',
    },
    {
      case: 'an add of a key of another repo',
      edit: {
        type: 'add',
        keys: [rowKey('r', 'x'), rowKey('s', 'o9')],
        chunkId: 'A',
      },
      result: 'o9 is in s, not r',
    },
    {
      case: 'an add of a key in a started chunk',
      edit: { type: 'add', keys: [rowKey('r', 's1')], chunkId: 'A' },
      result: 's1 is in Started, which has started',
    },
    {
      case: 'an add breaking the repo and started rules',
      edit: {
        type: 'add',
        keys: [rowKey('r', 's1'), rowKey('s', 'o1')],
        chunkId: 'A',
      },
      result: 'o1 is in s, not r',
    },
    {
      case: 'an add of a key in another unstarted chunk',
      edit: { type: 'add', keys: [rowKey('r', 'b1')], chunkId: 'A' },
      result: [
        { ...A, titles: ['a1', 'a2', 'b1'] },
        { ...B, titles: ['b2'] },
        S,
        O,
      ],
    },
    {
      case: 'an add of a key already in the target',
      edit: {
        type: 'add',
        keys: [rowKey('r', 'a1'), rowKey('r', 'n1')],
        chunkId: 'A',
      },
      result: [{ ...A, titles: ['a1', 'a2', 'n1'] }, B, S, O],
    },
    {
      case: 'a remove of a key in a started chunk',
      edit: { type: 'remove', keys: [rowKey('r', 'b1'), rowKey('r', 's1')] },
      result: 's1 is in Started, which has started',
    },
    {
      case: 'a remove of a key in no chunk',
      edit: { type: 'remove', keys: [rowKey('r', 'zz'), rowKey('r', 'b1')] },
      result: [A, { ...B, titles: ['b2'] }, S, O],
    },
    {
      case: 'a rename of no such chunk',
      edit: { type: 'rename', chunkId: 'Z', name: 'New' },
      result: 'No chunk Z',
    },
    {
      case: 'a rename to a blank name',
      edit: { type: 'rename', chunkId: 'A', name: ' \t ' },
      result: 'A chunk needs a name',
    },
    {
      case: 'a rename of a started chunk',
      edit: { type: 'rename', chunkId: 'S', name: '  New  ' },
      result: [A, B, { ...S, name: 'New' }, O],
    },
    {
      case: 'a headless flag on no such chunk',
      edit: { type: 'setHeadless', chunkId: 'Z', headless: true },
      result: 'No chunk Z',
    },
    {
      case: 'a headless flag on a started chunk',
      edit: { type: 'setHeadless', chunkId: 'S', headless: true },
      result: 'Started has started; its headless flag cannot change',
    },
    {
      case: 'a headless flag',
      edit: { type: 'setHeadless', chunkId: 'B', headless: true },
      result: [A, { ...B, headless: true }, S, O],
    },
  ])('edit_Cases_RefuseOrApply given $case', async ({ edit, result }) => {
    const { store, saved } = await storeOver([A, B, S, O]);

    if (typeof result === 'string') {
      await expect(store.edit(edit)).rejects.toThrow(new Error(result));
    } else {
      expect(await store.edit(edit)).toEqual(result);
      expect(await saved()).toEqual(result);
    }
  });

  it('edit_Refused_WritesAndSendsNothing', async () => {
    const { store, data, changes, saved } = await storeOver([A, S], {
      held: [],
    });
    const write = vi.spyOn(data, 'write');

    await expect(
      store.edit({ type: 'rename', chunkId: 'Z', name: 'New' }),
    ).rejects.toThrow('No chunk Z');

    expect(write).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(await saved()).toEqual([A, S]);
  });

  it('edit_WriteFails_RejectsAndSendsNothing', async () => {
    const { store, data, changes } = await storeOver([A]);
    vi.spyOn(data, 'write').mockRejectedValue(new Error('disk full'));

    await expect(
      store.edit({ type: 'rename', chunkId: 'A', name: 'New' }),
    ).rejects.toThrow('disk full');

    expect(changes).toEqual([]);
  });

  it('edit_ChunkLeftEmpty_Deleted', async () => {
    const x = chunk('X', 'r', 'X', ['x']);
    const y = chunk('Y', 'r', 'Y', ['y']);
    const { store, changes, saved } = await storeOver([x, y]);

    await store.edit({ type: 'add', keys: [rowKey('r', 'x')], chunkId: 'Y' });

    const expected = [{ ...y, titles: ['y', 'x'] }];
    expect(await saved()).toEqual(expected);
    expect(changes).toEqual([expected]);
  });

  it('edit_SessionNotHeld_RetiresBeforeApplying', async () => {
    const { store, saved } = await storeOver([A, S], { held: [] });

    const chunks = await store.edit({
      type: 'add',
      keys: [rowKey('r', 's1')],
      chunkId: null,
    });

    const expected = [A, chunk('new1', 'r', 's1', ['s1'])];
    expect(chunks).toEqual(expected);
    expect(await saved()).toEqual(expected);
  });

  it('edit_BeforeRestored_WaitsThenKeepsHeldChunk', async () => {
    let isRestored = false;
    let restore: () => void = () => undefined;
    const restoring = new Promise<void>((resolve) => {
      restore = resolve;
    });
    const { store } = await storeOver([A, S], {
      restored: () => restoring,
      isHeld: () => isRestored,
    });
    let settled = false;

    const editing = store
      .edit({ type: 'rename', chunkId: 'A', name: 'New' })
      .finally(() => {
        settled = true;
      });
    await settle();
    expect(settled).toBe(false);
    isRestored = true;
    restore();

    expect(await editing).toEqual([{ ...A, name: 'New' }, S]);
  });

  describe('replaceUnstarted', () => {
    const headlessA = chunk('A', 'r', 'Alpha', ['a1'], { headless: true });
    const b = chunk('B', 'r', 'Beta', ['b1']);
    const TITLES = new Set(['a1', 'b1', 's1', 'x', 'y']);

    it.each<{
      case: string;
      plans: ChunkPlan[];
      result: BacklogChunk[] | string;
    }>([
      {
        case: 'a blank name',
        plans: [{ name: '  ', titles: ['x'] }],
        result: 'A chunk needs a name',
      },
      {
        case: 'a plan with no titles',
        plans: [{ name: 'P', titles: [] }],
        result: 'P holds no follow-ups',
      },
      {
        case: 'a title not in the repo',
        plans: [{ name: 'P', titles: ['zz'] }],
        result: 'No follow-up titled zz in r',
      },
      {
        case: 'a title in two plans',
        plans: [
          { name: 'P', titles: ['x'] },
          { name: 'Q', titles: ['y', 'x'] },
        ],
        result: 'x is in two chunks',
      },
      {
        case: 'a title twice in one plan',
        plans: [{ name: 'P', titles: ['x', 'y', 'x'] }],
        result: 'x is in two chunks',
      },
      {
        case: 'a title in a started chunk',
        plans: [{ name: 'P', titles: ['x', 's1'] }],
        result: 's1 is in Started, which has started',
      },
      {
        case: 'new plans',
        plans: [
          { name: 'P', titles: ['x', 'a1'] },
          { name: 'Q', titles: ['y'] },
        ],
        result: [
          S,
          O,
          chunk('new1', 'r', 'P', ['x', 'a1']),
          chunk('new2', 'r', 'Q', ['y']),
        ],
      },
      { case: 'no plans', plans: [], result: [S, O] },
      {
        case: 'a plan named as an unstarted chunk',
        plans: [{ name: ' Alpha ', titles: ['x'] }],
        result: [S, O, { ...headlessA, titles: ['x'] }],
      },
      {
        case: 'two plans of one name',
        plans: [
          { name: 'Alpha', titles: ['x'] },
          { name: 'Alpha', titles: ['y'] },
        ],
        result: [
          S,
          O,
          { ...headlessA, titles: ['x'] },
          chunk('new1', 'r', 'Alpha', ['y']),
        ],
      },
    ])(
      'replaceUnstarted_Cases_RefuseOrReplace given $case',
      async ({ plans, result }) => {
        const { store, saved } = await storeOver([headlessA, b, S, O]);

        if (typeof result === 'string') {
          await expect(
            store.replaceUnstarted('r', plans, TITLES),
          ).rejects.toThrow(new Error(result));
        } else {
          expect(await store.replaceUnstarted('r', plans, TITLES)).toEqual(
            result,
          );
          expect(await saved()).toEqual(result);
        }
      },
    );

    it('replaceUnstarted_SessionNotHeld_RetiresBeforeApplying', async () => {
      const { store, saved } = await storeOver([b, S], { held: [] });

      await store.replaceUnstarted(
        'r',
        [{ name: 'P', titles: ['s1'] }],
        TITLES,
      );

      expect(await saved()).toEqual([chunk('new1', 'r', 'P', ['s1'])]);
    });
  });

  it.each([
    { case: 'an unheld session', held: [], expected: [A], changes: [[A]] },
    {
      case: 'every session held',
      held: ['sess'],
      expected: [A, S],
      changes: [],
    },
  ])(
    'retireUnheld_Cases_ChangedOnlyWhenRetired given $case',
    async ({ held, expected, changes }) => {
      const store = await storeOver([A, S], { held });

      expect(await store.store.retireUnheld()).toEqual(expected);
      expect(await store.saved()).toEqual(expected);
      expect(store.changes).toEqual(changes);
    },
  );

  it('retire_HeldSession_DeletesItsChunk', async () => {
    const { store, changes, saved } = await storeOver([A, S]);

    await store.retire('sess');

    expect(await saved()).toEqual([A]);
    expect(changes).toEqual([[A]]);
  });

  it('retire_UnknownSession_ChangesNothing', async () => {
    const { store, data, changes } = await storeOver([A, S]);
    const write = vi.spyOn(data, 'write');

    await store.retire('other');

    expect(write).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it.each([
    {
      case: 'a known id',
      chunkId: 'A',
      expected: [{ ...A, sessionId: 'sess-2' }, B],
      stored: true,
      logged: [],
    },
    {
      case: 'an unknown id',
      chunkId: 'Z',
      expected: [A, B],
      stored: false,
      logged: ['No chunk Z for session sess-2'],
    },
  ])(
    'setSession_Cases given $case',
    async ({ chunkId, expected, stored, logged }) => {
      const store = await storeOver([A, B]);
      const write = vi.spyOn(store.data, 'write');

      expect(await store.store.setSession(chunkId, 'sess-2')).toBe(stored);
      expect(await store.saved()).toEqual(expected);
      expect(write.mock.calls.length > 0).toBe(stored);
      expect(store.changes).toEqual(stored ? [expected] : []);
      expect(store.logged).toEqual(logged);
    },
  );

  it.each<{
    case: string;
    marked: string[];
    cleared: string[];
    chunkId: string;
    result: BacklogChunk | string;
  }>([
    {
      case: 'no such chunk',
      marked: [],
      cleared: [],
      chunkId: 'Z',
      result: 'No chunk Z',
    },
    {
      case: 'a started chunk',
      marked: [],
      cleared: [],
      chunkId: 'S',
      result: 'Started has started',
    },
    {
      case: 'a chunk already marked',
      marked: ['B'],
      cleared: [],
      chunkId: 'B',
      result: 'Beta is starting',
    },
    {
      case: 'a chunk marked then cleared',
      marked: ['B'],
      cleared: ['B'],
      chunkId: 'B',
      result: B,
    },
    {
      case: 'an unstarted chunk beside a marked one',
      marked: ['B'],
      cleared: [],
      chunkId: 'A',
      result: A,
    },
  ])(
    'markStarting_Cases given $case',
    async ({ marked, cleared, chunkId, result }) => {
      const { store } = await storeOver([A, B, S]);
      for (const id of marked) {
        await store.markStarting(id);
      }
      for (const id of cleared) {
        store.clearStarting(id);
      }

      if (typeof result === 'string') {
        await expect(store.markStarting(chunkId)).rejects.toThrow(
          new Error(result),
        );
      } else {
        expect(await store.markStarting(chunkId)).toEqual(result);
      }
    },
  );

  it.each<{
    case: string;
    call: (store: ChunkStore) => Promise<BacklogChunk[]>;
    result: BacklogChunk[] | string;
  }>([
    {
      case: 'an add to it',
      call: (store) =>
        store.edit({ type: 'add', keys: [rowKey('r', 'x')], chunkId: 'B' }),
      result: 'Beta is starting; its follow-ups cannot change',
    },
    {
      case: 'an add of its key elsewhere',
      call: (store) =>
        store.edit({ type: 'add', keys: [rowKey('r', 'b1')], chunkId: 'A' }),
      result: 'b1 is in Beta, which is starting',
    },
    {
      case: 'a remove of its key',
      call: (store) =>
        store.edit({ type: 'remove', keys: [rowKey('r', 'b2')] }),
      result: 'b2 is in Beta, which is starting',
    },
    {
      case: 'a headless flag on it',
      call: (store) =>
        store.edit({ type: 'setHeadless', chunkId: 'B', headless: true }),
      result: 'Beta is starting; its headless flag cannot change',
    },
    {
      case: 'a rename of it',
      call: (store) =>
        store.edit({ type: 'rename', chunkId: 'B', name: 'New' }),
      result: 'Beta is starting',
    },
    {
      case: 'a replace naming its title',
      call: (store) =>
        store.replaceUnstarted(
          'r',
          [{ name: 'P', titles: ['b1'] }],
          new Set(['b1']),
        ),
      result: 'b1 is in Beta, which is starting',
    },
    {
      case: "a replace of its repo's unstarted chunks",
      call: (store) =>
        store.replaceUnstarted(
          'r',
          [{ name: 'Beta', titles: ['x'] }],
          new Set(['x']),
        ),
      result: [B, S, O, chunk('new1', 'r', 'Beta', ['x'])],
    },
    {
      case: 'a prune of its titles',
      call: (store) => store.prune(new Map([['r', new Set(['a1', 's1'])]])),
      result: [{ ...A, titles: ['a1'] }, B, S, O],
    },
  ])('starting_Cases_ChunkLeftAlone given $case', async ({ call, result }) => {
    const { store, saved } = await storeOver([A, B, S, O]);
    await store.markStarting('B');

    if (typeof result === 'string') {
      await expect(call(store)).rejects.toThrow(new Error(result));
    } else {
      expect(await call(store)).toEqual(result);
      expect(await saved()).toEqual(result);
    }
  });

  it.each([
    {
      case: 'a title with no row',
      titles: { r: ['a1', 'b1', 'b2', 's1'], s: ['o1'] },
      expected: [{ ...A, titles: ['a1'] }, B, S, O],
      changed: true,
    },
    {
      case: 'a chunk left with no title',
      titles: { r: ['a1', 'a2', 's1'], s: ['o1'] },
      expected: [A, S, O],
      changed: true,
    },
    {
      case: "a started chunk's missing title",
      titles: { r: ['a1', 'a2', 'b1', 'b2'], s: ['o1'] },
      expected: [A, B, S, O],
      changed: false,
    },
    {
      case: 'a repo with no rows read',
      titles: { r: ['a1', 'a2', 'b1', 'b2', 's1'] },
      expected: [A, B, S, O],
      changed: false,
    },
  ])('prune_Cases given $case', async ({ titles, expected, changed }) => {
    const store = await storeOver([A, B, S, O]);
    const byRepo = new Map(
      Object.entries(titles).map(([repo, list]) => [
        repo,
        new Set<string>(list),
      ]),
    );

    expect(await store.store.prune(byRepo)).toEqual(expected);
    expect(await store.saved()).toEqual(expected);
    expect(store.changes).toEqual(changed ? [expected] : []);
  });

  it('calls_Overlapping_RunInOrder', async () => {
    const { store, saved } = await storeOver([chunk('A', 'r', 'A', ['a1'])]);

    const first = store.edit({
      type: 'add',
      keys: [rowKey('r', 'x')],
      chunkId: 'A',
    });
    const second = store.edit({
      type: 'add',
      keys: [rowKey('r', 'y')],
      chunkId: 'A',
    });
    await Promise.all([first, second]);

    expect(await saved()).toEqual([chunk('A', 'r', 'A', ['a1', 'x', 'y'])]);
  });

  it.each<{
    case: string;
    text: string | null;
    chunks: BacklogChunk[];
    logged: string[];
  }>([
    { case: 'no file', text: null, chunks: [], logged: [] },
    {
      case: 'text that is not JSON',
      text: 'not json',
      chunks: [],
      logged: ['chunks.json unreadable; starting with no chunks'],
    },
    {
      case: 'chunks that are not a list',
      text: '{ "chunks": 3 }',
      chunks: [],
      logged: ['chunks.json unreadable; starting with no chunks'],
    },
    {
      case: 'malformed chunks among good ones',
      text: JSON.stringify({
        chunks: [
          A,
          { ...B, titles: 'b1' },
          null,
          { id: 'X', repo: 'r', name: 'X', titles: [] },
          S,
        ],
      }),
      chunks: [A, S],
      logged: [
        'chunks.json: dropped malformed chunk at index 1',
        'chunks.json: dropped malformed chunk at index 2',
        'chunks.json: dropped malformed chunk at index 3',
      ],
    },
  ])(
    'chunks_FileRead_KeepsWellFormedAndLogs given $case',
    async ({ text, chunks, logged }) => {
      const store = await storeOver(null);
      if (text !== null) {
        await store.data.write(FILE, text);
      }

      expect(await store.store.chunks()).toEqual(chunks);
      expect(store.logged).toEqual(logged);
    },
  );

  it('edit_FileUnreadable_MovesItAsideBeforeWriting', async () => {
    const store = await storeOver(null);
    await store.data.write(FILE, 'not json');

    await store.store.edit({
      type: 'add',
      keys: [rowKey('r', 'n1')],
      chunkId: null,
    });
    await store.store.edit({ type: 'rename', chunkId: 'new1', name: 'New' });

    const aside = `${FILE}.unreadable-${String(NOW)}`;
    expect(await store.data.read(aside)).toBe('not json');
    expect(await store.saved()).toEqual([chunk('new1', 'r', 'New', ['n1'])]);
    expect(store.logged).toEqual([
      'chunks.json unreadable; starting with no chunks',
      `chunks.json moved aside to ${aside}`,
    ]);
  });
});
