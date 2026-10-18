import type { Settings } from '../contracts/settings';
import { THEME_TOKENS, type Theme } from '../contracts/theme';
import { FONT_VARIABLES, themeVariable } from '../shared/theme-variables';

// Views and editors read colours and fonts only through these variables.
export function applyTheme(
  theme: Theme,
  fonts: Settings['fonts'],
  root: HTMLElement,
) {
  for (const token of THEME_TOKENS) {
    root.style.setProperty(themeVariable(token), theme.tokens[token]);
  }
  root.style.setProperty(FONT_VARIABLES.ui, fonts.ui);
  root.style.setProperty(FONT_VARIABLES.mono, fonts.mono);
  root.style.setProperty(FONT_VARIABLES.uiSize, `${fonts.uiSize}px`);
  root.style.setProperty(FONT_VARIABLES.monoSize, `${fonts.monoSize}px`);
}
