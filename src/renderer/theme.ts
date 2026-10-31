import type { Settings } from '../contracts/settings';
import type { Theme } from '../contracts/theme';
import { FONT_TOKENS, themeVariable } from '../shared/theme-variables';

// `apply` writes the theme's tokens to the root as CSS variables, the
// `reduced` overrides over them while transparency is reduced, and the set
// font settings over their tokens; views and editors read every token through
// those variables.
export interface ThemeApplier {
  apply(theme: Theme, settings: Pick<Settings, 'transparency' | 'fonts'>): void;
}

// `reducedTransparency` is the OS's reduce-transparency preference, which
// re-applies the last theme when it changes under the `system` setting.
export function createThemeApplier(
  root: HTMLElement,
  reducedTransparency: Pick<MediaQueryList, 'matches' | 'addEventListener'>,
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
    for (const [token, value] of Object.entries(theme.tokens)) {
      root.style.setProperty(themeVariable(token), value);
    }
    const isReduced =
      settings.transparency === 'reduced' ||
      (settings.transparency === 'system' && reducedTransparency.matches);
    if (isReduced) {
      for (const [token, value] of Object.entries(theme.reduced)) {
        root.style.setProperty(themeVariable(token), value);
      }
    }
    applyFonts(root, settings.fonts);
    root.dataset.transparency = isReduced ? 'reduced' : 'full';
    root.style.setProperty('color-scheme', theme.colorScheme);
  }

  reducedTransparency.addEventListener('change', () => {
    if (last !== null && last.settings.transparency === 'system') {
      apply(last.theme, last.settings);
    }
  });
  return { apply };
}

function applyFonts(root: HTMLElement, fonts: Settings['fonts']) {
  const { ui, mono, uiSize, monoSize, proseSize } = fonts;
  if (ui !== undefined) {
    root.style.setProperty(themeVariable(FONT_TOKENS.ui), ui);
  }
  if (mono !== undefined) {
    root.style.setProperty(themeVariable(FONT_TOKENS.mono), mono);
  }
  if (uiSize !== undefined) {
    root.style.setProperty(themeVariable(FONT_TOKENS.uiSize), `${uiSize}px`);
  }
  if (monoSize !== undefined) {
    root.style.setProperty(
      themeVariable(FONT_TOKENS.monoSize),
      `${monoSize}px`,
    );
  }
  if (proseSize !== undefined) {
    root.style.setProperty(
      themeVariable(FONT_TOKENS.proseSize),
      `${proseSize}px`,
    );
  }
}
