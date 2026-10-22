// Vim-notation key tokens and the page keys they stand for: a page key is a
// KeyboardEvent.key value, or a chord in the page's chord notation.

import { parseChord } from './chord-notation';
import { vimTokens } from './key-hints';

// The page key of each named vim key the page can bind, by its lowercase
// spelling, as vim reads names in any case.
const PAGE_KEY_BY_VIM_NAME: Partial<Record<string, string>> = {
  space: ' ',
  cr: 'Enter',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  tab: 'Tab',
  bs: 'Backspace',
  lt: '<',
  bar: '|',
  bslash: '\\',
};

const VIM_TOKEN_BY_PAGE_KEY: Partial<Record<string, string>> = {
  ' ': '<Space>',
  Enter: '<CR>',
  Escape: '<Esc>',
  Tab: '<Tab>',
  Backspace: '<BS>',
  '<': '<lt>',
  '\\': '<Bslash>',
};

function pageKeyFor(token: string): string {
  if (token.length === 1 || parseChord(token) !== null) {
    return token;
  }
  const name = token.slice(1, -1).toLowerCase();
  const pageKey = PAGE_KEY_BY_VIM_NAME[name];
  if (pageKey === undefined) {
    throw new Error(`${token} is not a key the page can bind.`);
  }
  return pageKey;
}

// The page keys vim-notation `keys` press, every `<Leader>` spelled as
// `leader` first: `<Leader>ks` with leader `<Space>` is `[' ', 'k', 's']`. A
// chord stays as written. Throws on a `<…>` token the page has no key for.
export function pageKeysFor(keys: string, leader: string): string[] {
  return vimTokens(keys, leader).map(pageKeyFor);
}

// The vim token for one page key: `Enter` is `<CR>`, `' '` is `<Space>`; a
// chord or one character returns unchanged.
export function vimTokenForPageKey(key: string): string {
  return VIM_TOKEN_BY_PAGE_KEY[key] ?? key;
}
