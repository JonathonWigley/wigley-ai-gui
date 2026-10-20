import { describe, expect, it } from 'vitest';
import {
  commonFolder,
  expandTilde,
  isInside,
  joinPath,
  normalizePath,
  parentFolder,
  tildePath,
} from './doc-paths';

const HOME = '/Users/u';

describe('doc-paths', () => {
  it('normalizePath_DotsAndDoubleSlashes_Folded', () => {
    expect(normalizePath('/a//b/./c/../d.md')).toBe('/a/b/d.md');
    expect(normalizePath('/..')).toBe('/');
    expect(normalizePath('/a/b/')).toBe('/a/b');
  });

  it('parentFolder_TopLevel_IsRoot', () => {
    expect(parentFolder('/a')).toBe('/');
    expect(parentFolder('/a/b/c.md')).toBe('/a/b');
  });

  it('joinPath_RelativeUp_Normalized', () => {
    expect(joinPath('/r/docs', '../b.md')).toBe('/r/b.md');
  });

  it('isInside_SamePrefixOtherFolder_False', () => {
    expect(isInside('/a/bc', '/a/b')).toBe(false);
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b/c', '/a/b')).toBe(true);
  });

  it('tildePath_HomeAndBelow_UseTilde', () => {
    expect(tildePath('/Users/u', HOME)).toBe('~');
    expect(tildePath('/Users/u/x', HOME)).toBe('~/x');
    expect(tildePath('/Users/uv/x', HOME)).toBe('/Users/uv/x');
  });

  it('expandTilde_OtherUser_Unchanged', () => {
    expect(expandTilde('~', HOME)).toBe('/Users/u');
    expect(expandTilde('~/x', HOME)).toBe('/Users/u/x');
    expect(expandTilde('~bob/x', HOME)).toBe('~bob/x');
    expect(expandTilde('x~', HOME)).toBe('x~');
  });

  it('commonFolder_SegmentPrefixOnly_TakesWholeSegments', () => {
    expect(commonFolder(['/a/bc/x.md', '/a/b/y.md'])).toBe('/a');
    expect(commonFolder(['/a/b/x.md'])).toBe('/a/b');
  });
});
