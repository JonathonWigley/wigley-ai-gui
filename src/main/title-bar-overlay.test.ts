import { describe, expect, it } from 'vitest';
import type { Theme } from '../contracts/theme';
import { titleBarOverlayOf } from './title-bar-overlay';

function theme(tokens: Record<string, string>): Theme {
  return { name: 'test', colorScheme: 'dark', tokens, reduced: {} };
}

const BASE = {
  'window-background': '#11111b',
  'fg-secondary': '#a6adc8',
  'toolbar-height': '40px',
};

describe('titleBarOverlayOf', () => {
  it('takes the window background, secondary text colour and toolbar height', () => {
    expect(titleBarOverlayOf(theme(BASE))).toEqual({
      color: '#11111b',
      symbolColor: '#a6adc8',
      height: 40,
    });
  });

  it('follows a token alias to its value', () => {
    const overlay = titleBarOverlayOf(
      theme({
        ...BASE,
        'window-background': 'var(--wg-base-colour)',
        'base-colour': '#1e1e2e',
      }),
    );

    expect(overlay.color).toBe('#1e1e2e');
  });

  it('rejects a toolbar height that is not px', () => {
    expect(() =>
      titleBarOverlayOf(theme({ ...BASE, 'toolbar-height': '2.5rem' })),
    ).toThrow('Token toolbar-height is "2.5rem", not a px length');
  });
});
