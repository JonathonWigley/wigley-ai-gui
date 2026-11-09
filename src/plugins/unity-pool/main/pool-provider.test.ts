import { describe, expect, it } from 'vitest';
import type { PoolClone, PoolSnapshot, PoolState } from '../contract';
import { createPoolProvider } from './pool-provider';

function clone(number: number, path: string): PoolClone {
  return {
    number,
    path,
    facts: { branch: 'main', dirty: false, editor: 'ready', probedAt: 1_000 },
    claim: null,
    handoff: null,
    stranded: null,
    lastHolder: null,
    lastReleasedAt: null,
    warmup: null,
  };
}

function pool(name: string, clones: PoolClone[]): PoolState {
  return { pool: name, updatedAt: 1_000, clones, queue: [] };
}

const POOLS: PoolSnapshot = {
  pools: [
    pool('p', [clone(1, '/c/1'), clone(2, '/c/2')]),
    pool('q', [clone(1, '/q/1')]),
  ],
};

describe('createPoolProvider', () => {
  it.each([
    { pool: 'p', expected: ['/c/1', '/c/2'] },
    { pool: 'q', expected: ['/q/1'] },
    { pool: 'r', expected: [] },
  ])('folders: $pool', ({ pool: name, expected }) => {
    expect(createPoolProvider(() => POOLS).folders(name)).toEqual(expected);
  });

  it('folders_SnapshotChanges_ReadsTheNewOne', () => {
    let snapshot: PoolSnapshot = { pools: [] };
    const provider = createPoolProvider(() => snapshot);
    expect(provider.folders('p')).toEqual([]);
    snapshot = POOLS;
    expect(provider.folders('p')).toEqual(['/c/1', '/c/2']);
  });
});
