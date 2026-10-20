import { describe, expect, it } from 'vitest';
import type { IndexEntry } from './contract';
import { baseName } from './doc-paths';
import { buildTree, type TreeGroup, type TreeNode } from './tree';

const HOME = '/Users/u';

function entry(overrides: Partial<IndexEntry> & { path: string }): IndexEntry {
  return {
    id: overrides.path,
    kind: 'rule',
    source: 'global',
    repo: null,
    root: null,
    plugin: null,
    line: null,
    title: baseName(overrides.path),
    meta: {},
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

    expect(titles(buildTree(entries, HOME))).toEqual([
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

    expect(titles(buildTree(entries, HOME))).toEqual(['r']);
  });

  it('buildTree_KindGroups_InKindsOrder', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/skills/a/SKILL.md', kind: 'skill' }),
      entry({ path: '/Users/u/.claude/rules/b.md', kind: 'rule' }),
      entry({ path: '/Users/u/.claude/CLAUDE.md', kind: 'instructions' }),
    ];

    const global = child(buildTree(entries, HOME), 'Global');

    expect(titles(global.children)).toEqual([
      'Instructions',
      'Rules',
      'Skills',
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

    const repo = child(buildTree(entries, HOME), 'r');

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

    const repo = child(buildTree(entries, HOME), 'r');

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
      child(buildTree(entries, HOME), 'r').children,
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

  it('buildTree_GroupEntries_SortByTitleCaseInsensitive', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/rules/1.md', title: 'beta' }),
      entry({ path: '/Users/u/.claude/rules/2.md', title: 'Alpha' }),
      entry({ path: '/Users/u/.claude/rules/3.md', title: 'gamma' }),
    ];

    const rules = child(
      child(buildTree(entries, HOME), 'Global').children,
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
      child(buildTree(entries, HOME), 'Global').children,
      'Rules',
    );

    expect(rules.folder).toBe('/Users/u/.claude/rules');
  });

  it('buildTree_LeafIds_PrefixEntryId', () => {
    const entries = [entry({ path: '/x.md', id: '/x.md#L3', line: 3 })];

    const rules = child(
      child(buildTree(entries, HOME), 'Global').children,
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
