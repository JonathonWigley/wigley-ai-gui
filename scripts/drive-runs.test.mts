import { describe, expect, it } from 'vitest';
import { idleRunIds, RUN_IDLE_MS, type RunFolder } from './drive-runs.mts';

const NOW = 1_000_000_000_000;

describe('idleRunIds', () => {
  it.each<[string, boolean, Partial<RunFolder>, string]>([
    ['idle past the limit with no live app', true, {}, 'other'],
    [
      'used within the limit',
      false,
      { lastUsedMs: NOW - RUN_IDLE_MS + 1 },
      'other',
    ],
    ['exactly at the limit', false, { lastUsedMs: NOW - RUN_IDLE_MS }, 'other'],
    ['idle but its app is live', false, { isLive: true }, 'other'],
    ['idle but the run being started', false, {}, 'old'],
  ])(
    'GIVEN a run %s WHEN a start sweeps THEN its deletion is %s',
    (_, isDeleted, overrides, startingRun) => {
      const run: RunFolder = {
        id: 'old',
        lastUsedMs: NOW - RUN_IDLE_MS - 1,
        isLive: false,
        ...overrides,
      };

      expect(idleRunIds([run], startingRun, NOW)).toEqual(
        isDeleted ? ['old'] : [],
      );
    },
  );
});
