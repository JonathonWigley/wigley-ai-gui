import { describe, expect, it } from 'vitest';
import { createNoLoginStart } from './no-login-start';

describe('createNoLoginStart', () => {
  it.each([true, false])('answers unsupported to set(%s)', async (on) => {
    expect(await createNoLoginStart().set(on)).toEqual({
      state: 'unsupported',
      detail: null,
    });
  });
});
