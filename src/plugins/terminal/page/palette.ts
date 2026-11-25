import type { TerminalPalette } from '../../../contracts/terminal-emulator';

// The colours and font a terminal screen draws with.
export interface TerminalLook {
  palette: TerminalPalette;
  fontFamily: string;
  fontSize: number;
}

// The font size a screen takes when `--wg-text-13` holds no number.
const FALLBACK_FONT_SIZE = 13;

// The screen's look from the core theme tokens on `style`, the computed style
// of the page's root: the transcript's background, the foreground, the accent
// as the cursor, its tint as the selection, and the mono font at `text-13`.
export function readTerminalLook(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): TerminalLook {
  const token = (name: string) => style.getPropertyValue(name).trim();
  const fontSize = Number.parseFloat(token('--wg-text-13'));
  return {
    palette: {
      background: token('--wg-transcript-background'),
      foreground: token('--wg-fg'),
      cursor: token('--wg-accent'),
      selection: token('--wg-accent-tint'),
    },
    fontFamily: token('--wg-font-mono'),
    fontSize: Number.isNaN(fontSize) ? FALLBACK_FONT_SIZE : fontSize,
  };
}
