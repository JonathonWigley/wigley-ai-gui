import { describe, expect, it } from 'vitest';
import { modeLabel } from './vim-mode-label';

describe('modeLabel', () => {
  it('reads PAGE outside every box', () => {
    expect(modeLabel(null)).toBe('PAGE');
  });

  it("reads the box's vim mode in capitals", () => {
    expect(modeLabel({ mode: 'insert', subMode: '' })).toBe('INSERT');
  });

  it('names a visual mode by its kind, as vim does', () => {
    expect(modeLabel({ mode: 'visual', subMode: '' })).toBe('VISUAL');
    expect(modeLabel({ mode: 'visual', subMode: 'linewise' })).toBe(
      'VISUAL LINE',
    );
    expect(modeLabel({ mode: 'visual', subMode: 'blockwise' })).toBe(
      'VISUAL BLOCK',
    );
  });
});
