import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import {
  type Completion,
  completeTyped,
  completionQuery,
  completions,
} from './path-completion';

const HOME = '/Users/u';

function texts(matches: readonly Completion[]): string[] {
  return matches.map((match) => match.text);
}

function file(name: string): Completion {
  return { name, isFolder: false, text: name };
}

describe('completionQuery', () => {
  it('completionQuery_TildeFolder_Expanded', () => {
    expect(completionQuery('~/dev/wi', HOME, posixPaths)).toEqual({
      folder: '/Users/u/dev',
      prefix: 'wi',
    });
    expect(completionQuery('/', HOME, posixPaths)).toEqual({
      folder: '/',
      prefix: '',
    });
    expect(completionQuery('abc', HOME, posixPaths)).toEqual({
      folder: '/Users/u',
      prefix: 'abc',
    });
  });
});

describe('completions', () => {
  it('completions_FoldersFirstThenFiles_ByName', () => {
    const entries = [
      { name: 'b.md', isFolder: false },
      { name: 'ab', isFolder: true },
      { name: 'abc.md', isFolder: false },
      { name: 'aa', isFolder: true },
    ];

    expect(texts(completions(entries, 'a', posixPaths))).toEqual([
      'aa/',
      'ab/',
      'abc.md',
    ]);
  });

  it('completions_HiddenOnlyForDotPrefix', () => {
    const entries = [
      { name: '.claude', isFolder: true },
      { name: 'a.md', isFolder: false },
    ];

    expect(texts(completions(entries, '', posixPaths))).toEqual(['a.md']);
    expect(texts(completions(entries, '.', posixPaths))).toEqual(['.claude/']);
  });

  it('completions_IgnoresCase_KeepsNameCase', () => {
    expect(
      texts(
        completions([{ name: 'CLAUDE.md', isFolder: false }], 'cl', posixPaths),
      ),
    ).toEqual(['CLAUDE.md']);
  });

  it('completions_NamesDifferingInCase_AllKeptByNameThenCodeUnit', () => {
    const entries = [
      { name: 'notes.md', isFolder: false },
      { name: 'Nb.md', isFolder: false },
      { name: 'Notes.md', isFolder: false },
    ];

    expect(texts(completions(entries, 'N', posixPaths))).toEqual([
      'Nb.md',
      'Notes.md',
      'notes.md',
    ]);
  });

  it('completions_FolderAndFileSharingPrefix_TabKeepsTyped', () => {
    const entries = [
      { name: 'ab', isFolder: true },
      { name: 'abc.md', isFolder: false },
      { name: 'b.md', isFolder: false },
    ];

    const matches = completions(entries, 'ab', posixPaths);

    expect(texts(matches)).toEqual(['ab/', 'abc.md']);
    expect(completeTyped('ab', matches, posixPaths)).toBe('ab');
  });
});

describe('completeTyped', () => {
  it('completeTyped_SingleMatch_CompletesWithSlash', () => {
    const matches = [
      { name: 'wigley-ai-gui', isFolder: true, text: 'wigley-ai-gui/' },
    ];

    expect(completeTyped('~/dev/wi', matches, posixPaths)).toBe(
      '~/dev/wigley-ai-gui/',
    );
  });

  it('completeTyped_SeveralMatches_LongestCommonPrefix', () => {
    expect(
      completeTyped('~/a', [file('abc.md'), file('abd.md')], posixPaths),
    ).toBe('~/ab');
  });

  it('completeTyped_NoLongerPrefix_Unchanged', () => {
    expect(
      completeTyped('~/ab', [file('abc.md'), file('abd.md')], posixPaths),
    ).toBe('~/ab');
    expect(completeTyped('~/ab', [], posixPaths)).toBe('~/ab');
  });

  it('completeTyped_SingleMatchOtherCase_TakesNameCase', () => {
    const matches = completions(
      [{ name: 'CLAUDE.md', isFolder: false }],
      'cl',
      posixPaths,
    );

    expect(completeTyped('~/.claude/cl', matches, posixPaths)).toBe(
      '~/.claude/CLAUDE.md',
    );
  });

  it('completeTyped_SeveralMatchesOtherCase_ExtendsInNameCase', () => {
    const matches = completions(
      [
        { name: 'CLAUDE.md', isFolder: false },
        { name: 'CLAUDE.local.md', isFolder: false },
      ],
      'cl',
      posixPaths,
    );

    expect(completeTyped('~/cl', matches, posixPaths)).toBe('~/CLAUDE.');
  });

  it('completeTyped_MatchesDifferingOnlyInCase_Unchanged', () => {
    const matches = completions(
      [
        { name: 'Notes.md', isFolder: false },
        { name: 'notes.md', isFolder: false },
      ],
      'n',
      posixPaths,
    );

    expect(matches).toHaveLength(2);
    expect(completeTyped('~/n', matches, posixPaths)).toBe('~/n');
  });

  it('completeTyped_MixedCaseFolder_CompletesWithSlash', () => {
    const matches = completions(
      [{ name: 'MyDocs', isFolder: true }],
      'myd',
      posixPaths,
    );

    expect(completeTyped('~/myd', matches, posixPaths)).toBe('~/MyDocs/');
  });
});

describe('path completion on Windows', () => {
  const WINDOWS_HOME = 'C:\\Users\\u';

  it('completionQuery_WindowsTildeSlash_Expanded', () => {
    expect(completionQuery('~/.claude/', WINDOWS_HOME, windowsPaths)).toEqual({
      folder: 'C:\\Users\\u\\.claude',
      prefix: '',
    });
    expect(
      completionQuery('~\\.claude\\ru', WINDOWS_HOME, windowsPaths),
    ).toEqual({ folder: 'C:\\Users\\u\\.claude', prefix: 'ru' });
    expect(completionQuery('C:/', WINDOWS_HOME, windowsPaths)).toEqual({
      folder: 'C:\\',
      prefix: '',
    });
  });

  it('completions_WindowsFolder_TrailingBackslash', () => {
    const matches = completions(
      [{ name: 'rules', isFolder: true }],
      'r',
      windowsPaths,
    );

    expect(texts(matches)).toEqual(['rules\\']);
  });

  it('completeTyped_WindowsMixedSeparators_KeepsTypedFolder', () => {
    const rules = { name: 'rules', isFolder: true, text: 'rules\\' };

    expect(completeTyped('~/.claude/ru', [rules], windowsPaths)).toBe(
      '~/.claude/rules\\',
    );
    expect(
      completeTyped('~\\.claude\\rules\\n', [file('neat.md')], windowsPaths),
    ).toBe('~\\.claude\\rules\\neat.md');
  });

  it('completions_WindowsIgnoresCase_KeepsNameCase', () => {
    expect(
      texts(
        completions(
          [{ name: 'CLAUDE.md', isFolder: false }],
          'cl',
          windowsPaths,
        ),
      ),
    ).toEqual(['CLAUDE.md']);
  });

  it('completeTyped_WindowsOtherCase_TakesNameCase', () => {
    const matches = completions(
      [{ name: 'CLAUDE.md', isFolder: false }],
      'cl',
      windowsPaths,
    );

    expect(completeTyped('~/.claude/cl', matches, windowsPaths)).toBe(
      '~/.claude/CLAUDE.md',
    );
  });

  it('completeTyped_WindowsMixedCaseFolder_CompletesWithBackslash', () => {
    const matches = completions(
      [{ name: 'MyDocs', isFolder: true }],
      'myd',
      windowsPaths,
    );

    expect(completeTyped('~\\myd', matches, windowsPaths)).toBe('~\\MyDocs\\');
  });
});
