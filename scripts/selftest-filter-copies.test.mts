// `scripts/` runs under plain Node and cannot import `src/`, so the filter's
// environment variable and shape are written on both sides; this test holds
// the two copies together.
import { describe, expect, it } from 'vitest';
import {
  SELFTEST_FILTER_ENV as MAIN_FILTER_ENV,
  selfTestFilterOf,
} from '../src/main/selftest-config.ts';
import {
  filterEnvOf,
  SELFTEST_FILTER_ENV as SCRIPT_FILTER_ENV,
} from './selftest-args.mts';

describe('the self-test filter copies', () => {
  it('name one environment variable', () => {
    expect(SCRIPT_FILTER_ENV).toBe(MAIN_FILTER_ENV);
  });

  it.each([
    { plugins: [], groups: [] },
    { plugins: ['settings', 'docs'], groups: ['forms: gallery', 'side bar'] },
  ])("main reads the script's filter $plugins $groups as written", (args) => {
    expect(selfTestFilterOf(filterEnvOf(args))).toEqual(args);
  });
});
