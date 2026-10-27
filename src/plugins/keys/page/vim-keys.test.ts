import { describe, expect, it } from 'vitest';
import { isVimKeys, pageVimKeys, VIM_KEYS } from './vim-keys';

describe('vim keys', () => {
  it('VIM_KEYS_IsThePinnedList', () => {
    expect(VIM_KEYS).toEqual([
      'j',
      'k',
      'h',
      'l',
      'gg',
      'G',
      '<CR>',
      '<Esc>',
      '<C-j>',
      '<C-k>',
      '<C-S-j>',
      '<C-S-k>',
    ]);
  });

  it('isVimKeys_Listed_True', () => {
    expect(isVimKeys('gg')).toBe(true);
    expect(isVimKeys('G')).toBe(true);
    expect(isVimKeys('<C-S-k>')).toBe(true);
  });

  it('isVimKeys_NotListed_False', () => {
    for (const keys of ['g', 'jj', 'x', '<C-l>', '<A-o>']) {
      expect(isVimKeys(keys)).toBe(false);
    }
  });

  it('pageVimKeys_PrintsVimNotation', () => {
    expect(pageVimKeys(['g', 'g'])).toBe('gg');
    expect(pageVimKeys(['Escape'])).toBe('<Esc>');
    expect(pageVimKeys(['Tab'])).toBe('<Tab>');
  });
});
