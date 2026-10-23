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

  it('completions_CaseSensitive', () => {
    expect(
      completions([{ name: 'Readme.md', isFolder: false }], 'r', posixPaths),
    ).toEqual([]);
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
});
