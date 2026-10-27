import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { IndexEntry } from '../../docs/contract';
import { groupHomes, markCreateTargets } from './homes';

const HOME = '/dev/r/docs/features';
const OUT_HOME = '/u/wigley-features/r';

function entry(
  kind: string,
  path: string,
  meta: Record<string, unknown>,
  fields: Partial<IndexEntry> = {},
): IndexEntry {
  return {
    id: path,
    kind,
    source: 'features',
    owner: 'mine',
    repo: 'r',
    root: HOME,
    plugin: null,
    path,
    line: null,
    title: path,
    meta,
    walked: [],
    lastLoaded: null,
    ...fields,
  };
}

describe('groupHomes', () => {
  it('groupHomes_FeatureEntries_GroupedByRootSortedByRepoThenRoot', () => {
    const entries = [
      entry('followup', `${OUT_HOME}/followups.md`, {}, { root: OUT_HOME }),
      entry(
        'followup',
        `/dev/a/docs/features/followups.md`,
        {},
        {
          repo: 'a',
          root: '/dev/a/docs/features',
        },
      ),
      entry('followup', `${HOME}/followups.md`, {}),
    ];

    const homes = groupHomes(entries, posixPaths);

    expect(homes.map((home) => [home.repo, home.root])).toEqual([
      ['a', '/dev/a/docs/features'],
      ['r', HOME],
      ['r', OUT_HOME],
    ]);
  });

  it('groupHomes_FollowupItems_OneFilePerPath', () => {
    const entries = [
      entry('followup', `${HOME}/followups/ui.md`, {}, { line: 5 }),
      entry('followup', `${HOME}/followups.md`, {}, { line: 3 }),
      entry('followup', `${HOME}/followups.md`, {}, { line: 9 }),
    ];

    const [home] = groupHomes(entries, posixPaths);

    expect(home.followupFiles).toEqual([
      { path: `${HOME}/followups.md` },
      { path: `${HOME}/followups/ui.md` },
    ]);
  });

  it('groupHomes_Tasks_AttachToTheirPlanOrFeature', () => {
    const planPath = `${HOME}/f/plan-p/plan.md`;
    const checklist = `${HOME}/f/checklist.md`;
    const entries = [
      entry(
        'task',
        `${HOME}/f/plan-p/02-b.md`,
        { plan: 'p', status: null },
        {
          title: 'B',
        },
      ),
      entry('plan', planPath, { feature: 'f', checked: 1, total: 3 }),
      entry(
        'task',
        `${HOME}/f/plan-p/01-a.md`,
        { plan: 'p', status: 'done' },
        {
          title: 'A',
        },
      ),
      entry('feature', checklist, { slug: 'f', checked: 2, total: 5 }),
      entry(
        'task',
        `${HOME}/f/01-c.md`,
        { plan: null, status: 'open' },
        {
          title: 'C',
        },
      ),
      entry('task', `${HOME}/g/plan-q/01-d.md`, { plan: 'q' }, { title: 'D' }),
    ];

    const [home] = groupHomes(entries, posixPaths);

    expect(home.plans).toEqual([
      {
        path: planPath,
        feature: 'f',
        checked: 1,
        total: 3,
        tasks: [
          { path: `${HOME}/f/plan-p/01-a.md`, title: 'A', status: 'done' },
          { path: `${HOME}/f/plan-p/02-b.md`, title: 'B', status: null },
        ],
      },
    ]);
    expect(home.features).toEqual([
      {
        path: checklist,
        slug: 'f',
        checked: 2,
        total: 5,
        tasks: [{ path: `${HOME}/f/01-c.md`, title: 'C', status: 'open' }],
      },
    ]);
  });

  it('groupHomes_RepoDocsFollowups_Excluded', () => {
    const entries = [
      entry(
        'followup',
        '/dev/r/docs/followups/topic.md',
        {},
        {
          source: 'repo',
          root: '/dev/r',
        },
      ),
      entry('followup', `${HOME}/followups.md`, {}),
    ];

    const homes = groupHomes(entries, posixPaths);

    expect(homes.map((home) => home.root)).toEqual([HOME]);
    expect(homes[0].followupFiles).toEqual([{ path: `${HOME}/followups.md` }]);
  });
});

describe('markCreateTargets', () => {
  it('markCreateTargets_GitHomeAndOutOfRepoHome_GitHomeWins', () => {
    const homes = [
      { repo: 'r', root: '/a/wigley-features/r', gitRoot: null },
      { repo: 'r', root: '/z/r/docs/features', gitRoot: '/z/r' },
    ];

    const marked = markCreateTargets(homes);

    expect(marked.map((home) => home.isCreateTarget)).toEqual([false, true]);
  });

  it('markCreateTargets_TwoGitHomes_FirstByRootWins', () => {
    const homes = [
      { repo: 'r', root: '/b/docs/features', gitRoot: '/b' },
      { repo: 'r', root: '/a/docs/features', gitRoot: '/a' },
    ];

    const marked = markCreateTargets(homes);

    expect(marked.map((home) => home.isCreateTarget)).toEqual([false, true]);
  });

  it('markCreateTargets_NoGitHome_FirstByRootWins', () => {
    const homes = [
      { repo: 'r', root: '/b/r', gitRoot: null },
      { repo: 'r', root: '/a/r', gitRoot: null },
      { repo: 's', root: '/c/s', gitRoot: null },
    ];

    const marked = markCreateTargets(homes);

    expect(marked.map((home) => home.isCreateTarget)).toEqual([
      false,
      true,
      true,
    ]);
  });
});
