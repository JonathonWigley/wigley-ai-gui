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

function mineChildren(
  entries: readonly IndexEntry[],
  homeDir = HOME,
  paths = posixPaths,
): TreeNode[] {
  return child(buildTree(entries, homeDir, paths), 'Mine').children;
}

function ids(nodes: readonly TreeNode[]): string[] {
  return nodes.map((node) => node.id);
}

// Every group and leaf id under `nodes`, depth first.
function flattenedIds(nodes: readonly TreeNode[]): string[] {
  const found: string[] = [];
  const pending = [...nodes].reverse();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    found.push(node.id);
    if (node.type === 'group') {
      pending.push(...[...node.children].reverse());
    }
  }
  return found;
}

// A third-party skill of an installed plugin whose marketplace has no clone.
function thirdPartyPluginSkill(plugin: string): IndexEntry {
  const name = plugin.split('@')[0];
  const root = `/Users/u/.claude/plugins/cache/m/${name}/1`;
  return entry({
    path: `${root}/skills/s/SKILL.md`,
    kind: 'skill',
    source: 'plugin',
    owner: 'third-party',
    plugin,
    root,
  });
}

// Repo `m` cloned at `root`, carrying plugin `w@m`'s skill `f`.
function marketplaceSkill(root: string): IndexEntry {
  return entry({
    path: `${root}/plugins/w/skills/f/SKILL.md`,
    kind: 'skill',
    source: 'repo',
    repo: 'm',
    root,
    plugin: 'w@m',
  });
}

const INSTALLED_ROOT = '/Users/u/.claude/plugins/cache/m/w/1';

function installedOnlySkill(): IndexEntry {
  return entry({
    path: `${INSTALLED_ROOT}/skills/g/SKILL.md`,
    kind: 'skill',
    source: 'plugin',
    plugin: 'w@m',
    root: INSTALLED_ROOT,
  });
}

// Repo `m` at `/Users/u/dev/m`: an AGENTS.md, plugin `w@m`'s skill and a
// feature-home follow-up.
function marketplaceRepo(): IndexEntry[] {
  return [
    entry({
      path: '/Users/u/dev/m/AGENTS.md',
      kind: 'instructions',
      source: 'repo',
      repo: 'm',
      root: '/Users/u/dev/m',
    }),
    marketplaceSkill('/Users/u/dev/m'),
    entry({
      path: '/Users/u/wigley-features/m/followups.md',
      kind: 'followup',
      source: 'features',
      repo: 'm',
      root: '/Users/u/wigley-features/m',
    }),
  ];
}

function marketplaceRepoWithInstalledOnly(): IndexEntry[] {
  return [
    ...marketplaceRepo(),
    installedOnlySkill(),
    entry({
      path: INSTALLED_ROOT,
      kind: 'plugin',
      source: 'plugin',
      plugin: 'w@m',
      root: INSTALLED_ROOT,
      title: 'w@m',
    }),
  ];
}

function twoClonesCarryingKey(): IndexEntry[] {
  return [
    marketplaceSkill('/Users/u/dev/m'),
    marketplaceSkill('/Users/u/work/m'),
    installedOnlySkill(),
  ];
}

function globalSkill(name: string, title = name): IndexEntry {
  return entry({
    path: `/Users/u/.claude/skills/${name}/SKILL.md`,
    kind: 'skill',
    title,
  });
}

function skillFile(path: string, skill: string): IndexEntry {
  return entry({ path, kind: 'skill-file', meta: { skill } });
}

describe('buildTree', () => {
  it('buildTree_BothOwners_MineThenThirdParty', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/rules/a.md' }),
      thirdPartyPluginSkill('v@m'),
    ];

    const roots = buildTree(entries, HOME, posixPaths);

    expect(titles(roots)).toEqual(['Mine', 'Third-party']);
    expect(ids(roots)).toEqual(['owner:mine', 'owner:third-party']);
  });

  it('buildTree_NoThirdParty_OnlyMine', () => {
    const entries = [entry({ path: '/Users/u/.claude/rules/a.md' })];

    expect(titles(buildTree(entries, HOME, posixPaths))).toEqual(['Mine']);
  });

  it('buildTree_OnlyThirdParty_OnlyThirdPartyRoot', () => {
    const entries = [thirdPartyPluginSkill('v@m')];

    expect(titles(buildTree(entries, HOME, posixPaths))).toEqual([
      'Third-party',
    ]);
  });

  it('buildTree_MineChildren_GlobalPluginsReposUnknownSources', () => {
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
    ];

    const mine = mineChildren(entries);

    expect(titles(mine)).toEqual([
      'Global',
      'Plugins',
      'Alpha',
      'zeta',
      'My notes',
      'Scratch',
    ]);
    const plugins = child(mine, 'Plugins');
    expect(plugins.id).toBe('owner:mine/plugins');
    expect(ids(plugins.children)).toEqual(['owner:mine/plugins/p@m']);
    expect(titles(plugins.children)).toEqual(['p@m']);
  });

  it('buildTree_MarketplaceClone_PluginNodeBetweenKindsAndFeatures', () => {
    const repo = child(mineChildren(marketplaceRepo()), 'm');

    expect(ids(repo.children)).toEqual([
      'repo:m/instructions',
      'repo:m/plugin:w@m',
      'repo:m/features',
    ]);
    const plugin = child(repo.children, 'w@m');
    expect(ids(plugin.children)).toEqual(['repo:m/plugin:w@m/skill']);
  });

  it('buildTree_InstalledOnly_KindPluginInNodeRestInInstalledOnly', () => {
    const repo = child(mineChildren(marketplaceRepoWithInstalledOnly()), 'm');

    const plugin = child(repo.children, 'w@m');
    expect(ids(plugin.children)).toEqual([
      'repo:m/plugin:w@m/skill',
      'repo:m/plugin:w@m/plugin',
      'repo:m/plugin:w@m/installed',
    ]);
    const installed = child(plugin.children, 'Installed only');
    expect(ids(installed.children)).toEqual([
      'repo:m/plugin:w@m/installed/skill',
    ]);
    expect(plugin.folder).toBe('/Users/u/dev/m/plugins/w/skills/f');
  });

  it('buildTree_InstalledOnly_NoMinePluginsNode', () => {
    const mine = mineChildren(marketplaceRepoWithInstalledOnly());

    expect(titles(mine)).not.toContain('Plugins');
  });

  it('buildTree_TwoClonesCarryKey_PluginNodesInClonesInstalledOnlyInFirst', () => {
    const repo = child(mineChildren(twoClonesCarryingKey()), 'm');

    const devId = 'repo:m/clone:/Users/u/dev/m';
    const dev = child(repo.children, '~/dev/m');
    expect(ids(dev.children)).toEqual([`${devId}/plugin:w@m`]);
    const devPlugin = child(dev.children, 'w@m');
    expect(ids(devPlugin.children).at(-1)).toBe(
      `${devId}/plugin:w@m/installed`,
    );
    const work = child(repo.children, '~/work/m');
    const workPlugin = child(work.children, 'w@m');
    expect(
      ids(workPlugin.children).filter((id) => id.endsWith('/installed')),
    ).toEqual([]);
  });

  it('buildTree_Roles_RepoClonePluginOther', () => {
    const roots = buildTree(marketplaceRepo(), HOME, posixPaths);
    const repo = child(child(roots, 'Mine').children, 'm');
    const plugin = child(repo.children, 'w@m');

    expect(repo.role).toEqual({ type: 'repo', clone: '/Users/u/dev/m' });
    expect(plugin.role).toEqual({ type: 'plugin' });
    expect(child(plugin.children, 'Skills').role).toEqual({ type: 'other' });
    expect(child(roots, 'Mine').role).toEqual({ type: 'other' });
  });

  it('buildTree_RolesSplit_CloneRolesRepoNull', () => {
    const repo = child(mineChildren(twoClonesCarryingKey()), 'm');

    expect(repo.role).toEqual({ type: 'repo', clone: null });
    expect(child(repo.children, '~/dev/m').role).toEqual({
      type: 'clone',
      clone: '/Users/u/dev/m',
    });
    expect(child(repo.children, '~/work/m').role).toEqual({
      type: 'clone',
      clone: '/Users/u/work/m',
    });
  });

  it('buildTree_ThirdParty_SyncedThenPluginsByKey', () => {
    const entries = [
      entry({
        path: '/Users/u/.claude/skills/synced/b/s/SKILL.md',
        kind: 'skill',
        owner: 'third-party',
      }),
      thirdPartyPluginSkill('v@m'),
      thirdPartyPluginSkill('a@m'),
    ];

    const thirdParty = child(
      buildTree(entries, HOME, posixPaths),
      'Third-party',
    );

    expect(titles(thirdParty.children)).toEqual([
      'Synced skills',
      'a@m',
      'v@m',
    ]);
    expect(ids(thirdParty.children)).toEqual([
      'owner:third-party/synced',
      'owner:third-party/plugin:a@m',
      'owner:third-party/plugin:v@m',
    ]);
    const synced = child(thirdParty.children, 'Synced skills');
    expect(ids(synced.children)).toEqual(['owner:third-party/synced/skill']);
  });

  it('buildTree_SkillWithFiles_GroupSkillMdFirstThenFilesByTitle', () => {
    const skill = '/Users/u/.claude/skills/s/SKILL.md';
    const entries = [
      globalSkill('s'),
      skillFile('/Users/u/.claude/skills/s/zeta.md', skill),
      skillFile('/Users/u/.claude/skills/s/ref/alpha.md', skill),
    ];

    const global = child(mineChildren(entries), 'Global');

    expect(titles(global.children)).toEqual(['Skills']);
    const skills = child(global.children, 'Skills');
    expect(skills.children).toHaveLength(1);
    const skillGroup = child(skills.children, 's');
    expect(skillGroup.id).toBe(`skill:${skill}`);
    expect(titles(skillGroup.children)).toEqual([
      'SKILL.md',
      'alpha.md',
      'zeta.md',
    ]);
    expect(ids(skillGroup.children)).toEqual([
      `entry:${skill}`,
      'entry:/Users/u/.claude/skills/s/ref/alpha.md',
      'entry:/Users/u/.claude/skills/s/zeta.md',
    ]);
  });

  it('buildTree_SkillGroupAmongSkills_SortedBySkillTitle', () => {
    const entries = [
      globalSkill('c'),
      globalSkill('b'),
      skillFile(
        '/Users/u/.claude/skills/b/notes.md',
        '/Users/u/.claude/skills/b/SKILL.md',
      ),
      globalSkill('a'),
    ];

    const skills = child(
      child(mineChildren(entries), 'Global').children,
      'Skills',
    );

    expect(titles(skills.children)).toEqual(['a', 'b', 'c']);
    expect(skills.children.map((node) => node.type)).toEqual([
      'entry',
      'group',
      'entry',
    ]);
  });

  it('buildTree_OrphanSkillFile_SkillFilesGroup', () => {
    const entries = [
      skillFile(
        '/Users/u/.claude/skills/gone/notes.md',
        '/Users/u/.claude/skills/gone/SKILL.md',
      ),
    ];

    const global = child(mineChildren(entries), 'Global');

    expect(titles(global.children)).toEqual(['Skill files']);
    expect(global.children[0].id).toBe('global/skill-file');
  });

  it('buildTree_SameIndexTwice_SameIds', () => {
    const first = buildTree(twoClonesCarryingKey(), HOME, posixPaths);
    const second = buildTree(twoClonesCarryingKey(), HOME, posixPaths);

    expect(flattenedIds(second)).toEqual(flattenedIds(first));
  });

  it('buildTree_SelfTestGlobalKinds_InstructionsRulesHooksLast', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/CLAUDE.md', kind: 'instructions' }),
      entry({ path: '/Users/u/.claude/rules/style.md', kind: 'rule' }),
      entry({
        path: '/Users/u/.claude/settings.json',
        id: '/Users/u/.claude/settings.json#hook:PreToolUse:0',
        kind: 'hook',
      }),
    ];

    const global = child(mineChildren(entries), 'Global');

    expect(titles(global.children)).toEqual(['Instructions', 'Rules', 'Hooks']);
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

    expect(titles(mineChildren(entries))).toEqual(['r']);
  });

  it('buildTree_KindGroups_InKindsOrder', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/skills/a/SKILL.md', kind: 'skill' }),
      entry({ path: '/Users/u/.claude/rules/b.md', kind: 'rule' }),
      entry({ path: '/Users/u/.claude/CLAUDE.md', kind: 'instructions' }),
    ];

    const global = child(mineChildren(entries), 'Global');

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

    const global = child(mineChildren(entries), 'Global');

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

    const roots = mineChildren(entries);

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

    const repo = child(mineChildren(entries), 'r');

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

    const repo = child(mineChildren(entries), 'r');

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

    const repo = child(mineChildren(entries), 'r');

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
      child(mineChildren(entries), 'r').children,
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
      child(mineChildren(entries), 'r').children,
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
      child(mineChildren(entries), 'r').children,
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
      child(mineChildren(entries), 'Global').children,
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
      child(mineChildren(entries), 'Global').children,
      'Rules',
    );

    expect(rules.folder).toBe('/Users/u/.claude/rules');
  });

  it('buildTree_LeafIds_PrefixEntryId', () => {
    const entries = [entry({ path: '/x.md', id: '/x.md#L3', line: 3 })];

    const rules = child(
      child(mineChildren(entries), 'Global').children,
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
      mineChildren(entries, WINDOWS_HOME, windowsPaths),
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
      child(mineChildren(entries, WINDOWS_HOME, windowsPaths), 'r').children,
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

    const repo = child(mineChildren(entries, WINDOWS_HOME, windowsPaths), 'r');

    expect(titles(repo.children)).toEqual(['~\\dev\\r', '~\\src\\r']);
  });
});
