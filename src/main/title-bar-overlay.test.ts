import { describe, expect, it } from 'vitest';
import type { Theme } from '../contracts/theme';
import {
  checkTitleBarOverlay,
  titleBarOverlayOf,
  windowBackgroundOf,
} from './title-bar-overlay';

function theme(
  tokens: Record<string, string>,
  reduced: Record<string, string> = {},
): Theme {
  return { name: 'test', colorScheme: 'dark', tokens, reduced };
}

const BASE = {
  'window-background': '#000000',
  'material-chrome-bg': '#204060',
  'fg-secondary': '#a6adc8',
  'toolbar-height': '40px',
};

describe('titleBarOverlayOf', () => {
  it('takes the bar material, secondary text colour and toolbar height', () => {
    expect(titleBarOverlayOf(theme(BASE), false)).toEqual({
      color: '#204060',
      symbolColor: '#a6adc8',
      height: 40,
    });
  });

  it('paints a translucent bar material over the window background', () => {
    const overlay = titleBarOverlayOf(
      theme({
        ...BASE,
        'window-background': '#ffffff',
        'material-chrome-bg': '#00000080',
      }),
      false,
    );

    // 0x80 / 255 of black over white leaves 0x7f of each channel.
    expect(overlay.color).toBe('#7f7f7f');
  });

  it('paints a translucent symbol colour over the overlay colour', () => {
    const overlay = titleBarOverlayOf(
      theme({ ...BASE, 'fg-secondary': '#ffffff00' }),
      false,
    );

    expect(overlay.symbolColor).toBe('#204060');
  });

  it('takes the reduced values while transparency is reduced', () => {
    const reduced = theme(
      { ...BASE, 'material-chrome-bg': '#00000080' },
      { 'material-chrome-bg': '#112233', 'toolbar-height': '30px' },
    );

    expect(titleBarOverlayOf(reduced, true)).toMatchObject({
      color: '#112233',
      height: 30,
    });
    expect(titleBarOverlayOf(reduced, false).height).toBe(40);
  });

  it('follows a chain of aliases, plugin tokens included', () => {
    const overlay = titleBarOverlayOf(
      theme({
        ...BASE,
        'material-chrome-bg': 'var(--wg-forms-bar_tone)',
        'forms.bar_tone': 'var(--wg-base-colour)',
        'base-colour': '#1e1e2e',
      }),
      false,
    );

    expect(overlay.color).toBe('#1e1e2e');
  });

  it('follows an aliased toolbar height', () => {
    const overlay = titleBarOverlayOf(
      theme({ ...BASE, 'toolbar-height': 'var(--wg-row)', row: '36px' }),
      false,
    );

    expect(overlay.height).toBe(36);
  });

  it('converts a rem toolbar height against a 16px root', () => {
    const overlay = titleBarOverlayOf(
      theme({ ...BASE, 'toolbar-height': '2.5rem' }),
      false,
    );

    expect(overlay.height).toBe(40);
  });

  it('rejects a toolbar height that hangs off the element or the window', () => {
    expect(() =>
      titleBarOverlayOf(theme({ ...BASE, 'toolbar-height': '2.5em' }), false),
    ).toThrow(
      'token "toolbar-height": "2.5em" is not a px or rem length, which the title bar overlay needs',
    );
  });

  it('rejects a colour it cannot paint', () => {
    expect(() =>
      titleBarOverlayOf(
        theme({ ...BASE, 'material-chrome-bg': 'rgb(1 2 3)' }),
        false,
      ),
    ).toThrow('token "material-chrome-bg": "rgb(1 2 3)" is not a #rrggbb');
  });
});

describe('checkTitleBarOverlay', () => {
  it('rejects a bad value set only under reduced transparency', () => {
    const reducedOnly = theme(BASE, { 'toolbar-height': '10%' });

    expect(() => checkTitleBarOverlay(reducedOnly)).toThrow(
      'token "toolbar-height": "10%"',
    );
  });
});

describe('windowBackgroundOf', () => {
  it('takes the reduced window background while transparency is reduced', () => {
    const reduced = theme(BASE, { 'window-background': '#101010' });

    expect(windowBackgroundOf(reduced, true)).toBe('#101010');
    expect(windowBackgroundOf(reduced, false)).toBe('#000000');
  });
});
