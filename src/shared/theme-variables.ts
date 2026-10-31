import type { Settings } from '../contracts/settings';

// A token's CSS custom property: `fg-secondary` → `--wg-fg-secondary`,
// `forms.origin-caused` → `--wg-forms-origin-caused`.
export function themeVariable(token: string): string {
  return `--wg-${token.replaceAll('.', '-')}`;
}

// The theme token each font setting overrides when set.
export const FONT_TOKENS = {
  ui: 'font-ui',
  mono: 'font-mono',
  uiSize: 'text-ui',
  monoSize: 'text-mono',
  proseSize: 'text-prose',
} as const satisfies Record<keyof Settings['fonts'], string>;
