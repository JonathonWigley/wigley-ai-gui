import { describe, expect, it } from 'vitest';
import { exitReason } from './exit-reason';

describe('exitReason', () => {
  it.each([
    {
      case: 'error over code',
      exit: { code: 1, signal: null, error: 'spawn failed' },
      reason: 'spawn failed',
    },
    { case: 'code', exit: { code: 0, signal: null, error: null }, reason: 'code 0' },
    {
      case: 'signal',
      exit: { code: null, signal: 1, error: null },
      reason: 'signal 1',
    },
    {
      case: 'nothing known',
      exit: { code: null, signal: null, error: null },
      reason: 'unknown',
    },
  ])('exitReason_$case', ({ exit, reason }) => {
    expect(exitReason(exit)).toBe(reason);
  });
});
