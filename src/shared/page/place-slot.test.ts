import { describe, expect, it } from 'vitest';
import type { KeyedSlotWriter } from '../../contracts/state';
import { placeWrites, pruneKeys } from './place-slot';

function mapWriter<V>(entries: [string, V][]): KeyedSlotWriter<V> {
  const values = new Map(entries);
  return {
    get: (key) => values.get(key),
    all: () => new Map(values),
    set: (key, value) => void values.set(key, value),
    delete: (key) => void values.delete(key),
    dispose: () => undefined,
  };
}

describe('placeWrites', () => {
  it('equal_value_writes_once', () => {
    const written: { cursor: number; open: string[] }[] = [];
    const writes = placeWrites((value: { cursor: number; open: string[] }) =>
      written.push(value),
    );

    writes.write({ cursor: 2, open: ['a'] });
    writes.write({ cursor: 2, open: ['a'] });
    writes.write({ cursor: 3, open: ['a'] });

    expect(written).toEqual([
      { cursor: 2, open: ['a'] },
      { cursor: 3, open: ['a'] },
    ]);
  });

  it('equal_value_writes_again_after_reset', () => {
    const written: string[] = [];
    const writes = placeWrites((value: string) => written.push(value));

    writes.write('draft');
    writes.reset();
    writes.write('draft');

    expect(written).toEqual(['draft', 'draft']);
  });
});

describe('pruneKeys', () => {
  it('prune_deletes_only_dead_keys', () => {
    const writer = mapWriter([
      ['live-1', 1],
      ['dead-1', 2],
      ['live-2', 3],
      ['dead-2', 4],
    ]);

    pruneKeys(writer, (key) => key.startsWith('live'));

    expect([...writer.all()]).toEqual([
      ['live-1', 1],
      ['live-2', 3],
    ]);
  });
});
