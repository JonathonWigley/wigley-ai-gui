import { describe, expect, it } from 'vitest';
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
    expect(completionQuery('~/dev/wi', HOME)).toEqual({
      folder: '/Users/u/dev',
      prefix: 'wi',
    });
    expect(completionQuery('/', HOME)).toEqual({ folder: '/', prefix: '' });
    expect(completionQuery('abc', HOME)).toEqual({
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

    expect(texts(completions(entries, 'a'))).toEqual(['aa/', 'ab/', 'abc.md']);
  });

  it('completions_HiddenOnlyForDotPrefix', () => {
    const entries = [
      { name: '.claude', isFolder: true },
      { name: 'a.md', isFolder: false },
    ];

    expect(texts(completions(entries, ''))).toEqual(['a.md']);
    expect(texts(completions(entries, '.'))).toEqual(['.claude/']);
  });

  it('completions_CaseSensitive', () => {
    expect(completions([{ name: 'Readme.md', isFolder: false }], 'r')).toEqual(
      [],
    );
  });

  it('completions_FolderAndFileSharingPrefix_TabKeepsTyped', () => {
    const entries = [
      { name: 'ab', isFolder: true },
      { name: 'abc.md', isFolder: false },
      { name: 'b.md', isFolder: false },
    ];

    const matches = completions(entries, 'ab');

    expect(texts(matches)).toEqual(['ab/', 'abc.md']);
    expect(completeTyped('ab', matches)).toBe('ab');
  });
});

describe('completeTyped', () => {
  it('completeTyped_SingleMatch_CompletesWithSlash', () => {
    const matches = [
      { name: 'wigley-ai-gui', isFolder: true, text: 'wigley-ai-gui/' },
    ];

    expect(completeTyped('~/dev/wi', matches)).toBe('~/dev/wigley-ai-gui/');
  });

  it('completeTyped_SeveralMatches_LongestCommonPrefix', () => {
    expect(completeTyped('~/a', [file('abc.md'), file('abd.md')])).toBe('~/ab');
  });

  it('completeTyped_NoLongerPrefix_Unchanged', () => {
    expect(completeTyped('~/ab', [file('abc.md'), file('abd.md')])).toBe(
      '~/ab',
    );
    expect(completeTyped('~/ab', [])).toBe('~/ab');
  });
});
