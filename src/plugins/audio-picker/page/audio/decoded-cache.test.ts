import { describe, expect, it } from 'vitest';
import type { DecodedAudio } from './audio-output';
import { createDecodedCache } from './decoded-cache';

type Operation =
  | { op: 'set'; key: string; byteSize: number }
  | { op: 'get'; key: string }
  | { op: 'delete'; key: string };

function set(key: string, byteSize: number): Operation {
  return { op: 'set', key, byteSize };
}

function get(key: string): Operation {
  return { op: 'get', key };
}

function remove(key: string): Operation {
  return { op: 'delete', key };
}

function audioOf(byteSize: number): DecodedAudio {
  return { duration: 1, channels: [], byteSize };
}

describe('createDecodedCache', () => {
  it.each([
    {
      case: 'least recent evicted',
      operations: [set('a', 40), set('b', 40), get('a'), set('c', 40)],
      kept: ['a', 'c'],
      bytes: 80,
    },
    {
      case: 'evicts until it fits',
      operations: [set('a', 30), set('b', 30), set('c', 30), set('d', 70)],
      kept: ['c', 'd'],
      bytes: 100,
    },
    {
      case: 'too large is not kept',
      operations: [set('a', 40), set('big', 150)],
      kept: ['a'],
      bytes: 40,
    },
    {
      case: 'same key replaced',
      operations: [set('a', 40), set('a', 25)],
      kept: ['a'],
      bytes: 25,
    },
    {
      case: 'delete',
      operations: [set('a', 40), set('b', 30), remove('a')],
      kept: ['b'],
      bytes: 30,
    },
  ])(
    'DecodedCache_Operations_KeepsTheMostRecentWithinMaxBytes: $case',
    ({ operations, kept, bytes }) => {
      const cache = createDecodedCache(100);
      const stored = new Map<string, DecodedAudio>();
      for (const operation of operations) {
        switch (operation.op) {
          case 'set': {
            const audio = audioOf(operation.byteSize);
            stored.set(operation.key, audio);
            cache.set(operation.key, audio);
            break;
          }
          case 'get':
            cache.get(operation.key);
            break;
          case 'delete':
            cache.delete(operation.key);
            break;
        }
      }

      const found = [...stored.keys()].filter(
        (key) => cache.get(key) === stored.get(key),
      );
      expect(found).toEqual(kept);
      expect(cache.bytes).toBe(bytes);
    },
  );
});
