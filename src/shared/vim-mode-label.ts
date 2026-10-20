import type { VimMode } from '../contracts/editor';

// How vim's status line names a visual mode's kind.
const VISUAL_KINDS: Partial<Record<string, string>> = {
  linewise: 'line',
  blockwise: 'block',
};

// The status line's mode: the focused box's vim mode as vim shows it, e.g.
// VISUAL LINE, or PAGE outside every box.
export function modeLabel(mode: VimMode | null): string {
  if (mode === null) {
    return 'PAGE';
  }
  const kind = VISUAL_KINDS[mode.subMode];
  const label = kind === undefined ? mode.mode : `${mode.mode} ${kind}`;
  return label.toUpperCase();
}
