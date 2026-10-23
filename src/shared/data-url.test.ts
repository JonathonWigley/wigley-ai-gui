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
        'wigley-data://forms/~3/layouts/a%20b/layout.js',
        '/d',
        posixPaths,
      ),
    ).toBe('/d/forms/layouts/a b/layout.js');
  });

  it('dataFilePath_ParentHost_ReturnsNull', () => {
    expect(dataFilePath('wigley-data://../~1/x', '/d', posixPaths)).toBe(null);
  });

  it('dataFilePath_DotHost_ReturnsNull', () => {
    expect(dataFilePath('wigley-data://./~1/x', '/d', posixPaths)).toBe(null);
  });

  it('dataFilePath_EncodedBackslash_ReturnsNull', () => {
    expect(
      dataFilePath('wigley-data://forms/~1/..%5C..%5C..%5Cx', '/d', posixPaths),
    ).toBe(null);
  });

  it('dataFilePath_EncodedSlash_ReturnsNull', () => {
    expect(
      dataFilePath('wigley-data://forms/~1/a%2f..%2f..%2fx', '/d', posixPaths),
    ).toBe(null);
  });

  it('dataFilePath_MissingRevision_ReturnsNull', () => {
    expect(
      dataFilePath('wigley-data://forms/layouts/x.js', '/d', posixPaths),
    ).toBe(null);
  });

  it('dataFilePath_OtherScheme_ReturnsNull', () => {
    expect(dataFilePath('file:///d/forms/~1/x.js', '/d', posixPaths)).toBe(
      null,
    );
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
