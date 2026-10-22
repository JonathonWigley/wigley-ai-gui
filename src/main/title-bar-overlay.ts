import type { Theme } from '../contracts/theme';

// A token value that is wholly another token's variable.
const WHOLE_ALIAS = /^var\(--wg-([a-z0-9-]+)\)$/;

const PX_LENGTH = /^(\d+(?:\.\d+)?)px$/;

// `token`'s value in `theme`, following whole `var(--wg-…)` aliases to a value
// that is not one; the theme loader has already rejected alias cycles.
function resolvedToken(theme: Theme, token: string): string {
  let name = token;
  for (;;) {
    const value = theme.tokens[name];
    if (value === undefined) {
      throw new Error(`Token ${name} has no value in theme ${theme.name}`);
    }
    const alias = WHOLE_ALIAS.exec(value);
    if (alias === null) {
      return value;
    }
    name = alias[1];
  }
}

// The Windows and Linux title bar overlay, the OS window buttons drawn over
// the page: the window background behind them, the secondary text colour for
// their symbols, and the toolbar height.
export function titleBarOverlayOf(theme: Theme): {
  color: string;
  symbolColor: string;
  height: number;
} {
  const toolbarHeight = resolvedToken(theme, 'toolbar-height');
  const px = PX_LENGTH.exec(toolbarHeight);
  if (px === null) {
    throw new Error(
      `Token toolbar-height is "${toolbarHeight}", not a px length`,
    );
  }
  return {
    color: resolvedToken(theme, 'window-background'),
    symbolColor: resolvedToken(theme, 'fg-secondary'),
    height: Number(px[1]),
  };
}
