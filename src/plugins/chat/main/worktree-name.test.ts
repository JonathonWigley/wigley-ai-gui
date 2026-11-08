import { describe, expect, it } from 'vitest';

import { worktreeNameOf, worktreesInCommand } from './worktree-name';

describe('worktreeNameOf', () => {
  it.each<{ case: string; filePath: string; name: string | null }>([
    {
      case: 'DotWorktreesFolder_NamesWorktree',
      filePath: '/Users/u/dev/.worktrees/app-fix/src/a.ts',
      name: 'app-fix',
    },
    {
      case: 'ClaudeWorktreesFolder_NamesWorktree',
      filePath: '/Users/u/dev/app/.claude/worktrees/sweeps/src/a.ts',
      name: 'sweeps',
    },
    {
      case: 'WorktreesWithoutClaude_Null',
      filePath: '/Users/u/dev/app/worktrees/sweeps/src/a.ts',
      name: null,
    },
    {
      case: 'PlainClone_Null',
      filePath: '/Users/u/dev/app/src/a.ts',
      name: null,
    },
    {
      case: 'WorktreeFolderAsFile_Null',
      filePath: '/Users/u/dev/.worktrees/app-fix',
      name: null,
    },
    {
      case: 'FolderCaseDiffers_NamesWorktree',
      filePath: '/Users/u/dev/app/.Claude/Worktrees/sweeps/src/a.ts',
      name: 'sweeps',
    },
    {
      case: 'NestedWorktrees_NamesInner',
      filePath: '/Users/u/dev/.worktrees/outer/.claude/worktrees/inner/a.ts',
      name: 'inner',
    },
  ])('worktreeNameOf_$case', ({ filePath, name }) => {
    expect(worktreeNameOf(filePath)).toBe(name);
  });
});

describe('worktreesInCommand', () => {
  const A = '/r/.worktrees/a';
  const B = '/r/.worktrees/b';
  it.each<{
    case: string;
    command: string;
    roots: string[];
    expected: string[];
  }>([
    { case: 'BareRoot', command: `ls ${A}`, roots: [A], expected: ['a'] },
    {
      case: 'RootThenSpace',
      command: `cd ${A} && git status`,
      roots: [A],
      expected: ['a'],
    },
    {
      case: 'QuotedPathUnderRoot',
      command: `cat "${A}/src/x.ts"`,
      roots: [A],
      expected: ['a'],
    },
    {
      case: 'RootThenSemicolon',
      command: `git -C ${A} log;`,
      roots: [A],
      expected: ['a'],
    },
    {
      case: 'LongerName_NotMatched',
      command: `ls ${A}b`,
      roots: [A],
      expected: [],
    },
    {
      case: 'DottedSuffix_NotMatched',
      command: `ls ${A}.bak`,
      roots: [A],
      expected: [],
    },
    {
      case: 'LongerNameThenRoot_Matched',
      command: `ls ${A}-old ${A}`,
      roots: [A],
      expected: ['a'],
    },
    {
      case: 'TwoRoots_InRootsOrder',
      command: `ls ${B} ${A}`,
      roots: [A, B],
      expected: ['a', 'b'],
    },
    {
      case: 'RootOutsideWorktreesFolder',
      command: 'cd /u/dev/feature-x && make',
      roots: ['/u/dev/feature-x'],
      expected: ['feature-x'],
    },
    {
      case: 'RootNamedTwice_Once',
      command: `ls ${A} && ls ${A}/src`,
      roots: [A],
      expected: ['a'],
    },
    { case: 'NoRootNamed', command: 'ls /r/src', roots: [A, B], expected: [] },
    { case: 'NoRoots', command: `ls ${A}`, roots: [], expected: [] },
  ])('worktreesInCommand_$case', ({ command, roots, expected }) => {
    expect(worktreesInCommand(command, roots)).toEqual(expected);
  });
});
