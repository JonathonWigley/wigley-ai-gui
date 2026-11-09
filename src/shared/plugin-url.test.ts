import { describe, expect, it } from 'vitest';
import { pluginUrl } from './plugin-url';

describe('pluginUrl', () => {
  it.each([
    ['notes', 3, 'page.js', 'wigley-plugin://notes/~3/page.js'],
    ['notes', 12, 'lib/a b.js', 'wigley-plugin://notes/~12/lib/a%20b.js'],
  ])(
    'builds the wigley-plugin URL of a plugin file (%s, %i, %s)',
    (pluginId, revision, path, url) => {
      expect(pluginUrl(pluginId, revision, path)).toBe(url);
    },
  );
});
