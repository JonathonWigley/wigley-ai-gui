import { describe, expect, it } from 'vitest';
import { passesToPage } from './key-rule';

describe('passesToPage', () => {
  it.each([
    ['Escape', true],
    ['Enter', false],
    ['Tab', false],
    [' ', false],
    ['a', false],
  ])('passesToPage_EachKey_PassesOnlyEscape (%j)', (key, passes) => {
    expect(passesToPage(key)).toBe(passes);
  });
});
