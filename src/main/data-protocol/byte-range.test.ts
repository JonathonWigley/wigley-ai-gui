import { describe, expect, it } from 'vitest';
import { byteRangeOf } from './byte-range';

describe('byteRangeOf', () => {
  it.each([
    ['a closed range', 'bytes=10-19', { start: 10, end: 19 }],
    ['an open range', 'bytes=10-', { start: 10, end: 99 }],
    ['the whole file from 0', 'bytes=0-', { start: 0, end: 99 }],
    ['a suffix', 'bytes=-30', { start: 70, end: 99 }],
    ['a suffix longer than the file', 'bytes=-500', { start: 0, end: 99 }],
    ['an end past the file', 'bytes=90-500', { start: 90, end: 99 }],
  ])('reads %s', (_case, header, range) => {
    expect(byteRangeOf(header, 100)).toEqual(range);
  });

  it.each([
    ['a start past the end', 'bytes=100-'],
    ['an end before the start', 'bytes=20-10'],
    ['an empty suffix', 'bytes=-0'],
  ])('finds %s unsatisfiable', (_case, header) => {
    expect(byteRangeOf(header, 100)).toBe('unsatisfiable');
  });

  it.each([
    ['no header', null],
    ['another unit', 'items=0-1'],
    ['a list of ranges', 'bytes=0-1,5-6'],
    ['no bounds', 'bytes=-'],
    ['words', 'bytes=a-b'],
  ])('serves the whole file for %s', (_case, header) => {
    expect(byteRangeOf(header, 100)).toBe(null);
  });
});
