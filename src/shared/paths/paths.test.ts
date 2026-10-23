import { describe, expect, it } from 'vitest';
import type { Paths } from '../../contracts/paths';
import { posixPaths } from './posix-paths';
import { windowsPaths } from './windows-paths';

type Method = Exclude<keyof Paths, 'separator'>;
// The arguments one call takes and the value it returns.
type Case = [args: unknown[], expected: unknown];
// One method's cases on each adapter.
type Row = [method: Method, posix: Case[], windows: Case[]];

const ROWS: Row[] = [
  [
    'isAbsolute',
    [
      [['/a'], true],
      [['a/b'], false],
      [['~/a'], false],
    ],
    [
      [['C:\\a'], true],
      [['c:/a'], true],
      [['\\\\srv\\share\\a'], true],
      [['C:a'], false],
      [['\\a'], false],
      [['a\\b'], false],
    ],
  ],
  [
    'normalize',
    [
      [['/a//b/./c/../d/'], '/a/b/d'],
      [['/..'], '/'],
      [['a/./b//c/'], 'a/b/c'],
      [['../a/../b'], '../b'],
    ],
    [
      [['C:/a//b\\.\\c\\..\\d\\'], 'C:\\a\\b\\d'],
      [['C:\\..'], 'C:\\'],
      [['\\\\srv\\share\\a\\..\\..'], '\\\\srv\\share\\'],
      [['/selftest//x'], '\\selftest\\x'],
      [['..\\a'], '..\\a'],
      [['C:..\\x'], 'C:..\\x'],
      [['C:a\\..\\..\\x'], 'C:..\\x'],
      [['\\..\\x'], '\\x'],
      [['\\a\\..\\..\\x'], '\\x'],
    ],
  ],
  [
    'join',
    [
      [['/a', 'b/c', '../d'], '/a/b/d'],
      [['/r/docs', '/a/b.md'], '/r/docs/a/b.md'],
      [['', 'a'], 'a'],
    ],
    [
      [['C:\\a', 'b/c', '..\\d'], 'C:\\a\\b\\d'],
      [['C:\\r\\docs', '/a/b.md'], 'C:\\r\\docs\\a\\b.md'],
      [['', 'a'], 'a'],
      [['C:', '..', 'x'], 'C:..\\x'],
    ],
  ],
  [
    'parent',
    [
      [['/a/b/c.md'], '/a/b'],
      [['/a'], '/'],
      [['/'], '/'],
      [['a'], ''],
    ],
    [
      [['C:\\a\\b\\c.md'], 'C:\\a\\b'],
      [['C:\\a'], 'C:\\'],
      [['C:\\'], 'C:\\'],
      [['a'], ''],
    ],
  ],
  [
    'base',
    [
      [['/a/b/c.md'], 'c.md'],
      [['/a/b/'], 'b'],
      [['/'], ''],
      [['/selftest/chat-selftest'], 'chat-selftest'],
    ],
    [
      [['C:\\a\\b\\c.md'], 'c.md'],
      [['C:\\a\\b\\'], 'b'],
      [['C:\\'], ''],
      [['/selftest/chat-selftest'], 'chat-selftest'],
    ],
  ],
  [
    'samePath',
    [
      [['/a/b', '/a/b/'], true],
      [['/A', '/a'], false],
    ],
    [
      [['C:\\Users\\Jo', 'c:/users/jo/'], true],
      [['C:\\a', 'C:\\b'], false],
    ],
  ],
  [
    'isInside',
    [
      [['/a/b', '/a'], true],
      [['/ab', '/a'], false],
      [['/x', '/'], true],
    ],
    [
      [['C:\\A\\b', 'c:\\a'], true],
      [['C:\\ab', 'C:\\a'], false],
      [['D:\\a', 'C:\\'], false],
    ],
  ],
  [
    'segmentsBelow',
    [
      [
        ['/a/b/c', '/a'],
        ['b', 'c'],
      ],
      [['/a', '/a'], []],
      [['/b', '/a'], null],
    ],
    [
      [
        ['C:\\a\\B\\c', 'c:\\a'],
        ['B', 'c'],
      ],
      [['C:\\A', 'c:\\a\\'], []],
      [['C:\\b', 'C:\\a'], null],
    ],
  ],
  [
    'commonFolder',
    [
      [[['/a/b/x.md', '/a/c/y.md']], '/a'],
      [[['/x.md', '/a/y.md']], '/'],
      [[['/a/x.md', 'b/y.md']], null],
    ],
    [
      [[['C:\\a\\b\\x.md', 'C:\\a\\c\\y.md']], 'C:\\a'],
      [[['C:\\a\\x.md', 'D:\\a\\y.md']], null],
    ],
  ],
  [
    'tilde',
    [
      [['/Users/jo/.claude/CLAUDE.md', '/Users/jo'], '~/.claude/CLAUDE.md'],
      [['/Users/jo', '/Users/jo'], '~'],
      [['/Users/joe/x', '/Users/jo'], '/Users/joe/x'],
    ],
    [
      [
        ['c:\\users\\jo\\.claude\\CLAUDE.md', 'C:\\Users\\jo'],
        '~\\.claude\\CLAUDE.md',
      ],
      [['C:\\_root\\dev', 'C:\\Users\\jo'], 'C:\\_root\\dev'],
    ],
  ],
  [
    'expandTilde',
    [
      [['~/x', '/Users/jo'], '/Users/jo/x'],
      [['~', '/Users/jo'], '/Users/jo'],
      [['~jo/x', '/Users/jo'], '~jo/x'],
      [['x', '/Users/jo'], 'x'],
    ],
    [
      [['~/x', 'C:\\Users\\jo'], 'C:\\Users\\jo\\x'],
      [['~\\x', 'C:\\Users\\jo'], 'C:\\Users\\jo\\x'],
      [['~', 'C:\\Users\\jo'], 'C:\\Users\\jo'],
      [['~jo\\x', 'C:\\Users\\jo'], '~jo\\x'],
      [['x', 'C:\\Users\\jo'], 'x'],
    ],
  ],
];

function call(paths: Paths, method: Method, args: unknown[]): unknown {
  return (paths[method] as (...values: unknown[]) => unknown)(...args);
}

describe.each([
  ['posix', posixPaths, '/', ROWS.map(([method, posix]) => [method, posix])],
  [
    'windows',
    windowsPaths,
    '\\',
    ROWS.map(([method, , windows]) => [method, windows]),
  ],
] as [string, Paths, string, [Method, Case[]][]][])(
  '%s paths',
  (_name, paths, separator, rows) => {
    const cases = rows.flatMap(([method, methodCases]) =>
      methodCases.map(([args, expected]) => ({ method, args, expected })),
    );

    it.each(cases)(
      '$method($args) → $expected',
      ({ method, args, expected }) => {
        expect(call(paths, method, args)).toEqual(expected);
      },
    );

    it('separator_IsTheOsSeparator', () => {
      expect(paths.separator).toBe(separator);
    });

    it('commonFolder_EmptyList_Throws', () => {
      expect(() => paths.commonFolder([])).toThrow();
    });
  },
);

describe('posixPaths', () => {
  const HOME = '/Users/u';

  it('normalize_DotsAndDoubleSlashes_Folded', () => {
    expect(posixPaths.normalize('/a//b/./c/../d.md')).toBe('/a/b/d.md');
    expect(posixPaths.normalize('/a/b/')).toBe('/a/b');
  });

  it('join_RelativeUp_Normalized', () => {
    expect(posixPaths.join('/r/docs', '../b.md')).toBe('/r/b.md');
  });

  it('isInside_SamePrefixOtherFolder_False', () => {
    expect(posixPaths.isInside('/a/bc', '/a/b')).toBe(false);
    expect(posixPaths.isInside('/a/b', '/a/b')).toBe(true);
    expect(posixPaths.isInside('/a/b/c', '/a/b')).toBe(true);
  });

  it('tilde_HomeAndBelow_UseTilde', () => {
    expect(posixPaths.tilde('/Users/u', HOME)).toBe('~');
    expect(posixPaths.tilde('/Users/u/x', HOME)).toBe('~/x');
    expect(posixPaths.tilde('/Users/uv/x', HOME)).toBe('/Users/uv/x');
  });

  it('tilde_UnknownHome_PathNormalized', () => {
    expect(posixPaths.tilde('a//b', '')).toBe('a/b');
  });

  it('expandTilde_OtherUser_Unchanged', () => {
    expect(posixPaths.expandTilde('~', HOME)).toBe('/Users/u');
    expect(posixPaths.expandTilde('~/x', HOME)).toBe('/Users/u/x');
    expect(posixPaths.expandTilde('~bob/x', HOME)).toBe('~bob/x');
    expect(posixPaths.expandTilde('x~', HOME)).toBe('x~');
  });

  it('expandTilde_TildeSlash_JoinsHome', () => {
    expect(posixPaths.expandTilde('~/.local/bin/claude', HOME)).toBe(
      '/Users/u/.local/bin/claude',
    );
  });

  it('expandTilde_OtherValues_ReturnedAsTheyStand', () => {
    for (const value of ['/abs/x', 'rel/x', '~other/x']) {
      expect(posixPaths.expandTilde(value, HOME)).toBe(value);
    }
    expect(posixPaths.expandTilde('~', HOME)).toBe(HOME);
  });

  it('commonFolder_SegmentPrefixOnly_TakesWholeSegments', () => {
    expect(posixPaths.commonFolder(['/a/bc/x.md', '/a/b/y.md'])).toBe('/a');
    expect(posixPaths.commonFolder(['/a/b/x.md'])).toBe('/a/b');
  });

  it('expandTilde_BackslashAfterTilde_Unchanged', () => {
    expect(posixPaths.expandTilde('~\\x', HOME)).toBe('~\\x');
  });
});

describe('windowsPaths', () => {
  it('normalize_UncShareAlone_EndsWithSeparator', () => {
    expect(windowsPaths.normalize('//srv/share')).toBe('\\\\srv\\share\\');
  });

  it('normalize_DriveLetter_KeepsItsCase', () => {
    expect(windowsPaths.normalize('c:/a')).toBe('c:\\a');
  });

  it('parent_UncShareRoot_IsItsOwnParent', () => {
    expect(windowsPaths.parent('\\\\srv\\share\\a')).toBe('\\\\srv\\share\\');
    expect(windowsPaths.parent('\\\\srv\\share\\')).toBe('\\\\srv\\share\\');
  });

  it('isInside_OtherShare_False', () => {
    expect(windowsPaths.isInside('\\\\srv\\other\\a', '\\\\srv\\share')).toBe(
      false,
    );
  });

  it('samePath_DriveRelativeAndRooted_Differ', () => {
    expect(windowsPaths.samePath('C:a', 'C:\\a')).toBe(false);
    expect(windowsPaths.samePath('\\a', 'C:\\a')).toBe(false);
  });

  it('tilde_HomeInOtherCase_KeepsTheRestAsGiven', () => {
    expect(
      windowsPaths.tilde('C:\\USERS\\JO\\Docs\\A.md', 'c:\\users\\jo'),
    ).toBe('~\\Docs\\A.md');
    expect(windowsPaths.tilde('c:/users/jo/', 'C:\\Users\\jo')).toBe('~');
  });

  it('commonFolder_DriveLettersInOtherCase_ShareTheRoot', () => {
    expect(windowsPaths.commonFolder(['C:\\a\\x.md', 'c:\\a\\y.md'])).toBe(
      'C:\\a',
    );
  });
});
