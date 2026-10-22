import { describe, expect, it } from 'vitest';
import { pageKeysFor, vimTokenForPageKey } from './key-notation';

const NAMED_KEYS: [vimToken: string, pageKey: string][] = [
  ['<Space>', ' '],
  ['<CR>', 'Enter'],
  ['<Esc>', 'Escape'],
  ['<Tab>', 'Tab'],
  ['<BS>', 'Backspace'],
  ['<lt>', '<'],
  ['<Bslash>', '\\'],
];

describe('pageKeysFor', () => {
  it.each(NAMED_KEYS)('converts %s to its page key', (vimToken, pageKey) => {
    expect(pageKeysFor(vimToken, '<Space>')).toEqual([pageKey]);
  });

  it('converts <Enter> as <CR>', () => {
    expect(pageKeysFor('<Enter>', '<Space>')).toEqual(['Enter']);
  });

  it('converts <Return> as <CR>', () => {
    expect(pageKeysFor('<Return>', '<Space>')).toEqual(['Enter']);
  });

  it('converts <Bar> to |', () => {
    expect(pageKeysFor('<Bar>', '<Space>')).toEqual(['|']);
  });

  it('converts a named key in any case, <cr> as <CR>', () => {
    expect(pageKeysFor('<cr>', '<Space>')).toEqual(['Enter']);
  });

  it('converts <return> as <Return>', () => {
    expect(pageKeysFor('<return>', '<Space>')).toEqual(['Enter']);
  });

  it('keeps chords and single characters as written', () => {
    expect(pageKeysFor('<A-o><D-Enter><A-S-o>gG', '<Space>')).toEqual([
      '<A-o>',
      '<D-Enter>',
      '<A-S-o>',
      'g',
      'G',
    ]);
  });

  it('spells <Leader> as the leader first', () => {
    expect(pageKeysFor('<Leader>ks', ',')).toEqual([',', 'k', 's']);
  });

  it('throws naming a <…> token the page has no key for', () => {
    expect(() => pageKeysFor('<F5>', '<Space>')).toThrow(
      '<F5> is not a key the page can bind.',
    );
  });

  it('throws on a chord written in lowercase modifiers', () => {
    expect(() => pageKeysFor('<a-o>', '<Space>')).toThrow(
      '<a-o> is not a key the page can bind.',
    );
  });
});

describe('vimTokenForPageKey', () => {
  it.each(NAMED_KEYS)('returns %s for its page key', (vimToken, pageKey) => {
    expect(vimTokenForPageKey(pageKey)).toBe(vimToken);
  });

  it('returns a chord or one character unchanged', () => {
    expect(vimTokenForPageKey('<A-o>')).toBe('<A-o>');
    expect(vimTokenForPageKey('k')).toBe('k');
  });
});
