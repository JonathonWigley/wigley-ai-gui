import { describe, expect, it } from 'vitest';

import { posixPaths } from '../../../shared/paths/posix-paths';

import {
  type ResolvedFolder,
  rootSpellings,
  runsGitWorktree,
  worktreeNameOf,
  worktreesInCommand,
} from './worktree-name';

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
    {
      case: 'CaseDiffers_Matched',
      command: 'ls /R/.Worktrees/A/src',
      roots: [A],
      expected: ['a'],
    },
    { case: 'NoRootNamed', command: 'ls /r/src', roots: [A, B], expected: [] },
    { case: 'NoRoots', command: `ls ${A}`, roots: [], expected: [] },
  ])('worktreesInCommand_$case', ({ command, roots, expected }) => {
    expect(worktreesInCommand(command, roots)).toEqual(expected);
  });
});

describe('runsGitWorktree', () => {
  it.each<{ case: string; command: string; runs: boolean }>([
    { case: 'Add', command: 'git worktree add ../wt -b x', runs: true },
    {
      case: 'AfterCd',
      command: 'cd /r/app && git worktree list',
      runs: true,
    },
    {
      case: 'WithDashC',
      command: 'git -C /r/app worktree remove /r/.worktrees/a',
      runs: true,
    },
    {
      case: 'WithQuotedDashC',
      command: 'git -C "/r/my app" worktree prune',
      runs: true,
    },
    {
      case: 'WithConfigAndFlag',
      command: 'git -c core.x=1 --no-pager worktree list',
      runs: true,
    },
    { case: 'GitByPath', command: '/usr/bin/git worktree list', runs: true },
    {
      case: 'InBackticks',
      command: 'echo `git worktree list`',
      runs: true,
    },
    {
      case: 'EndsAtBacktick',
      command: 'echo `git worktree`',
      runs: true,
    },
    {
      case: 'EndsAtSemicolon',
      command: 'git worktree; git status',
      runs: true,
    },
    {
      case: 'WithSeparateGitDir',
      command: 'git --git-dir /r/app/.git worktree add ../wt',
      runs: true,
    },
    {
      case: 'WithSeparateWorkTree',
      command: "git --work-tree '/r/my app' worktree list",
      runs: true,
    },
    {
      case: 'WithGitDirEquals',
      command: 'git --git-dir=/r/app/.git worktree list',
      runs: true,
    },
    {
      case: 'PathUnderDotWorktrees',
      command: 'ls /r/.worktrees/a && git status',
      runs: false,
    },
    {
      case: 'PathUnderClaudeWorktrees',
      command: 'cat /r/app/.claude/worktrees/b/src/x.ts',
      runs: false,
    },
    {
      case: 'GitFolderPath',
      command: 'ls /r/app/.git/worktrees',
      runs: false,
    },
    {
      case: 'OtherGitSubcommand',
      command: 'git log --grep worktree',
      runs: false,
    },
    {
      case: 'WordInsideAnotherWord',
      command: 'git worktrees',
      runs: false,
    },
    { case: 'LongerCommandName', command: 'legit worktree', runs: false },
  ])('runsGitWorktree_$case', ({ command, runs }) => {
    expect(runsGitWorktree(command)).toBe(runs);
  });
});

describe('rootSpellings', () => {
  // `link` and each folder above it, deepest first, resolved by `real`.
  function foldersUp(
    link: string,
    real: (folder: string) => string,
  ): ResolvedFolder[] {
    const folders: ResolvedFolder[] = [];
    for (let folder = link; ; folder = posixPaths.parent(folder)) {
      folders.push({ folder, realFolder: real(folder) });
      if (folder === posixPaths.parent(folder)) {
        return folders;
      }
    }
  }
  // `from` and every path under it resolve under `to`.
  const linked =
    (from: string, to: string) =>
    (folder: string): string =>
      folder === from || folder.startsWith(`${from}/`)
        ? to + folder.slice(from.length)
        : folder;

  it.each<{
    case: string;
    roots: string[];
    folders: ResolvedFolder[];
    expected: string[];
  }>([
    {
      case: 'SymlinkedTop_AddsFolderSpelling',
      roots: ['/private/tmp/c/repo-wt', '/private/tmp/c/repo/.worktrees/b'],
      folders: foldersUp('/tmp/c/repo', linked('/tmp', '/private/tmp')),
      expected: [
        '/private/tmp/c/repo-wt',
        '/tmp/c/repo-wt',
        '/private/tmp/c/repo/.worktrees/b',
        '/tmp/c/repo/.worktrees/b',
      ],
    },
    {
      case: 'SymlinkedInnerFolder_MapsOntoLink',
      roots: ['/Volumes/d/real/app-wt'],
      folders: foldersUp(
        '/Users/u/link/app',
        linked('/Users/u/link', '/Volumes/d/real'),
      ),
      expected: ['/Volumes/d/real/app-wt', '/Users/u/link/app-wt'],
    },
    {
      case: 'RootOutsideTheResolvedPart_OneSpelling',
      roots: ['/srv/wt/app-fix'],
      folders: foldersUp(
        '/Users/u/link/app',
        linked('/Users/u/link', '/Volumes/d/real'),
      ),
      expected: ['/srv/wt/app-fix'],
    },
    {
      case: 'LinkNamedAsItsTarget_RootBesideTheTargetOneSpelling',
      roots: ['/Users/u/dev/.worktrees/agents-fix'],
      folders: foldersUp(
        '/Users/u/agents',
        linked('/Users/u/agents', '/Users/u/dev/agents'),
      ),
      expected: ['/Users/u/dev/.worktrees/agents-fix'],
    },
    {
      case: 'NoSymlink_OneSpelling',
      roots: ['/u/dev/.worktrees/a', '/u/dev/b'],
      folders: foldersUp('/u/dev/app', (folder) => folder),
      expected: ['/u/dev/.worktrees/a', '/u/dev/b'],
    },
  ])('rootSpellings_$case', ({ roots, folders, expected }) => {
    expect(rootSpellings(roots, folders, posixPaths)).toEqual(expected);
  });
});
