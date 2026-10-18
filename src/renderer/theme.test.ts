import { describe, expect, it } from 'vitest';
import { THEME_TOKENS, type Theme, type ThemeToken } from '../contracts/theme';
import { themeVariable } from '../shared/theme-variables';
import { applyTheme } from './theme';

function fakeRoot() {
  const properties = new Map<string, string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => {
        properties.set(name, value);
      },
    },
  };
  return { root: root as unknown as HTMLElement, properties };
}

// A distinct colour per token, so a token applied to the wrong variable shows.
const theme: Theme = {
  name: 'test',
  tokens: Object.fromEntries(
    THEME_TOKENS.map(
      (token, index) =>
        [token, `#0000${index.toString(16).padStart(2, '0')}`] as const,
    ),
  ) as Record<ThemeToken, string>,
};

const fonts = { ui: 'Inter', mono: 'Menlo', uiSize: 14, monoSize: 13 };

describe('applyTheme', () => {
  it('sets each token variable to its own colour', () => {
    const { root, properties } = fakeRoot();

    applyTheme(theme, fonts, root);

    expect(properties.get('--wg-bg-base')).toBe(theme.tokens['bg.base']);
    for (const token of THEME_TOKENS) {
      expect(properties.get(themeVariable(token))).toBe(theme.tokens[token]);
    }
  });

  it('sets the font families and pixel sizes', () => {
    const { root, properties } = fakeRoot();

    applyTheme(theme, fonts, root);

    expect(properties.get('--wg-font-ui')).toBe('Inter');
    expect(properties.get('--wg-font-mono')).toBe('Menlo');
    expect(properties.get('--wg-font-ui-size')).toBe('14px');
    expect(properties.get('--wg-font-mono-size')).toBe('13px');
  });
});
