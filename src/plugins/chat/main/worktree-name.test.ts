import { describe, expect, it } from 'vitest';

import { worktreeNameOf } from './worktree-name';

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
