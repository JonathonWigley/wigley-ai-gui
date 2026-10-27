import { describe, expect, it } from 'vitest';
import { layoutFilePath, layoutUrl } from './layout-url';
import { posixPaths } from './paths/posix-paths';
import { windowsPaths } from './paths/windows-paths';

describe('layoutUrl', () => {
  it('layoutUrl_EncodesSegmentsAndPutsRevisionAfterName', () => {
    expect(layoutUrl('forms', 'my look', 3, 'parts/a b.js')).toBe(
      'wigley-layout://forms/my%20look/~3/parts/a%20b.js',
    );
  });
});

describe('layoutFilePath', () => {
  it('layoutFilePath_RoundTripsLayoutUrl', () => {
    expect(
      layoutFilePath(
        layoutUrl('forms', 'my look', 3, 'parts/a b.js'),
        '/c/layouts',
        posixPaths,
      ),
    ).toBe('/c/layouts/forms/my look/parts/a b.js');
  });

  it.each([
    ['other scheme', 'wigley-data://forms/x/~1/layout.js'],
    ['no revision segment', 'wigley-layout://forms/x/layout.js'],
    ['no path after the revision', 'wigley-layout://forms/x/~1/'],
    ['.. host', 'wigley-layout://../x/~1/layout.js'],
    ['.. name', 'wigley-layout://forms/%2E%2E/~1/layout.js'],
    ['encoded / in the name', 'wigley-layout://forms/a%2Fb/~1/layout.js'],
    ['encoded / in a segment', 'wigley-layout://forms/x/~1/a%2F..%2F..%2Fy'],
    ['encoded \\ in a segment', 'wigley-layout://forms/x/~1/..%5C..%5Cy'],
    ['.. climbing out of the folder', 'wigley-layout://forms/x/~1/../../y.js'],
    ['malformed escape', 'wigley-layout://forms/x/~1/%'],
  ])('layoutFilePath_Refused_ReturnsNull: %s', (_case, url) => {
    expect(layoutFilePath(url, '/c/layouts', posixPaths)).toBe(null);
  });

  it('layoutFilePath_WindowsRoot_JoinsWithBackslash', () => {
    expect(
      layoutFilePath(
        'wigley-layout://forms/mine/~3/layout.css',
        'C:\\c\\layouts',
        windowsPaths,
      ),
    ).toBe('C:\\c\\layouts\\forms\\mine\\layout.css');
  });
});
