import { describe, expect, it } from 'vitest';
import { isChordKeys, pageKeysFor, vimTokenForPageKey } from './key-notation';

const NAMED_KEYS: [vimToken: string, pageKey: string][] = [
  ['<Space>', ' '],
  ['<CR>', 'Enter'],
  ['<Esc>', 'Escape'],
  ['<BS>', 'Backspace'],
  ['<lt>', '<'],
  ['<Bslash>', '\\'],
];

describe('pageKeysFor', () => {
  it.each(NAMED_KEYS)('converts %s to its page key', (vimToken, pageKey) => {
    expect(pageKeysFor(vimToken, '<Space>')).toEqual([pageKey]);
  });

  // Spellings the page reads but never writes back, so they sit outside NAMED_KEYS.
  it.each([
    ['<Enter>', 'Enter'],
    ['<Return>', 'Enter'],
    ['<Bar>', '|'],
    ['<cr>', 'Enter'],
    ['<return>', 'Enter'],
    ['<tab>', '<Tab>'],
    ['<TAB>', '<Tab>'],
    ['<s-tab>', '<S-Tab>'],
    ['<S-tab>', '<S-Tab>'],
  ])('converts the spelling %s to %s', (vimToken, pageKey) => {
    expect(pageKeysFor(vimToken, '<Space>')).toEqual([pageKey]);
  });

  it('keeps chords and single characters as written', () => {
    expect(pageKeysFor('<A-o><D-Enter><Tab><A-S-o>gG', '<Space>')).toEqual([
      '<A-o>',
      '<D-Enter>',
      '<Tab>',
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

describe('isChordKeys', () => {
  it.each([
    ['<C-n>', true],
    ['<Tab>', true],
    ['<tab>', true],
    ['<s-Tab>', true],
    ['<Leader>', false],
    ['g<Tab>', false],
    ['<Esc>', false],
    ['k', false],
  ])('%s is one chord: %s', (keys, expected) => {
    expect(isChordKeys(keys, '<Space>')).toBe(expected);
  });
});
