import type { Theme } from '../contracts/theme';
import { themeVariable } from '../shared/theme-variables';

// A token value that is wholly another token's variable.
const WHOLE_ALIAS = /^var\(--wg-([^\s,()]+)\)$/;

const PX_LENGTH = /^(\d+(?:\.\d+)?|\.\d+)px$/;
const REM_LENGTH = /^(\d+(?:\.\d+)?|\.\d+)rem$/;
const HEX_COLOUR = /^#([0-9a-f]{6})([0-9a-f]{2})?$/;

// Chromium's default font size, which no page CSS overrides on the root.
const ROOT_FONT_PX = 16;

const BAR_BACKGROUND = 'material-chrome-bg';
const SYMBOL_COLOUR = 'fg-secondary';
const BAR_HEIGHT = 'toolbar-height';
const WINDOW_BACKGROUND = 'window-background';

// The Windows and Linux title bar overlay, where the OS draws its window
// buttons over the page.
export interface TitleBarOverlay {
  color: string;
  symbolColor: string;
  height: number;
}

interface Rgba {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

// The tokens the page paints: `theme.tokens` with `theme.reduced` over them
// while transparency is reduced.
function tokensInForce(
  theme: Theme,
  isReduced: boolean,
): Record<string, string> {
  return isReduced ? { ...theme.tokens, ...theme.reduced } : theme.tokens;
}

// `token`'s value in `tokens`, following whole `var(--wg-…)` aliases (a
// plugin token's variable dashes its dot) to a value that is not one; the
// theme loader has already rejected alias cycles under both token sets.
function resolvedToken(tokens: Record<string, string>, token: string): string {
  const byVariable = new Map(
    Object.keys(tokens).map((name) => [
      themeVariable(name).slice('--wg-'.length),
      name,
    ]),
  );
  let name = token;
  for (;;) {
    const value = tokens[name];
    if (value === undefined) {
      throw new Error(`token "${token}": ${name} has no value`);
    }
    const alias = WHOLE_ALIAS.exec(value);
    if (alias === null) {
      return value;
    }
    name = byVariable.get(alias[1]) ?? alias[1];
  }
}

// A resolved colour token's value: `#rrggbb`, `#rrggbbaa` or `transparent`.
function colourOf(tokens: Record<string, string>, token: string): Rgba {
  const value = resolvedToken(tokens, token);
  if (value === 'transparent') {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }
  const hex = HEX_COLOUR.exec(value);
  if (hex === null) {
    throw new Error(
      `token "${token}": "${value}" is not a #rrggbb, #rrggbbaa or transparent colour, which the title bar overlay needs`,
    );
  }
  const channel = (at: number) => Number.parseInt(hex[1].slice(at, at + 2), 16);
  return {
    red: channel(0),
    green: channel(2),
    blue: channel(4),
    alpha: hex[2] === undefined ? 1 : Number.parseInt(hex[2], 16) / 255,
  };
}

// `top` painted over the opaque `under`.
function composited(top: Rgba, under: Rgba): Rgba {
  const mix = (over: number, below: number) =>
    Math.round(top.alpha * over + (1 - top.alpha) * below);
  return {
    red: mix(top.red, under.red),
    green: mix(top.green, under.green),
    blue: mix(top.blue, under.blue),
    alpha: 1,
  };
}

function hexOf(colour: Rgba): string {
  const pair = (channel: number) => channel.toString(16).padStart(2, '0');
  return `#${pair(colour.red)}${pair(colour.green)}${pair(colour.blue)}`;
}

// A length token in whole px: px as written, rem against the root font size.
// Other units hang off the element or the window, which main cannot know.
function pxOf(tokens: Record<string, string>, token: string): number {
  const value = resolvedToken(tokens, token);
  const px = PX_LENGTH.exec(value);
  const rem = REM_LENGTH.exec(value);
  if (value === '0') {
    return 0;
  }
  if (px !== null) {
    return Math.round(Number(px[1]));
  }
  if (rem !== null) {
    return Math.round(Number(rem[1]) * ROOT_FONT_PX);
  }
  throw new Error(
    `token "${token}": "${value}" is not a px or rem length, which the title bar overlay needs`,
  );
}

// The native window's background: `window-background` as the page paints it,
// which the theme loader requires to be an opaque `#rrggbb`.
export function windowBackgroundOf(theme: Theme, isReduced: boolean): string {
  return tokensInForce(theme, isReduced)[WINDOW_BACKGROUND];
}

// The overlay over the title bar as the page paints it: the bar's material
// over the window background, and the secondary text colour over that, both
// made opaque, since the overlay draws over the page's own bar and a
// translucent overlay would tint it twice; the toolbar height in px. Throws,
// naming the token, on a value the overlay cannot take.
export function titleBarOverlayOf(
  theme: Theme,
  isReduced: boolean,
): TitleBarOverlay {
  const tokens = tokensInForce(theme, isReduced);
  const bar = composited(
    colourOf(tokens, BAR_BACKGROUND),
    colourOf(tokens, WINDOW_BACKGROUND),
  );
  return {
    color: hexOf(bar),
    symbolColor: hexOf(composited(colourOf(tokens, SYMBOL_COLOUR), bar)),
    height: pxOf(tokens, BAR_HEIGHT),
  };
}

// Throws, naming the token, when the overlay cannot take `theme` under full
// or reduced transparency; checked on every platform so a theme stays
// portable.
export function checkTitleBarOverlay(theme: Theme): void {
  titleBarOverlayOf(theme, false);
  titleBarOverlayOf(theme, true);
}
