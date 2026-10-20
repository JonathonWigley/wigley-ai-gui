import { describe, expect, it } from 'vitest';
import { dataFilePath, dataUrl } from './data-url';

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
      dataFilePath('wigley-data://forms/~3/layouts/a%20b/layout.js', '/d'),
    ).toBe('/d/forms/layouts/a b/layout.js');
  });

  it('dataFilePath_ParentEscape_ReturnsNull', () => {
    expect(dataFilePath('wigley-data://forms/~1/../sessions/x', '/d')).toBe(
      null,
    );
  });

  it('dataFilePath_EncodedDots_ReturnsNull', () => {
    expect(dataFilePath('wigley-data://forms/~1/%2e%2e/x', '/d')).toBe(null);
  });

  it('dataFilePath_EncodedSlash_ReturnsNull', () => {
    expect(dataFilePath('wigley-data://forms/~1/a%2f..%2f..%2fx', '/d')).toBe(
      null,
    );
  });

  it('dataFilePath_MissingRevision_ReturnsNull', () => {
    expect(dataFilePath('wigley-data://forms/layouts/x.js', '/d')).toBe(null);
  });

  it('dataFilePath_OtherScheme_ReturnsNull', () => {
    expect(dataFilePath('file:///d/forms/~1/x.js', '/d')).toBe(null);
  });
});
