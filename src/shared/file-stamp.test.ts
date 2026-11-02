import { describe, expect, it } from 'vitest';
import { fileStamp } from './file-stamp';

describe('fileStamp', () => {
  it.each([
    {
      epochMs: new Date(2026, 10, 2, 9, 5, 7).getTime(),
      stamp: '20261102-090507',
    },
    {
      epochMs: new Date(2026, 0, 1, 0, 0, 0).getTime(),
      stamp: '20260101-000000',
    },
    {
      epochMs: new Date(2026, 11, 31, 23, 59, 59).getTime(),
      stamp: '20261231-235959',
    },
  ])(
    'fileStamp writes local time as yyyyMMdd-HHmmss: $stamp',
    ({ epochMs, stamp }) => {
      expect(fileStamp(epochMs)).toBe(stamp);
    },
  );
});
