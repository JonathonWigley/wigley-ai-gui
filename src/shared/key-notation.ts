// Vim-notation key tokens and the page keys they stand for: a page key is a
// KeyboardEvent.key value, or a chord in the page's chord notation.

import { parseChord } from './chord-notation';
import { vimTokens } from './key-hints';

// The chord each spelling of Tab and Shift+Tab stands for, by its lowercase
// name, as vim reads names in any case.
const CHORD_BY_VIM_NAME: Partial<Record<string, string>> = {
  tab: '<Tab>',
  's-tab': '<S-Tab>',
};

// The page key of each other named vim key the page can bind, by its
// lowercase spelling.
const PAGE_KEY_BY_VIM_NAME: Partial<Record<string, string>> = {
  space: ' ',
  cr: 'Enter',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  bs: 'Backspace',
  lt: '<',
  bar: '|',
  bslash: '\\',
};

const VIM_TOKEN_BY_PAGE_KEY: Partial<Record<string, string>> = {
  ' ': '<Space>',
  Enter: '<CR>',
  Escape: '<Esc>',
  Backspace: '<BS>',
  '<': '<lt>',
  '\\': '<Bslash>',
};

// `token` in the chord notation when it is a chord in any spelling, else
// unchanged: `<s-tab>` is `<S-Tab>`.
function chordSpelling(token: string): string {
  const name = token.slice(1, -1).toLowerCase();
  return CHORD_BY_VIM_NAME[name] ?? token;
}

// Whether vim-notation `keys`, `<Leader>` spelled as `leader`, are one chord
// in any spelling: `<C-n>` and `<tab>` are, `<Leader>` and `g<Tab>` are not.
export function isChordKeys(keys: string, leader: string): boolean {
  const tokens = vimTokens(keys, leader);
  return tokens.length === 1 && parseChord(chordSpelling(tokens[0])) !== null;
}

function pageKeyFor(token: string): string {
  if (token.length === 1) {
    return token;
  }
  const chord = chordSpelling(token);
  if (parseChord(chord) !== null) {
    return chord;
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
// chord comes back in the chord notation. Throws on a `<…>` token the page has no key for.
export function pageKeysFor(keys: string, leader: string): string[] {
  return vimTokens(keys, leader).map(pageKeyFor);
}

// The vim token for one page key: `Enter` is `<CR>`, `' '` is `<Space>`; a
// chord or one character returns unchanged.
export function vimTokenForPageKey(key: string): string {
  return VIM_TOKEN_BY_PAGE_KEY[key] ?? key;
}
