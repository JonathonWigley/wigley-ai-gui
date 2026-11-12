import { describe, expect, it } from 'vitest';
import type { FollowupItem } from '../../../shared/followups/followup-file';
import type { BacklogHome } from '../contract';
import { backlogRows } from './rows';

function item(title: string, line: number, done = false): FollowupItem {
  return {
    title,
    oneLine: `${title} gist`,
    tags: ['agent-ready'],
    body: `${title} body.`,
    line,
    endLine: line + 2,
    done,
  };
}

function home(
  repo: string,
  root: string,
  repoFolder: string | null,
  files: Record<string, FollowupItem[]>,
): BacklogHome {
  return {
    repo,
    root,
    isCreateTarget: true,
    gitRoot: null,
    repoFolder,
    followupFiles: Object.entries(files).map(([path, items]) => ({
      path,
      items,
    })),
  };
}

describe('backlogRows', () => {
  it('backlogRows_TwoHomes_OneRowPerItemFirstKeyWins', () => {
    const inRepo = home('r', '/dev/r/docs/features', '/dev/r', {
      '/dev/r/docs/features/followups.md': [
        item('Shared', 7),
        item('Done one', 12, true),
      ],
    });
    const outside = home('r', '/u/wigley-features/r', null, {
      '/u/wigley-features/r/followups.md': [item('Shared', 3), item('Own', 9)],
    });

    const rows = backlogRows({ homes: [inRepo, outside], message: null });

    expect(rows).toEqual([
      {
        key: 'r\nShared',
        repo: 'r',
        title: 'Shared',
        oneLine: 'Shared gist',
        tags: ['agent-ready'],
        body: 'Shared body.',
        done: false,
        path: '/dev/r/docs/features/followups.md',
        line: 7,
        homeRoot: '/dev/r/docs/features',
        repoFolder: '/dev/r',
      },
      expect.objectContaining({
        key: 'r\nDone one',
        done: true,
        line: 12,
      }),
      expect.objectContaining({
        key: 'r\nOwn',
        path: '/u/wigley-features/r/followups.md',
        homeRoot: '/u/wigley-features/r',
        repoFolder: null,
      }),
    ]);
  });

  it('backlogRows_HomesOfTwoRepos_GroupedByRepo', () => {
    const a1 = home('a', '/a1', null, {
      '/a1/followups.md': [item('A1 one', 1)],
      '/a1/followups/ui.md': [item('A1 two', 1)],
    });
    const b = home('b', '/b', null, { '/b/followups.md': [item('B one', 1)] });
    const a2 = home('a', '/a2', null, { '/a2/followups.md': [item('A2', 1)] });

    const rows = backlogRows({ homes: [a1, b, a2], message: null });

    expect(rows.map((row) => row.key)).toEqual([
      'a\nA1 one',
      'a\nA1 two',
      'a\nA2',
      'b\nB one',
    ]);
  });
});
