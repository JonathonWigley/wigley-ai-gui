import { describe, expect, it, vi } from 'vitest';
import type { LayoutOwner } from '../contracts/layouts';
import { layoutFilePath, layoutUrl } from './layout-url';
import { posixPaths } from './paths/posix-paths';
import { windowsPaths } from './paths/windows-paths';

// A default folder for every owner, so a user name that reaches it would
// join under the clone instead of `layoutsRoot`.
function anyOwnersDefault(owner: LayoutOwner): string {
  return `/clone/src/plugins/${owner}/layouts/default`;
}

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
        anyOwnersDefault,
      ),
    ).toBe('/c/layouts/forms/my look/parts/a b.js');
  });

  it('layoutFilePath_Default_JoinsTheOwnersDefaultFolder', () => {
    const defaultFolderOf = vi.fn(
      (_owner: LayoutOwner) => '/clone/src/plugins/forms/layouts/default',
    );
    expect(
      layoutFilePath(
        layoutUrl('forms', 'default', 4, 'parts/a b.css'),
        '/c/layouts',
        posixPaths,
        defaultFolderOf,
      ),
    ).toBe('/clone/src/plugins/forms/layouts/default/parts/a b.css');
    expect(defaultFolderOf.mock.calls).toEqual([['forms']]);
  });

  it.each([
    ['other scheme', 'wigley-data://forms/x/~1/layout.js', anyOwnersDefault],
    [
      'no revision segment',
      'wigley-layout://forms/x/layout.js',
      anyOwnersDefault,
    ],
    [
      'no path after the revision',
      'wigley-layout://forms/x/~1/',
      anyOwnersDefault,
    ],
    ['.. host', 'wigley-layout://../x/~1/layout.js', anyOwnersDefault],
    [
      'encoded .. name folded by the parser, leaving no revision',
      'wigley-layout://forms/%2E%2E/~1/layout.js',
      anyOwnersDefault,
    ],
    [
      'encoded / in the name',
      'wigley-layout://forms/a%2Fb/~1/layout.js',
      anyOwnersDefault,
    ],
    [
      'encoded / in a segment',
      'wigley-layout://forms/x/~1/a%2Fb.js',
      anyOwnersDefault,
    ],
    [
      'encoded \\ in a segment',
      'wigley-layout://forms/x/~1/..%5C..%5Cy',
      anyOwnersDefault,
    ],
    [
      '.. folded by the parser past the revision',
      'wigley-layout://forms/x/~1/../../y.js',
      anyOwnersDefault,
    ],
    ['malformed escape', 'wigley-layout://forms/x/~1/%', anyOwnersDefault],
    [
      'default whose owner has no default folder',
      'wigley-layout://forms/default/~1/layout.js',
      () => null,
    ],
    [
      'default with an encoded / in a segment',
      'wigley-layout://forms/default/~1/a%2Fb.js',
      anyOwnersDefault,
    ],
    [
      'default with an encoded \\ in a segment',
      'wigley-layout://forms/default/~1/..%5C..%5Cy',
      anyOwnersDefault,
    ],
  ])(
    'layoutFilePath_Refused_ReturnsNull: %s',
    (_case, url, defaultFolderOf) => {
      expect(
        layoutFilePath(url, '/c/layouts', posixPaths, defaultFolderOf),
      ).toBe(null);
    },
  );

  it('layoutFilePath_WindowsRoot_JoinsWithBackslash', () => {
    expect(
      layoutFilePath(
        'wigley-layout://forms/mine/~3/layout.css',
        'C:\\c\\layouts',
        windowsPaths,
        anyOwnersDefault,
      ),
    ).toBe('C:\\c\\layouts\\forms\\mine\\layout.css');
  });
});
