import { describe, expect, it } from 'vitest';
import { posixPaths } from './paths/posix-paths';
import { windowsPaths } from './paths/windows-paths';
import { pluginFilePath, pluginUrl } from './plugin-url';

describe('pluginUrl', () => {
  it.each([
    ['notes', 3, 'page.js', 'wigley-plugin://notes/~3/page.js'],
    ['notes', 12, 'lib/a b.js', 'wigley-plugin://notes/~12/lib/a%20b.js'],
    ['my-tool', 3, 'lib/a b.js', 'wigley-plugin://my-tool/~3/lib/a%20b.js'],
  ])(
    'builds the wigley-plugin URL of a plugin file (%s, %i, %s)',
    (pluginId, revision, path, url) => {
      expect(pluginUrl(pluginId, revision, path)).toBe(url);
    },
  );
});

describe('pluginFilePath', () => {
  // Breaks if the revision is dropped from the file path: main imports and
  // the page would then read different copies.
  it('pluginFilePath_RoundTripsPluginUrl', () => {
    expect(
      pluginFilePath(pluginUrl('my-tool', 12, 'lib/a b.js'), '/c', posixPaths),
    ).toBe('/c/my-tool/12/lib/a b.js');
  });

  it.each([
    ['other scheme', 'wigley-data://my-tool/~1/page.js'],
    ['no revision segment', 'wigley-plugin://my-tool/page.js'],
    ['a revision without ~', 'wigley-plugin://my-tool/1/page.js'],
    ['an empty path', 'wigley-plugin://my-tool/~1/'],
    ['an encoded / in a segment', 'wigley-plugin://my-tool/~1/lib%2Fa.js'],
    ['a .. climb', 'wigley-plugin://my-tool/~1/../../x/page.js'],
  ])('pluginFilePath_RefusesMalformed: %s', (_case, url) => {
    expect(pluginFilePath(url, '/c', posixPaths)).toBe(null);
  });

  it('pluginFilePath_WindowsRoot_JoinsWithBackslash', () => {
    expect(
      pluginFilePath(
        'wigley-plugin://my-tool/~3/lib/a%20b.js',
        'C:\\c',
        windowsPaths,
      ),
    ).toBe('C:\\c\\my-tool\\3\\lib\\a b.js');
  });
});
