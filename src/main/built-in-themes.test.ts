import { describe, expect, it } from 'vitest';
import { coreThemeTokens } from '../config/theme-tokens';
import { builtInThemes } from '../config/themes';
import { manifests } from '../plugins/manifests';
import { pluginThemeTokens } from '../shared/plugin-manifests';
import { resolveTheme } from './themes/theme-loader';
import { titleBarOverlayProblem } from './title-bar-overlay';

// The shipped themes are the subject here: a built-in the loader or the title
// bar overlay rejects stops the app at start.
const registry = {
  core: coreThemeTokens,
  plugins: pluginThemeTokens(coreThemeTokens, manifests),
};
const names = builtInThemes.map((json) => (json as { name: string }).name);

describe('built-in themes', () => {
  it.each(names)('%s resolves and the title bar overlay takes it', (name) => {
    expect(() =>
      resolveTheme(name, builtInThemes, [], registry, titleBarOverlayProblem),
    ).not.toThrow();
  });
});
