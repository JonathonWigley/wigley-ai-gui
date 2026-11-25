import { describe, expect, it } from 'vitest';
import { readTerminalLook } from './palette';

const TOKENS: Record<string, string> = {
  '--wg-transcript-background': ' #111 ',
  '--wg-fg': '#eee',
  '--wg-accent': '#f80',
  '--wg-accent-tint': '#f803',
  '--wg-font-mono': 'Menlo',
  '--wg-text-13': '13px',
};

function styleOf(tokens: Record<string, string>) {
  return { getPropertyValue: (name: string) => tokens[name] ?? '' };
}

describe('readTerminalLook', () => {
  it('readTerminalLook_ReadsTheTokens', () => {
    expect(readTerminalLook(styleOf(TOKENS))).toEqual({
      palette: {
        background: '#111',
        foreground: '#eee',
        cursor: '#f80',
        selection: '#f803',
      },
      fontFamily: 'Menlo',
      fontSize: 13,
    });
  });

  it.each([
    { case: 'a size in px', token: '14px', fontSize: 14 },
    { case: 'no size', token: '', fontSize: 13 },
  ])('readTerminalLook_FontSize_$case', ({ token, fontSize }) => {
    const look = readTerminalLook(
      styleOf({ ...TOKENS, '--wg-text-13': token }),
    );

    expect(look.fontSize).toBe(fontSize);
  });
});
