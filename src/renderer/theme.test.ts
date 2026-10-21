import { describe, expect, it } from 'vitest';
import type { Settings } from '../contracts/settings';
import type { Theme } from '../contracts/theme';
import { createThemeApplier } from './theme';

function fakeRoot() {
  const properties = new Map<string, string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => {
        properties.set(name, value);
      },
    },
    dataset: {} as Record<string, string>,
  };
  return { root: root as unknown as HTMLElement, properties };
}

type ReducedTransparency = Pick<MediaQueryList, 'matches' | 'addEventListener'>;

// The OS preference, keeping the listener its `change` would fire.
function fakeQuery(matches: boolean) {
  const query = {
    matches,
    listener: null as (() => void) | null,
    addEventListener: (_type: string, listener: () => void) => {
      query.listener = listener;
    },
  };
  return query as typeof query & ReducedTransparency;
}

const theme: Theme = {
  name: 't',
  colorScheme: 'dark',
  tokens: {
    fg: '#111111',
    'material-chrome-bg': '#22222280',
    'forms.origin-caused': 'var(--wg-fg)',
    'font-ui': 'System',
    'font-mono': 'Mono',
    'text-ui': '13px',
    'text-mono': '13px',
  },
  reduced: { 'material-chrome-bg': '#222222' },
};

function settings(
  transparency: Settings['transparency'],
  fonts: Settings['fonts'] = {},
): Pick<Settings, 'transparency' | 'fonts'> {
  return { transparency, fonts };
}

describe('createThemeApplier', () => {
  it('writes every token as its variable', () => {
    const { root, properties } = fakeRoot();

    createThemeApplier(root, fakeQuery(false)).apply(theme, settings('full'));

    expect(properties.get('--wg-fg')).toBe('#111111');
    expect(properties.get('--wg-forms-origin-caused')).toBe('var(--wg-fg)');
    expect(properties.get('color-scheme')).toBe('dark');
  });

  it('writes the reduced overrides when transparency is reduced', () => {
    const reduced = fakeRoot();
    createThemeApplier(reduced.root, fakeQuery(false)).apply(
      theme,
      settings('reduced'),
    );

    expect(reduced.properties.get('--wg-material-chrome-bg')).toBe('#222222');
    expect(reduced.root.dataset.transparency).toBe('reduced');

    const full = fakeRoot();
    createThemeApplier(full.root, fakeQuery(true)).apply(
      theme,
      settings('full'),
    );

    expect(full.properties.get('--wg-material-chrome-bg')).toBe('#22222280');
    expect(full.root.dataset.transparency).toBe('full');
  });

  it('follows the OS under system', () => {
    const { root, properties } = fakeRoot();
    const query = fakeQuery(true);
    createThemeApplier(root, query).apply(theme, settings('system'));

    expect(properties.get('--wg-material-chrome-bg')).toBe('#222222');

    query.matches = false;
    query.listener?.();

    expect(properties.get('--wg-material-chrome-bg')).toBe('#22222280');
    expect(root.dataset.transparency).toBe('full');
  });

  it('overrides the font tokens with the font settings and restores them', () => {
    const { root, properties } = fakeRoot();
    const applier = createThemeApplier(root, fakeQuery(false));

    applier.apply(theme, settings('full', { ui: 'Inter', uiSize: 15 }));

    expect(properties.get('--wg-font-ui')).toBe('Inter');
    expect(properties.get('--wg-text-ui')).toBe('15px');
    expect(properties.get('--wg-font-mono')).toBe('Mono');

    applier.apply(theme, settings('full'));

    expect(properties.get('--wg-font-ui')).toBe('System');
    expect(properties.get('--wg-text-ui')).toBe('13px');
  });
});
