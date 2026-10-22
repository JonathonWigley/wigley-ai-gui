import { describe, expect, it } from 'vitest';
import type { Settings } from '../contracts/settings';
import type { Theme } from '../contracts/theme';
import { createThemeApplier, type ThemeApplier } from './theme';
import { overrideTransparency } from './transparency-override';

type Applied = Pick<Settings, 'transparency' | 'fonts'>;

// A ThemeApplier recording the settings each `apply` is handed.
function fakeApplier() {
  const applied: Applied[] = [];
  const applier: ThemeApplier = {
    apply: (_theme, settings) => {
      applied.push(settings);
    },
  };
  return { applier, applied };
}

const theme: Theme = {
  name: 't',
  colorScheme: 'dark',
  tokens: { 'material-chrome-bg': '#22222280' },
  reduced: { 'material-chrome-bg': '#222222' },
};

const fonts: Settings['fonts'] = { ui: 'Inter' };

describe('overrideTransparency', () => {
  it('passes the settings through while no override is in force', () => {
    const inner = fakeApplier();
    const { applier, transparency } = overrideTransparency(inner.applier);

    applier.apply(theme, { transparency: 'system', fonts });

    expect(inner.applied).toEqual([{ transparency: 'system', fonts }]);
    expect(transparency.overridden()).toBeNull();
  });

  it('applies nothing on an override before any theme is applied', () => {
    const inner = fakeApplier();
    const { transparency } = overrideTransparency(inner.applier);

    transparency.override('reduced');

    expect(inner.applied).toEqual([]);
    expect(transparency.overridden()).toBe('reduced');
  });

  it('re-applies the last theme at once with the override in the setting place', () => {
    const inner = fakeApplier();
    const { applier, transparency } = overrideTransparency(inner.applier);
    applier.apply(theme, { transparency: 'system', fonts });

    transparency.override('full');
    transparency.override('reduced');

    expect(inner.applied.slice(1)).toEqual([
      { transparency: 'full', fonts },
      { transparency: 'reduced', fonts },
    ]);
  });

  it('keeps the override over each later apply', () => {
    const inner = fakeApplier();
    const { applier, transparency } = overrideTransparency(inner.applier);
    transparency.override('full');

    applier.apply(theme, { transparency: 'reduced', fonts });

    expect(inner.applied).toEqual([{ transparency: 'full', fonts }]);
  });

  it('restores the last applied setting when the override is cleared', () => {
    const inner = fakeApplier();
    const { applier, transparency } = overrideTransparency(inner.applier);
    applier.apply(theme, { transparency: 'system', fonts });
    transparency.override('full');
    applier.apply(theme, { transparency: 'reduced', fonts });

    transparency.override(null);

    expect(inner.applied.at(-1)).toEqual({ transparency: 'reduced', fonts });
    expect(transparency.overridden()).toBeNull();
  });

  it('lets the OS preference re-apply only once the override is cleared over system', () => {
    const properties = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => {
          properties.set(name, value);
        },
      },
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement;
    let osChanged = () => {};
    const query = {
      matches: false,
      addEventListener: (_type: string, listener: () => void) => {
        osChanged = listener;
      },
    } as unknown as Pick<MediaQueryList, 'matches' | 'addEventListener'> & {
      matches: boolean;
    };
    const { applier, transparency } = overrideTransparency(
      createThemeApplier(root, query),
    );
    applier.apply(theme, { transparency: 'system', fonts });
    transparency.override('full');

    query.matches = true;
    osChanged();

    expect(root.dataset.transparency).toBe('full');

    transparency.override(null);

    expect(root.dataset.transparency).toBe('reduced');

    query.matches = false;
    osChanged();

    expect(root.dataset.transparency).toBe('full');
    expect(properties.get('--wg-material-chrome-bg')).toBe('#22222280');
  });
});
