import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { FollowupItem } from '../../../shared/followups/followup-file';
import type { BacklogHome, BacklogRead } from '../../backlog/contract';
import { noteHomes } from './note-homes';

function item(title: string, done = false): FollowupItem {
  return {
    title,
    oneLine: '',
    tags: [],
    body: '',
    line: 1,
    endLine: 1,
    done,
  };
}

function home(change: Partial<BacklogHome>): BacklogHome {
  return {
    repo: 'r',
    root: '/r/docs/features',
    isCreateTarget: true,
    gitRoot: '/r',
    uncommitted: false,
    repoFolder: '/r',
    followupFiles: [],
    plans: [],
    features: [],
    ...change,
  };
}

const ZETA_IN_REPO = home({
  repo: 'zeta',
  root: '/zeta/docs/features',
  gitRoot: '/zeta',
  followupFiles: [
    {
      path: '/zeta/docs/features/followups/a.md',
      items: [item('A one'), item('A done', true), item('A two')],
    },
    {
      path: '/zeta/docs/features/followups/b.md',
      items: [item('B one')],
    },
  ],
});
const ZETA_OTHER = home({
  repo: 'zeta',
  root: '/home/wigley-features/zeta',
  isCreateTarget: false,
  gitRoot: null,
  followupFiles: [
    { path: '/home/wigley-features/zeta/followups.md', items: [item('X')] },
  ],
});
const ALPHA_OUTSIDE = home({
  repo: 'alpha',
  root: '/home/wigley-features/alpha',
  gitRoot: '/alpha',
});

const READ: BacklogRead = {
  homes: [ZETA_IN_REPO, ZETA_OTHER, ALPHA_OUTSIDE],
  message: 'Index loaded with warnings',
};

describe('noteHomes', () => {
  const result = noteHomes(READ, posixPaths);

  it('noteHomes_TwoHomesInRepo_KeepsCreateTargetOnly_SortedByRepo', () => {
    expect(result.homes.map((each) => each.root)).toEqual([
      '/home/wigley-features/alpha',
      '/zeta/docs/features',
    ]);
  });

  it('noteHomes_OpenItems_FileThenItemOrder_DoneLeftOut', () => {
    expect(result.homes[1].followups).toEqual([
      { path: '/zeta/docs/features/followups/a.md', title: 'A one' },
      { path: '/zeta/docs/features/followups/a.md', title: 'A two' },
      { path: '/zeta/docs/features/followups/b.md', title: 'B one' },
    ]);
  });

  it('noteHomes_HomeInsideGitRoot_FolderIsGitRoot', () => {
    expect(result.homes[1].folder).toBe('/zeta');
  });

  it('noteHomes_HomeOutsideGitRoot_FolderNull', () => {
    expect(result.homes[0].folder).toBeNull();
  });

  it('noteHomes_NoGitRoot_FolderNull', () => {
    const read = { homes: [home({ gitRoot: null })], message: null };
    expect(noteHomes(read, posixPaths).homes[0].folder).toBeNull();
  });
});
