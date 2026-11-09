import { describe, expect, it } from 'vitest';
import { isVimKeys, pageVimKeys } from './vim-keys';

describe('vim keys', () => {
  it('isVimKeys_Listed_True', () => {
    expect(isVimKeys('gg')).toBe(true);
    expect(isVimKeys('G')).toBe(true);
    expect(isVimKeys('<C-S-k>')).toBe(true);
  });

  it('isVimKeys_OtherSpelling_True', () => {
    for (const keys of [
      '<esc>',
      '<ESC>',
      '<Enter>',
      '<Return>',
      '<cr>',
      '<c-j>',
      '<S-C-k>',
      '<C-K>',
    ]) {
      expect(isVimKeys(keys)).toBe(true);
    }
  });

  it('isVimKeys_NotListed_False', () => {
    for (const keys of [
      'g',
      'jj',
      'x',
      '<C-l>',
      '<A-o>',
      '<A-j>',
      '<Tab>',
      '<X-j>',
    ]) {
      expect(isVimKeys(keys)).toBe(false);
    }
  });

  it('pageVimKeys_PrintsVimNotation', () => {
    expect(pageVimKeys(['g', 'g'])).toBe('gg');
    expect(pageVimKeys(['Escape'])).toBe('<Esc>');
    expect(pageVimKeys(['<Tab>'])).toBe('<Tab>');
  });
});
