// `scripts/` runs under plain Node and cannot import `src/`, so the login
// start's label and flag are written on both sides; this test holds the two
// copies together.
import { describe, expect, it } from 'vitest';
import {
  LOGIN_START_FLAG as APP_FLAG,
  LOGIN_START_LABEL as APP_LABEL,
} from '../src/contracts/login-start.ts';
import {
  LOGIN_START_FLAG as SCRIPT_FLAG,
  LOGIN_START_LABEL as SCRIPT_LABEL,
} from './login-item-plist.mts';

describe('the login start copies', () => {
  it('name one launchd label', () => {
    expect(SCRIPT_LABEL).toBe(APP_LABEL);
  });

  it('name one flag', () => {
    expect(SCRIPT_FLAG).toBe(APP_FLAG);
  });
});
