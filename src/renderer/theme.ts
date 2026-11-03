import type { Settings } from '../contracts/settings';
import type { Theme } from '../contracts/theme';
import type { VisualTheme } from '../shared/visual-messages';
import { FONT_TOKENS, themeVariable } from '../shared/theme-variables';

// `apply` writes the theme's tokens to the root as CSS variables, the
// `reduced` overrides over them while transparency is reduced, and the set
// font settings over their tokens; views and editors read every token through
// those variables. It then hands `onApplied` what it wrote.
export interface ThemeApplier {
  apply(theme: Theme, settings: Pick<Settings, 'transparency' | 'fonts'>): void;
}

// `reducedTransparency` is the OS's reduce-transparency preference, which
// re-applies the last theme when it changes under the `system` setting.
// `onApplied` hears each custom property `apply` wrote, in write order, and
// the colour scheme.
export function createThemeApplier(
  root: HTMLElement,
  reducedTransparency: Pick<MediaQueryList, 'matches' | 'addEventListener'>,
  onApplied: (applied: VisualTheme) => void,
): ThemeApplier {
  let last: {
    theme: Theme;
    settings: Pick<Settings, 'transparency' | 'fonts'>;
  } | null = null;

  function apply(
    theme: Theme,
    settings: Pick<Settings, 'transparency' | 'fonts'>,
  ) {
    last = { theme, settings };
    const isReduced =
      settings.transparency === 'reduced' ||
      (settings.transparency === 'system' && reducedTransparency.matches);
    const properties: [name: string, value: string][] = [
      ...tokenProperties(theme.tokens),
      ...(isReduced ? tokenProperties(theme.reduced) : []),
      ...fontProperties(settings.fonts),
    ];
    for (const [name, value] of properties) {
      root.style.setProperty(name, value);
    }
    root.dataset.transparency = isReduced ? 'reduced' : 'full';
    root.style.setProperty('color-scheme', theme.colorScheme);
    onApplied({ properties, colorScheme: theme.colorScheme });
  }

  reducedTransparency.addEventListener('change', () => {
    if (last !== null && last.settings.transparency === 'system') {
      apply(last.theme, last.settings);
    }
  });
  return { apply };
}

function tokenProperties(
  tokens: Record<string, string>,
): [name: string, value: string][] {
  return Object.entries(tokens).map(([token, value]) => [
    themeVariable(token),
    value,
  ]);
}

function fontProperties(
  fonts: Settings['fonts'],
): [name: string, value: string][] {
  const { ui, mono, uiSize, monoSize, proseSize } = fonts;
  const properties: [name: string, value: string][] = [];
  if (ui !== undefined) {
    properties.push([themeVariable(FONT_TOKENS.ui), ui]);
  }
  if (mono !== undefined) {
    properties.push([themeVariable(FONT_TOKENS.mono), mono]);
  }
  if (uiSize !== undefined) {
    properties.push([themeVariable(FONT_TOKENS.uiSize), `${uiSize}px`]);
  }
  if (monoSize !== undefined) {
    properties.push([themeVariable(FONT_TOKENS.monoSize), `${monoSize}px`]);
  }
  if (proseSize !== undefined) {
    properties.push([themeVariable(FONT_TOKENS.proseSize), `${proseSize}px`]);
  }
  return properties;
}
