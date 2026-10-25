import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import type { IndexEntry } from './contract';
import { buildTree, titleFromId, type TreeGroup, type TreeNode } from './tree';

const HOME = '/Users/u';

function entry(overrides: Partial<IndexEntry> & { path: string }): IndexEntry {
  return {
    id: overrides.path,
    kind: 'rule',
    source: 'global',
    owner: 'mine',
    repo: null,
    root: null,
    plugin: null,
    line: null,
    title: posixPaths.base(overrides.path),
    meta: {},
    walked: [],
    ...overrides,
  };
}

function titles(nodes: readonly TreeNode[]): string[] {
  return nodes.map((node) => node.title);
}

function child(nodes: readonly TreeNode[], title: string): TreeGroup {
  const found = nodes.find((node) => node.title === title);
  if (found === undefined || found.type !== 'group') {
    throw new Error(`no group ${title} in ${titles(nodes).join(', ')}`);
  }
  return found;
}

describe('buildTree', () => {
  it('buildTree_AllSources_RootsInOrder', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/rules/a.md' }),
      entry({
        path: '/Users/u/.claude/plugins/cache/m/p/1/skills/s/SKILL.md',
        kind: 'skill',
        source: 'plugin',
        plugin: 'p@m',
        root: '/Users/u/.claude/plugins/cache/m/p/1',
      }),
      entry({
        path: '/Users/u/dev/zeta/AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'zeta',
        root: '/Users/u/dev/zeta',
      }),
      entry({
        path: '/Users/u/dev/Alpha/AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'Alpha',
        root: '/Users/u/dev/Alpha',
      }),
    ];

    expect(titles(buildTree(entries, HOME, posixPaths))).toEqual([
      'Global',
      'Plugins',
      'Alpha',
      'zeta',
    ]);
  });

  it('buildTree_NoGlobalEntries_LeavesGlobalOut', () => {
    const entries = [
      entry({
        path: '/Users/u/dev/r/AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
      }),
    ];

    expect(titles(buildTree(entries, HOME, posixPaths))).toEqual(['r']);
  });

  it('buildTree_KindGroups_InKindsOrder', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/skills/a/SKILL.md', kind: 'skill' }),
      entry({ path: '/Users/u/.claude/rules/b.md', kind: 'rule' }),
      entry({ path: '/Users/u/.claude/CLAUDE.md', kind: 'instructions' }),
    ];

    const global = child(buildTree(entries, HOME, posixPaths), 'Global');

    expect(titles(global.children)).toEqual([
      'Instructions',
      'Rules',
      'Skills',
    ]);
  });

  it('buildTree_UnknownKind_GroupAfterKnownKinds', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/x/a.md', kind: 'experiment' }),
      entry({ path: '/Users/u/.claude/rules/b.md', kind: 'rule' }),
      entry({ path: '/Users/u/.claude/CLAUDE.md', kind: 'followup' }),
    ];

    const global = child(buildTree(entries, HOME, posixPaths), 'Global');

    expect(titles(global.children)).toEqual([
      'Rules',
      'Follow-ups',
      'Experiment',
    ]);
    expect(global.children[2].id).toBe('global/kind:experiment');
  });

  it('buildTree_UnknownSource_RootAfterRepos', () => {
    const entries = [
      entry({
        path: '/Users/u/scratch/a.md',
        source: 'scratch',
        root: '/Users/u/scratch',
      }),
      entry({
        path: '/Users/u/notes/b.md',
        source: 'my_notes',
        root: '/Users/u/notes',
      }),
      entry({
        path: '/Users/u/dev/r/AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
      }),
    ];

    const roots = buildTree(entries, HOME, posixPaths);

    expect(titles(roots)).toEqual(['r', 'My notes', 'Scratch']);
    const scratch = child(roots, 'Scratch');
    expect(scratch.id).toBe('source:scratch');
    expect(titles(scratch.children)).toEqual(['Rules']);
  });

  it('buildTree_UnknownKindNamedFeatures_IdUnique', () => {
    const entries = [
      entry({
        path: '/Users/u/dev/r/odd.md',
        kind: 'features',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
      }),
      entry({
        path: '/Users/u/wigley-features/r/followups.md',
        kind: 'followup',
        source: 'features',
        repo: 'r',
        root: '/Users/u/wigley-features/r',
      }),
    ];

    const repo = child(buildTree(entries, HOME, posixPaths), 'r');

    expect(repo.children.map((node) => node.id)).toEqual([
      'repo:r/kind:features',
      'repo:r/features',
    ]);
  });

  it('buildTree_TwoClones_SplitsByClone', () => {
    const entries = [
      entry({
        path: '/Users/u/work/r/AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/work/r',
      }),
      entry({
        path: '/Users/u/dev/r/AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
      }),
    ];

    const repo = child(buildTree(entries, HOME, posixPaths), 'r');

    expect(titles(repo.children)).toEqual(['~/dev/r', '~/work/r']);
    expect(repo.children.map((node) => node.id)).toEqual([
      'repo:r/clone:/Users/u/dev/r',
      'repo:r/clone:/Users/u/work/r',
    ]);
  });

  it('buildTree_OneClone_NoCloneNode', () => {
    const entries = [
      entry({
        path: '/Users/u/dev/r/AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
      }),
      entry({
        path: '/Users/u/dev/r/.claude/rules/a.md',
        kind: 'rule',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
      }),
    ];

    const repo = child(buildTree(entries, HOME, posixPaths), 'r');

    expect(repo.children[0].id).toBe('repo:r/instructions');
    expect(titles(repo.children)).toEqual(['Instructions', 'Rules']);
  });

  it('buildTree_Features_GroupedBySlugThenKinds', () => {
    const root = '/Users/u/wigley-features/r';
    const feature = { source: 'features', repo: 'r', root } as const;
    const entries = [
      entry({
        ...feature,
        path: `${root}/b-feat/01-task.md`,
        kind: 'task',
        meta: { feature: 'b-feat' },
      }),
      entry({
        ...feature,
        path: `${root}/a-feat/design.md`,
        kind: 'feature-doc',
        title: 'Design',
      }),
      entry({
        ...feature,
        path: `${root}/a-feat/checklist.md`,
        kind: 'feature',
        title: 'Zeta checklist',
        meta: { slug: 'a-feat' },
      }),
      entry({
        ...feature,
        path: `${root}/followups.md`,
        id: `${root}/followups.md#L3`,
        kind: 'followup',
        line: 3,
      }),
    ];

    const features = child(
      child(buildTree(entries, HOME, posixPaths), 'r').children,
      'Features',
    );

    expect(titles(features.children)).toEqual([
      'a-feat',
      'b-feat',
      'Follow-ups',
    ]);
    expect(
      child(features.children, 'a-feat').children.map((node) => node.id),
    ).toEqual([
      `entry:${root}/a-feat/checklist.md`,
      `entry:${root}/a-feat/design.md`,
    ]);
  });

  it('buildTree_FeatureUnknownKinds_AfterKnownThenByKindId', () => {
    const root = '/Users/u/wigley-features/r';
    const feature = { source: 'features', repo: 'r', root } as const;
    const entries = [
      entry({
        ...feature,
        path: `${root}/a-feat/zeta.md`,
        kind: 'zeta',
        title: 'A first by title',
      }),
      entry({
        ...feature,
        path: `${root}/a-feat/alpha.md`,
        kind: 'alpha',
        title: 'B second by title',
      }),
      entry({
        ...feature,
        path: `${root}/a-feat/design.md`,
        kind: 'feature-doc',
        title: 'Z last by title',
      }),
    ];

    const features = child(
      child(buildTree(entries, HOME, posixPaths), 'r').children,
      'Features',
    );

    expect(
      child(features.children, 'a-feat').children.map((node) => node.id),
    ).toEqual([
      `entry:${root}/a-feat/design.md`,
      `entry:${root}/a-feat/alpha.md`,
      `entry:${root}/a-feat/zeta.md`,
    ]);
  });

  it('buildTree_FeatureSlugNamedLikeKind_IdsDistinct', () => {
    const root = '/Users/u/wigley-features/r';
    const feature = { source: 'features', repo: 'r', root } as const;
    const entries = [
      entry({
        ...feature,
        path: `${root}/followup/design.md`,
        kind: 'feature-doc',
      }),
      entry({
        ...feature,
        path: `${root}/followups.md`,
        id: `${root}/followups.md#L3`,
        kind: 'followup',
        line: 3,
      }),
    ];

    const features = child(
      child(buildTree(entries, HOME, posixPaths), 'r').children,
      'Features',
    );

    expect(features.children.map((node) => node.id)).toEqual([
      'repo:r/features/feature:followup',
      'repo:r/features/followup',
    ]);
  });

  it('buildTree_GroupEntries_SortByTitleCaseInsensitive', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/rules/1.md', title: 'beta' }),
      entry({ path: '/Users/u/.claude/rules/2.md', title: 'Alpha' }),
      entry({ path: '/Users/u/.claude/rules/3.md', title: 'gamma' }),
    ];

    const rules = child(
      child(buildTree(entries, HOME, posixPaths), 'Global').children,
      'Rules',
    );

    expect(titles(rules.children)).toEqual(['Alpha', 'beta', 'gamma']);
  });

  it('buildTree_GroupFolder_IsCommonFolder', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/rules/a.md' }),
      entry({ path: '/Users/u/.claude/rules/x/b.md' }),
    ];

    const rules = child(
      child(buildTree(entries, HOME, posixPaths), 'Global').children,
      'Rules',
    );

    expect(rules.folder).toBe('/Users/u/.claude/rules');
  });

  it('buildTree_LeafIds_PrefixEntryId', () => {
    const entries = [entry({ path: '/x.md', id: '/x.md#L3', line: 3 })];

    const rules = child(
      child(buildTree(entries, HOME, posixPaths), 'Global').children,
      'Rules',
    );

    expect(rules.children[0]).toEqual({
      type: 'entry',
      id: 'entry:/x.md#L3',
      title: 'x.md',
      entryId: '/x.md#L3',
    });
  });
});

describe('titleFromId', () => {
  it('titleFromId_HyphensAndUnderscores_BecomeSpaces', () => {
    expect(titleFromId('my-kind')).toBe('My kind');
    expect(titleFromId('scratch_notes')).toBe('Scratch notes');
  });
});

describe('buildTree on Windows', () => {
  const WINDOWS_HOME = 'C:\\Users\\u';

  it('buildTree_WindowsTwoDrives_GroupFolderNull', () => {
    const entries = [
      entry({
        path: 'C:\\Users\\u\\.claude\\CLAUDE.md',
        kind: 'instructions',
        title: 'CLAUDE.md',
      }),
      entry({
        path: 'D:\\agents\\AGENTS.md',
        kind: 'instructions',
        title: 'AGENTS.md',
      }),
    ];

    const global = child(
      buildTree(entries, WINDOWS_HOME, windowsPaths),
      'Global',
    );

    expect(global.folder).toBe(null);
    expect(child(global.children, 'Instructions').folder).toBe(null);
  });

  it('buildTree_WindowsFeatureSlug_FromFolderBelowRoot', () => {
    const root = 'C:\\Users\\u\\wigley-features\\r';
    const feature = { source: 'features', repo: 'r', root } as const;
    const entries = [
      entry({
        ...feature,
        path: `${root}\\login\\design.md`,
        kind: 'feature-doc',
        title: 'Design',
      }),
      entry({
        ...feature,
        path: `${root}\\followups.md`,
        kind: 'followup',
        title: 'followups.md',
      }),
    ];

    const features = child(
      child(buildTree(entries, WINDOWS_HOME, windowsPaths), 'r').children,
      'Features',
    );

    expect(titles(features.children)).toEqual(['login', 'Follow-ups']);
  });

  it('buildTree_WindowsTwoClones_TildeTitles', () => {
    const entries = [
      entry({
        path: 'C:\\Users\\u\\dev\\r\\AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'r',
        root: 'C:\\Users\\u\\dev\\r',
        title: 'AGENTS.md',
      }),
      entry({
        path: 'C:\\Users\\u\\src\\r\\AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'r',
        root: 'C:\\Users\\u\\src\\r',
        title: 'AGENTS.md',
      }),
    ];

    const repo = child(buildTree(entries, WINDOWS_HOME, windowsPaths), 'r');

    expect(titles(repo.children)).toEqual(['~\\dev\\r', '~\\src\\r']);
  });
});
