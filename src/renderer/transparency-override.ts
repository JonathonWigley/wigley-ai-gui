import type { PageTransparency } from '../contracts/plugin';
import type { Settings } from '../contracts/settings';
import type { Theme } from '../contracts/theme';
import type { ThemeApplier } from './theme';

// `applier` with the page's transparency override over the `transparency`
// setting: the returned applier keeps the theme and settings each `apply` is
// handed and applies them with the override, while one is in force, in the
// setting's place; `transparency.override` sets the override and applies the
// last ones again at once. The override starts null.
export function overrideTransparency(applier: ThemeApplier): {
  applier: ThemeApplier;
  transparency: PageTransparency;
} {
  let override: 'full' | 'reduced' | null = null;
  let last: {
    theme: Theme;
    settings: Pick<Settings, 'transparency' | 'fonts'>;
  } | null = null;
  const applyLast = () => {
    if (last === null) {
      return;
    }
    applier.apply(last.theme, {
      transparency: override ?? last.settings.transparency,
      fonts: last.settings.fonts,
    });
  };
  return {
    applier: {
      apply(theme, settings) {
        last = { theme, settings };
        applyLast();
      },
    },
    transparency: {
      override(transparency) {
        override = transparency;
        applyLast();
      },
      overridden: () => override,
    },
  };
}
