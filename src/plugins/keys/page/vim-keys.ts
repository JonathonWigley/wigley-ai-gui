import { normalVimKeys } from '../../../shared/key-hints';
import { vimTokenForPageKey } from '../../../shared/key-notation';

// Vim's own key sequences, in vim notation: they work the same on every list
// and pane, so they need no anchor and a prompt shows another bind first.
export const VIM_KEYS: readonly string[] = [
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
];

const NORMAL_VIM_KEYS: ReadonlySet<string> = new Set(
  VIM_KEYS.map(normalVimKeys),
);

// Whether `keys`, in vim notation in any spelling, is one of vim's own key
// sequences: `<esc>`, `<Enter>` and `<c-j>` are.
export function isVimKeys(keys: string): boolean {
  return NORMAL_VIM_KEYS.has(normalVimKeys(keys));
}

// A page bind's keys in vim notation: `['g', 'g']` is `gg`, `['Escape']` is
// `<Esc>`.
export function pageVimKeys(keys: readonly string[]): string {
  return keys.map(vimTokenForPageKey).join('');
}
