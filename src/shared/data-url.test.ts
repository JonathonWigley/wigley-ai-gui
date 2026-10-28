import { describe, expect, it } from 'vitest';
import { dataFilePath, dataUrl } from './data-url';
import { posixPaths } from './paths/posix-paths';
import { windowsPaths } from './paths/windows-paths';

describe('dataUrl', () => {
  it('dataUrl_EncodesSegmentsAndPutsRevisionInPath', () => {
    expect(dataUrl('forms', 3, 'layouts/a b/layout.js')).toBe(
      'wigley-data://forms/~3/layouts/a%20b/layout.js',
    );
  });
});

describe('dataFilePath', () => {
  it('dataFilePath_RoundTripsDataUrl', () => {
    expect(
      dataFilePath(
        dataUrl('forms', 3, 'layouts/a b/layout.js'),
        '/d',
        posixPaths,
      ),
    ).toBe('/d/forms/layouts/a b/layout.js');
  });

  it.each([
    ['.. host', 'wigley-data://../~1/x'],
    ['. host', 'wigley-data://./~1/x'],
    ['encoded \\ in a segment', 'wigley-data://forms/~1/..%5C..%5C..%5Cx'],
    ['encoded / in a segment', 'wigley-data://forms/~1/layouts%2Fx.js'],
    ['no revision segment', 'wigley-data://forms/layouts/x.js'],
    ['no path after the revision', 'wigley-data://forms/~1/'],
    ['malformed escape', 'wigley-data://forms/~1/%'],
    ['other scheme', 'file:///d/forms/~1/x.js'],
  ])('dataFilePath_Refused_ReturnsNull: %s', (_case, url) => {
    expect(dataFilePath(url, '/d', posixPaths)).toBe(null);
  });

  it('dataFilePath_WindowsRoot_JoinsWithBackslash', () => {
    expect(
      dataFilePath(
        'wigley-data://forms/~3/layouts/a%20b/layout.js',
        'C:\\d',
        windowsPaths,
      ),
    ).toBe('C:\\d\\forms\\layouts\\a b\\layout.js');
  });
});
