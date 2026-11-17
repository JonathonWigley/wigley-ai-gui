import { describe, expect, it } from 'vitest';
import type {
  KeyedSlotKey,
  ListSlotChange,
  ListSlotKey,
  SlotChange,
  SlotKey,
  SlotSnapshot,
  SlotWriter,
} from '../../contracts/state';
import { createSlotStore, pluginState, type SlotStore } from './slot-store';

type Item = { id: string; n: number };

const valueKey: SlotKey<number, 'main', 'p'> = {
  id: 'p.v',
  process: 'main',
  kind: 'value',
};
const keyedKey: KeyedSlotKey<number, 'main', 'p'> = {
  id: 'p.k',
  process: 'main',
  kind: 'keyed',
};
const listKey: ListSlotKey<Item, 'main', 'p'> = {
  id: 'p.l',
  process: 'main',
  kind: 'list',
};

function storeWithLogs() {
  const logs: [string, string][] = [];
  const store = createSlotStore((source, message) =>
    logs.push([source, message]),
  );
  return { store, logs };
}

function untracked<T>(handle: T): T {
  return handle;
}

function publishList() {
  return storeWithLogs().store.publish(listKey);
}

const A1: Item = { id: 'a', n: 1 };
const B2: Item = { id: 'b', n: 2 };
const A3: Item = { id: 'a', n: 3 };

describe('claims', () => {
  it('publish_KeyHeldByLivePart_ThrowsUntilDisposed', () => {
    const { store } = storeWithLogs();
    const writer = store.publish(valueKey);

    expect(() => store.publish(valueKey)).toThrow(
      'Slot "p.v" is held by a live part',
    );
    expect(store.isHeld('p.v')).toBe(true);

    writer.dispose();

    expect(store.isHeld('p.v')).toBe(false);
    expect(() => store.publish(valueKey)).not.toThrow();
  });

  it('dispose_OldWriterAfterNewClaim_KeepsNewClaim', () => {
    const { store } = storeWithLogs();
    const old = store.publish(valueKey);
    old.dispose();
    store.publish(valueKey);

    old.dispose();

    expect(store.isHeld('p.v')).toBe(true);
  });

  it('writer_AfterDispose_DoesNothingAndLogs', () => {
    const { store, logs } = storeWithLogs();
    const writer = store.publish(valueKey);
    writer.set(1);
    writer.dispose();
    const heard: unknown[] = [];
    store.read(valueKey, 'q').on((value) => heard.push(value));

    writer.set(2);

    expect(store.read(valueKey, 'q').get()).toBe(1);
    expect(heard).toEqual([]);
    expect(logs).toEqual([['p', 'p.v written after stop']]);
  });

  it('value_AfterWriterDisposed_StaysForNextPublish', () => {
    const { store } = storeWithLogs();
    const writer = store.publish(valueKey);
    writer.set(1);
    writer.dispose();

    expect(store.publish(valueKey).get()).toBe(1);
  });
});

describe('list slots', () => {
  it.each<{
    case: string;
    act(writer: ReturnType<typeof publishList>): void;
    expected: readonly Item[];
  }>([
    {
      case: 'put existing id replaces in place',
      act: (writer) => writer.put('s', A3),
      expected: [A3, B2],
    },
    {
      case: 'put new id appends',
      act: (writer) => writer.put('s', { id: 'c', n: 4 }),
      expected: [A1, B2, { id: 'c', n: 4 }],
    },
    {
      case: 'replace',
      act: (writer) => writer.replace('s', [B2]),
      expected: [B2],
    },
    { case: 'delete', act: (writer) => writer.delete('s'), expected: [] },
    {
      case: 'other key',
      act: (writer) => writer.delete('z'),
      expected: [A1, B2],
    },
  ])('listChange_ByKind_LeavesTheItems: $case', ({ act, expected }) => {
    const writer = publishList();
    writer.replace('s', [A1, B2]);

    act(writer);

    expect(writer.get('s')).toEqual(expected);
    expect(writer.get('absent')).toEqual([]);
  });

  it('listPut_HeldArray_DoesNotChange', () => {
    const writer = publishList();
    const given = [A1];
    writer.replace('s', given);
    const held = writer.get('s');

    writer.put('s', B2);
    given.push(B2);

    expect(held).toEqual([A1]);
  });
});

describe('changes', () => {
  it.each<{ case: string; act(store: SlotStore): void }>([
    {
      case: 'keyed',
      act: (store) => store.publish(keyedKey).delete('absent'),
    },
    { case: 'list', act: (store) => store.publish(listKey).delete('absent') },
    {
      case: 'remote keyed',
      act: (store) =>
        store.applyRemote({
          id: 'p.k',
          kind: 'keyed',
          key: 'absent',
          value: undefined,
        }),
    },
    {
      case: 'clear of empty slots',
      act: (store) => {
        store.publish(keyedKey).dispose();
        store.publish(listKey).dispose();
        store.clearOwner('p');
      },
    },
    {
      case: 'remote clear of an absent slot',
      act: (store) => store.applyRemote({ id: 'p.k', kind: 'cleared' }),
    },
  ])('delete_AbsentKey_ChangesNothing: $case', ({ act }) => {
    const { store } = storeWithLogs();
    const heard: unknown[] = [];
    store.onWrite((change) => heard.push(change));
    store.readById('p.k', 'q').on((...args) => heard.push(args));
    store.readById('p.l', 'q').on((...args) => heard.push(args));

    act(store);

    expect(heard).toEqual([]);
  });

  it('set_EqualValue_IsAChange', () => {
    const { store } = storeWithLogs();
    const writes: unknown[] = [];
    store.onWrite((change) => writes.push(change));
    const writer = store.publish(valueKey);

    writer.set(1);
    writer.set(1);

    expect(writes).toHaveLength(2);
  });

  it('publish_AbsentSlot_IsNoChange', () => {
    const { store } = storeWithLogs();
    const heard: unknown[] = [];
    store.onWrite((change) => heard.push(change));
    store.readById('p.v', 'q').on((...args) => heard.push(args));

    store.publish(valueKey);

    expect(heard).toEqual([]);
    expect(store.snapshot()).toEqual({
      'p.v': { kind: 'value', value: undefined },
    });
  });

  it('listener_Throws_LogsUnderListenerAndOthersRun', () => {
    const { store, logs } = storeWithLogs();
    const heard: unknown[] = [];
    store.read(valueKey, 'q').on(() => {
      throw new Error('boom');
    });
    store.read(valueKey, 'r').on((value) => heard.push(value));

    store.publish(valueKey).set(1);

    expect(logs).toEqual([['q', 'p.v listener failed: boom']]);
    expect(heard).toEqual([1]);
  });

  it('on_NewListener_HearsOnlyLaterChanges', () => {
    const { store } = storeWithLogs();
    const writer = store.publish(valueKey);
    writer.set(1);
    const heard: unknown[] = [];

    store.read(valueKey, 'q').on((value) => heard.push(value));
    expect(heard).toEqual([]);

    writer.set(2);
    expect(heard).toEqual([2]);
  });

  it.each<{
    case: string;
    change(store: SlotStore, writer: SlotWriter<number>): void;
    expected: string[];
  }>([
    {
      case: 'a writer',
      change: (_store, writer) => writer.set(1),
      expected: ['sent 1', 'L1 1', 'sent 2', 'L2 1', 'L1 2', 'L2 2'],
    },
    {
      case: 'applyRemote',
      change: (store) =>
        store.applyRemote({ id: 'p.v', kind: 'value', value: 1 }),
      expected: ['L1 1', 'sent 2', 'L2 1', 'L1 2', 'L2 2'],
    },
  ])(
    'change_ListenerWritesAgain_OnWriteAtOnceAndListenersHearInOrder: $case',
    ({ change, expected }) => {
      const { store } = storeWithLogs();
      const order: string[] = [];
      store.onWrite((write) =>
        order.push(`sent ${String((write as { value: unknown }).value)}`),
      );
      const writer = store.publish(valueKey);
      store.read(valueKey, 'first').on((value) => {
        order.push(`L1 ${String(value)}`);
        if (value === 1) {
          writer.set(2);
        }
      });
      store
        .read(valueKey, 'second')
        .on((value) => order.push(`L2 ${String(value)}`));

      change(store, writer);

      expect(order).toEqual(expected);
    },
  );

  it('write_ListenerWritesAnotherSlot_ItsListenersHearAfterThisChange', () => {
    const { store } = storeWithLogs();
    const writer = store.publish(valueKey);
    const keyed = store.publish(keyedKey);
    const heard: string[] = [];
    store.read(valueKey, 'first').on(() => {
      heard.push('value first');
      keyed.set('a', 1);
    });
    store.read(keyedKey, 'keyed').on(() => heard.push('keyed'));
    store.read(valueKey, 'second').on(() => heard.push('value second'));

    writer.set(1);

    expect(heard).toEqual(['value first', 'value second', 'keyed']);
  });

  it('on_AddedByAListenerOnASlotItWrote_HearsTheQueuedChange', () => {
    const { store } = storeWithLogs();
    const writer = store.publish(valueKey);
    const keyed = store.publish(keyedKey);
    const heard: unknown[] = [];
    store.read(valueKey, 'first').on(() => {
      keyed.set('a', 1);
      store.read(keyedKey, 'late').on((...args) => heard.push(args));
    });

    writer.set(1);

    expect(heard).toEqual([['a', 1]]);
  });

  it('write_OnWriteThrows_SlotUpdatedAndCallerHearsIt', () => {
    const { store } = storeWithLogs();
    const writer = store.publish(valueKey);
    const heard: unknown[] = [];
    store.read(valueKey, 'q').on((value) => heard.push(value));
    store.onWrite(() => {
      throw new Error('no page');
    });

    expect(() => writer.set(1)).toThrow('no page');

    expect(writer.get()).toBe(1);
    expect(heard).toEqual([]);
  });

  it.each<{ case: string; changes: SlotChange[]; heard: unknown[] }>([
    {
      case: 'value',
      changes: [{ id: 'p.v', kind: 'value', value: 5 }],
      heard: [5],
    },
    {
      case: 'cleared',
      changes: [
        { id: 'p.v', kind: 'value', value: 5 },
        { id: 'p.v', kind: 'cleared' },
      ],
      heard: [5, undefined],
    },
  ])('applyRemote_TellsListenersAndNotOnWrite: $case', ({ changes, heard }) => {
    const { store } = storeWithLogs();
    const writes: unknown[] = [];
    const heardValues: unknown[] = [];
    store.onWrite((change) => writes.push(change));
    store.read(valueKey, 'q').on((value) => heardValues.push(value));

    for (const change of changes) {
      store.applyRemote(change);
    }

    expect(heardValues).toEqual(heard);
    expect(writes).toEqual([]);
    expect(store.read(valueKey, 'q').get()).toBe(heard.at(-1));
  });

  it.each<{
    case: string;
    filled: SlotChange[];
    id: string;
    heard: unknown[][];
  }>([
    {
      case: 'cleared keyed',
      id: 'p.k',
      filled: [
        { id: 'p.k', kind: 'keyed', key: 'x', value: 1 },
        { id: 'p.k', kind: 'keyed', key: 'y', value: 2 },
      ],
      heard: [
        ['x', undefined],
        ['y', undefined],
      ],
    },
    {
      case: 'cleared list',
      id: 'p.l',
      filled: [
        {
          id: 'p.l',
          kind: 'list',
          key: 'a',
          change: { kind: 'put', item: A1 },
        },
        {
          id: 'p.l',
          kind: 'list',
          key: 'b',
          change: { kind: 'put', item: B2 },
        },
      ],
      heard: [
        ['a', { kind: 'delete' }],
        ['b', { kind: 'delete' }],
      ],
    },
  ])(
    'applyRemote_Cleared_TellsOneDeletePerEntry: $case',
    ({ id, filled, heard }) => {
      const { store } = storeWithLogs();
      for (const change of filled) {
        store.applyRemote(change);
      }
      const writes: unknown[] = [];
      const heardArgs: unknown[][] = [];
      store.onWrite((change) => writes.push(change));
      store.readById(id, 'q').on((...args) => heardArgs.push(args));

      store.applyRemote({ id, kind: 'cleared' });

      expect(heardArgs).toEqual(heard);
      expect(writes).toEqual([]);
      expect(store.readById(id, 'q').get()).toEqual([]);
    },
  );

  it('publish_IdHeldAsAnotherKind_Throws', () => {
    const { store } = storeWithLogs();
    store.applyRemote({ id: 'p.v', kind: 'value', value: 5 });

    expect(() =>
      store.publish({ id: 'p.v', process: 'main', kind: 'keyed' }),
    ).toThrow('Slot "p.v" is a value slot, not keyed');
  });
});

describe('clearOwner', () => {
  it('clearOwner_EveryKind_EmptiesOwnersSlotsAndTellsEachEntry', () => {
    const { store } = storeWithLogs();
    const value = store.publish(valueKey);
    value.set(1);
    const keyed = store.publish(keyedKey);
    keyed.set('x', 1);
    keyed.set('y', 2);
    const list = store.publish(listKey);
    list.put('a', A1);
    const other = store.publish({
      id: 'p-x.v',
      process: 'main',
      kind: 'value',
    });
    other.set(5);
    for (const writer of [value, keyed, list, other]) {
      writer.dispose();
    }
    const heard = new Map<string, unknown[][]>();
    for (const id of ['p.v', 'p.k', 'p.l', 'p-x.v']) {
      const calls: unknown[][] = [];
      heard.set(id, calls);
      store.readById(id, 'q').on((...args) => calls.push(args));
    }
    const siblingSeen: unknown[] = [];
    store
      .readById('p.v', 'q')
      .on(() => siblingSeen.push(store.readById('p.k', 'q').get()));
    const writes: unknown[] = [];
    store.onWrite((change) => writes.push(change));

    store.clearOwner('p');

    expect(heard.get('p.v')).toEqual([[undefined]]);
    expect(heard.get('p.k')).toEqual([
      ['x', undefined],
      ['y', undefined],
    ]);
    expect(heard.get('p.l')).toEqual([['a', { kind: 'delete' }]]);
    expect(heard.get('p-x.v')).toEqual([]);
    expect(siblingSeen).toEqual([[]]);
    expect(writes).toEqual([
      { id: 'p.v', kind: 'cleared' },
      { id: 'p.k', kind: 'cleared' },
      { id: 'p.l', kind: 'cleared' },
    ]);
    expect(store.readById('p.v', 'q').get()).toBeUndefined();
    expect(store.readById('p.k', 'q').get()).toEqual([]);
    expect(store.readById('p.l', 'q').get()).toEqual([]);
    expect(store.readById('p-x.v', 'q').get()).toBe(5);
  });

  it('clearOwner_LiveWriter_ThrowsAndClearsNothing', () => {
    const { store } = storeWithLogs();
    const writes: unknown[] = [];
    store.onWrite((change) => writes.push(change));
    const keyed = store.publish(keyedKey);
    keyed.set('x', 1);
    keyed.dispose();
    store.publish(valueKey).set(1);

    expect(() => store.clearOwner('p')).toThrow(
      'Slot "p.v" is held by a live part',
    );

    expect(store.readById('p.k', 'q').get()).toEqual([['x', 1]]);
    expect(store.readById('p.v', 'q').get()).toBe(1);
    expect(writes).toEqual([
      { id: 'p.k', kind: 'keyed', key: 'x', value: 1 },
      { id: 'p.v', kind: 'value', value: 1 },
    ]);
  });
});

describe('keyed order', () => {
  it('all_SetKeepsAHeldKeysPlaceAndDeleteThenSetGoesLast', () => {
    const { store } = storeWithLogs();
    const keyed = store.publish(keyedKey);
    keyed.set('b', 1);
    keyed.set('a', 2);
    keyed.set('c', 3);

    keyed.set('b', 4);
    keyed.delete('a');
    keyed.set('a', 5);

    expect([...keyed.all()]).toEqual([
      ['b', 4],
      ['c', 3],
      ['a', 5],
    ]);
  });
});

describe('snapshot', () => {
  it('snapshot_ThroughStructuredCloneAndLoad_ReadsEveryKind', () => {
    const { store } = storeWithLogs();
    store.publish(valueKey).set(1);
    const keyed = store.publish(keyedKey);
    keyed.set('b', 1);
    keyed.set('12345678', 2);
    keyed.set('a', 3);
    store.publish(listKey).put('s', A1);

    const loaded = storeWithLogs().store;
    loaded.load(structuredClone(store.snapshot()));

    expect(loaded.read(valueKey, 'q').get()).toBe(1);
    expect([...loaded.read(keyedKey, 'q').all()]).toEqual([
      ['b', 1],
      ['12345678', 2],
      ['a', 3],
    ]);
    expect(loaded.read(keyedKey, 'q').get('12345678')).toBe(2);
    expect(loaded.read(listKey, 'q').get('s')).toEqual([A1]);
    expect(loaded.isHeld('p.v')).toBe(false);
  });
});

describe('snapshotOf and ids', () => {
  it.each<{
    case: string;
    id: string;
    fill(store: SlotStore): void;
    expected: SlotSnapshot | undefined;
  }>([
    {
      case: 'value',
      id: 'p.v',
      fill: (store) => store.publish(valueKey).set(4),
      expected: { kind: 'value', value: 4 },
    },
    {
      case: 'keyed',
      id: 'p.k',
      fill(store) {
        const keyed = store.publish(keyedKey);
        keyed.set('a', 3);
        keyed.set('b', 5);
      },
      expected: {
        kind: 'keyed',
        entries: [
          ['a', 3],
          ['b', 5],
        ],
      },
    },
    {
      case: 'list',
      id: 'p.l',
      fill(store) {
        const list = store.publish(listKey);
        list.put('y', A1);
        list.put('x', B2);
      },
      expected: {
        kind: 'list',
        entries: [
          ['y', [A1]],
          ['x', [B2]],
        ],
      },
    },
    {
      case: 'created and never written',
      id: 'p.v',
      fill: (store) => store.publish(valueKey),
      expected: { kind: 'value', value: undefined },
    },
    {
      case: 'never created',
      id: 'p.none',
      fill: (store) => store.publish(valueKey).set(4),
      expected: undefined,
    },
  ])('snapshotOf_ByKind_CopiesTheSlot: $case', ({ id, fill, expected }) => {
    const { store } = storeWithLogs();
    fill(store);
    const before = store.ids();

    const snapshot = store.snapshotOf(id);

    expect(snapshot).toEqual(expected);
    expect(store.ids()).toEqual(before);
    expect(before.includes(id)).toBe(expected !== undefined);
  });

  it('ids_EverySlotOnce_InCodeUnitOrder', () => {
    const { store } = storeWithLogs();
    for (const name of ['B', 'a', 'A']) {
      store
        .publish({ id: `p.${name}`, process: 'main', kind: 'value' })
        .set(1);
    }
    store.applyRemote({ id: 'p.a', kind: 'value', value: 2 });

    expect(store.ids()).toEqual(['p.A', 'p.B', 'p.a']);
  });
});

describe('readById', () => {
  function filled() {
    const { store } = storeWithLogs();
    store.publish(valueKey).set(1);
    const keyed = store.publish(keyedKey);
    keyed.set('b', 1);
    keyed.set('12345678', 2);
    keyed.set('a', 3);
    const list = store.publish(listKey);
    list.put('y', A1);
    list.put('x', B2);
    store.publish({ id: 'p.empty', process: 'main', kind: 'list' });
    return store;
  }

  it.each<{ case: string; id: string; key?: string; expected: unknown }>([
    { case: 'value get()', id: 'p.v', expected: 1 },
    { case: 'value get(key)', id: 'p.v', key: 'k', expected: undefined },
    {
      case: 'keyed get()',
      id: 'p.k',
      expected: [
        ['b', 1],
        ['12345678', 2],
        ['a', 3],
      ],
    },
    { case: 'keyed get(key)', id: 'p.k', key: 'a', expected: 3 },
    { case: 'keyed absent', id: 'p.k', key: 'absent', expected: undefined },
    {
      case: 'keyed constructor',
      id: 'p.k',
      key: 'constructor',
      expected: undefined,
    },
    {
      case: 'list get()',
      id: 'p.l',
      expected: [
        ['y', [A1]],
        ['x', [B2]],
      ],
    },
    { case: 'list get(key)', id: 'p.l', key: 'x', expected: [B2] },
    { case: 'list absent', id: 'p.l', key: 'absent', expected: [] },
    { case: 'list unwritten', id: 'p.empty', key: 'absent', expected: [] },
    { case: 'no slot get()', id: 'p.none', expected: undefined },
    { case: 'no slot get(key)', id: 'p.none', key: 'k', expected: undefined },
  ])('readById_ByKind_Get: $case', ({ id, key, expected }) => {
    expect(filled().readById(id, 'q').get(key)).toEqual(expected);
  });

  const putA1: ListSlotChange<unknown> = { kind: 'put', item: A1 };
  it.each<{
    case: string;
    id: string;
    write(store: SlotStore): void;
    remote: SlotChange;
    expected: unknown[];
  }>([
    {
      case: 'value',
      id: 'p.v',
      write: (store) => store.publish(valueKey).set(1),
      remote: { id: 'p.v', kind: 'value', value: 1 },
      expected: [1],
    },
    {
      case: 'keyed',
      id: 'p.k',
      write: (store) => store.publish(keyedKey).set('a', 2),
      remote: { id: 'p.k', kind: 'keyed', key: 'a', value: 2 },
      expected: ['a', 2],
    },
    {
      case: 'list',
      id: 'p.l',
      write: (store) => store.publish(listKey).put('s', A1),
      remote: { id: 'p.l', kind: 'list', key: 's', change: putA1 },
      expected: ['s', putA1],
    },
  ])(
    'readById_On_BeforeFirstWrite_HearsFirstWrite: $case',
    ({ id, write, remote, expected }) => {
      for (const act of [
        write,
        (store: SlotStore) => store.applyRemote(remote),
      ]) {
        const { store } = storeWithLogs();
        const heard: unknown[][] = [];
        store.readById(id, 'q').on((...args) => heard.push(args));

        act(store);

        expect(heard).toEqual([expected]);
      }
    },
  );
});

describe('pluginState', () => {
  it('pluginState_KeyUnderAnotherPlugin_Throws', () => {
    const { store } = storeWithLogs();
    const state = pluginState(store, 'p', 'main', untracked);

    expect(() =>
      state.publish({ id: 'q.v', process: 'main', kind: 'value' }),
    ).toThrow('Slot "q.v" is not under plugin "p"');
    expect(store.isHeld('q.v')).toBe(false);
  });

  it.each([
    {
      process: 'main',
      keyProcess: 'page',
      message: 'Slot "p.v" is a page slot, published from main',
    },
    {
      process: 'page',
      keyProcess: 'main',
      message: 'Slot "p.v" is a main slot, published from page',
    },
  ] as const)(
    'pluginState_KeyOfOtherProcess_Throws: $process',
    ({ process, keyProcess, message }) => {
      const { store } = storeWithLogs();
      const state = pluginState(store, 'p', process, untracked);

      expect(() =>
        state.publish({ id: 'p.v', process: keyProcess, kind: 'value' }),
      ).toThrow(message);
    },
  );
});
