import type { Settings } from '../contracts/settings';
import type { ThemeToken } from '../contracts/theme';

// A token's CSS custom property: `bg.base` → `--wg-bg-base`.
export function themeVariable(token: ThemeToken): string {
  return `--wg-${token.replaceAll('.', '-')}`;
}

// The CSS custom property each font setting is applied to.
export const FONT_VARIABLES = {
  ui: '--wg-font-ui',
  mono: '--wg-font-mono',
  uiSize: '--wg-font-ui-size',
  monoSize: '--wg-font-mono-size',
} as const satisfies Record<keyof Settings['fonts'], string>;
