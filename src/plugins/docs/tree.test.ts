import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import type { IndexEntry } from './contract';
import {
  buildTree,
  buildWikiFilterTree,
  buildWikiTree,
  featureSlug,
  findSkillEntry,
  isStarredLeafId,
  MINE_ROOT_ID,
  titleFromId,
  type TreeGroup,
  type TreeLeaf,
  type TreeNode,
  type TreeWikiLink,
} from './tree';
import type { WikiShelf, WikiTarget } from './wiki-main';

const HOME = '/Users/u';
const NO_STARS: ReadonlySet<string> = new Set();
// Skill links `w:<name>` name a skill of the plugin `wigley@w`.
const LINK_PREFIXES = { 'w:': 'wigley@w' };

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
    headings: [],
    links: [],
    lastLoaded: null,
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
  return child(
    buildTree(entries, homeDir, paths, NO_STARS, 'followups'),
    'Mine',
  ).children;
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

const FEATURES_ROOT = '/Users/u/wigley-features/r';

// Repo `r`'s feature home: `b-feat`'s task, `a-feat`'s design (loaded at
// `designLoaded`) and checklist, and a follow-up.
function featureHomeEntries(designLoaded: string | null = null): IndexEntry[] {
  const root = FEATURES_ROOT;
  const feature = { source: 'features', repo: 'r', root } as const;
  return [
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
      lastLoaded: designLoaded,
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
}

describe('buildTree', () => {
  it.each([
    {
      entries: [
        entry({ path: '/Users/u/.claude/rules/a.md' }),
        thirdPartyPluginSkill('v@m'),
      ],
      roots: ['owner:mine', 'owner:third-party'],
    },
    {
      entries: [entry({ path: '/Users/u/.claude/rules/b.md' })],
      roots: ['owner:mine'],
    },
    { entries: [thirdPartyPluginSkill('w@n')], roots: ['owner:third-party'] },
  ])(
    'buildTree_OwnerRoots_OnlyOwnersWithEntries $roots',
    ({ entries, roots }) => {
      expect(
        ids(buildTree(entries, HOME, posixPaths, NO_STARS, 'followups')),
      ).toEqual(roots);
    },
  );

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
    const scratch = child(mine, 'Scratch');
    expect(scratch.id).toBe('source:scratch');
    expect(titles(scratch.children)).toEqual(['Rules']);
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
    const roots = buildTree(
      marketplaceRepo(),
      HOME,
      posixPaths,
      NO_STARS,
      'followups',
    );
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
      buildTree(entries, HOME, posixPaths, NO_STARS, 'followups'),
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
    const first = buildTree(
      twoClonesCarryingKey(),
      HOME,
      posixPaths,
      NO_STARS,
      'followups',
    );
    const second = buildTree(
      twoClonesCarryingKey(),
      HOME,
      posixPaths,
      NO_STARS,
      'followups',
    );
    const starred = new Set([installedOnlySkill().id]);
    const firstStarred = buildTree(
      twoClonesCarryingKey(),
      HOME,
      posixPaths,
      starred,
      'followups',
    );
    const secondStarred = buildTree(
      twoClonesCarryingKey(),
      HOME,
      posixPaths,
      starred,
      'followups',
    );

    expect(flattenedIds(second)).toEqual(flattenedIds(first));
    expect(flattenedIds(secondStarred)).toEqual(flattenedIds(firstStarred));
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
    const root = FEATURES_ROOT;
    const entries = featureHomeEntries();

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

  it('buildTree_StarredDoc_StarredRootAboveMine', () => {
    const rule = '/Users/u/.claude/rules/a.md';

    const roots = buildTree(
      [entry({ path: rule })],
      HOME,
      posixPaths,
      new Set([rule]),
      'followups',
    );

    expect(titles(roots)).toEqual(['Starred', 'Mine']);
    expect(ids(roots)).toEqual(['owner:starred', 'owner:mine']);
    const starred = child(roots, 'Starred');
    expect(starred.role).toEqual({ type: 'other' });
    expect(ids(starred.children)).toEqual([
      'owner:starred/entry:/Users/u/.claude/rules/a.md',
    ]);
    expect(titles(starred.children)).toEqual(['a.md']);
  });

  it('buildTree_StarredDoc_StaysInItsPlace', () => {
    const rule = '/Users/u/.claude/rules/a.md';

    const roots = buildTree(
      [entry({ path: rule })],
      HOME,
      posixPaths,
      new Set([rule]),
      'followups',
    );

    const rules = child(
      child(child(roots, 'Mine').children, 'Global').children,
      'Rules',
    );
    expect(ids(rules.children)).toEqual(['entry:/Users/u/.claude/rules/a.md']);
  });

  it('isStarredLeafId_StarredAndUsualLeaves_TrueOnlyForStarred', () => {
    const rule = '/Users/u/.claude/rules/a.md';
    const roots = buildTree(
      [entry({ path: rule })],
      HOME,
      posixPaths,
      new Set([rule]),
      'followups',
    );

    const [starredLeaf] = child(roots, 'Starred').children;
    const [usualLeaf] = child(
      child(child(roots, 'Mine').children, 'Global').children,
      'Rules',
    ).children;
    expect(isStarredLeafId(starredLeaf.id)).toBe(true);
    expect(isStarredLeafId(usualLeaf.id)).toBe(false);
  });

  it('buildTree_StarredIdNotInIndex_NoStarredRoot', () => {
    const entries = [entry({ path: '/Users/u/.claude/rules/a.md' })];

    const roots = buildTree(
      entries,
      HOME,
      posixPaths,
      new Set(['/Users/u/gone.md']),
      'followups',
    );

    expect(titles(roots)).toEqual(['Mine']);
  });

  it('buildTree_StarredThirdParty_Listed', () => {
    const skill = thirdPartyPluginSkill('v@m');
    const entries = [entry({ path: '/Users/u/.claude/rules/a.md' }), skill];

    const roots = buildTree(
      entries,
      HOME,
      posixPaths,
      new Set([skill.id]),
      'followups',
    );

    expect(titles(roots)).toEqual(['Starred', 'Mine', 'Third-party']);
  });

  it('buildTree_Starred_NewestLoadedFirstThenByTitle', () => {
    const entries = [
      entry({
        path: '/Users/u/.claude/rules/b.md',
        lastLoaded: '2026-10-20T10:00:00Z',
      }),
      entry({ path: '/Users/u/.claude/rules/d.md' }),
      entry({
        path: '/Users/u/.claude/rules/a.md',
        lastLoaded: '2026-10-26T09:00:00.500Z',
      }),
      entry({ path: '/Users/u/.claude/rules/c.md' }),
    ];
    const starred = new Set(entries.map((starredEntry) => starredEntry.id));

    const roots = buildTree(entries, HOME, posixPaths, starred, 'followups');

    expect(titles(child(roots, 'Starred').children)).toEqual([
      'a.md',
      'b.md',
      'c.md',
      'd.md',
    ]);
  });

  it('buildTree_KindGroup_NewestLoadedFirstThenNeverByTitle', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/rules/beta.md' }),
      entry({
        path: '/Users/u/.claude/rules/mid.md',
        lastLoaded: '2026-10-25T10:00:00Z',
      }),
      entry({ path: '/Users/u/.claude/rules/alpha.md' }),
      entry({
        path: '/Users/u/.claude/rules/zeta.md',
        lastLoaded: '2026-10-26T10:00:00.000Z',
      }),
    ];

    const rules = child(
      child(mineChildren(entries), 'Global').children,
      'Rules',
    );

    expect(titles(rules.children)).toEqual([
      'zeta.md',
      'mid.md',
      'alpha.md',
      'beta.md',
    ]);
  });

  it('buildTree_SameInstant_ByTitle', () => {
    const entries = [
      entry({
        path: '/Users/u/.claude/rules/b.md',
        lastLoaded: '2026-10-26T10:00:00Z',
      }),
      entry({
        path: '/Users/u/.claude/rules/a.md',
        lastLoaded: '2026-10-26T10:00:00.000Z',
      }),
    ];

    const rules = child(
      child(mineChildren(entries), 'Global').children,
      'Rules',
    );

    expect(titles(rules.children)).toEqual(['a.md', 'b.md']);
  });

  it('buildTree_SkillGroup_SortsByNewestFile', () => {
    const skillB = '/Users/u/.claude/skills/b/SKILL.md';
    const entries = [
      entry({
        path: '/Users/u/.claude/skills/a/SKILL.md',
        kind: 'skill',
        title: 'a',
        lastLoaded: '2026-10-20T10:00:00Z',
      }),
      entry({ path: skillB, kind: 'skill', title: 'b' }),
      entry({
        path: '/Users/u/.claude/skills/b/x.md',
        kind: 'skill-file',
        title: 'x.md',
        meta: { skill: skillB },
      }),
      entry({
        path: '/Users/u/.claude/skills/b/y.md',
        kind: 'skill-file',
        title: 'y.md',
        meta: { skill: skillB },
        lastLoaded: '2026-10-26T10:00:00Z',
      }),
    ];

    const skills = child(
      child(mineChildren(entries), 'Global').children,
      'Skills',
    );

    expect(titles(skills.children)).toEqual(['b', 'a']);
    expect(titles(child(skills.children, 'b').children)).toEqual([
      'SKILL.md',
      'y.md',
      'x.md',
    ]);
  });

  it('buildTree_FeatureFolder_LoadedFirstNeverInKindOrder', () => {
    const root = FEATURES_ROOT;
    const entries = featureHomeEntries('2026-10-26T10:00:00Z');

    const features = child(
      child(mineChildren(entries), 'r').children,
      'Features',
    );

    expect(ids(child(features.children, 'a-feat').children)).toEqual([
      `entry:${root}/a-feat/design.md`,
      `entry:${root}/a-feat/checklist.md`,
    ]);
  });

  it('buildTree_LoadedRepoDocs_GroupsKeepPlace', () => {
    const entries = [
      entry({ path: '/Users/u/.claude/rules/a.md' }),
      entry({
        path: '/Users/u/dev/r/AGENTS.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
        lastLoaded: '2026-10-26T10:00:00Z',
      }),
    ];

    expect(titles(mineChildren(entries))).toEqual(['Global', 'r']);
  });
});

describe('featureSlug', () => {
  it.each<{
    given: string;
    path: string;
    meta: IndexEntry['meta'];
    areaFolder: string | null;
    slug: string | null;
  }>([
    {
      given: 'a feature folder',
      path: 'a-feat/design.md',
      meta: {},
      areaFolder: 'followups',
      slug: 'a-feat',
    },
    {
      given: 'meta.feature over the folder',
      path: 'a-feat/01-task.md',
      meta: { feature: 'b-feat' },
      areaFolder: 'followups',
      slug: 'b-feat',
    },
    {
      given: 'the area folder',
      path: 'followups/ui.md',
      meta: {},
      areaFolder: 'followups',
      slug: null,
    },
    {
      given: 'a custom area folder',
      path: 'todo/ui.md',
      meta: {},
      areaFolder: 'todo',
      slug: null,
    },
    {
      given: 'followups/ under a custom area folder',
      path: 'followups/ui.md',
      meta: {},
      areaFolder: 'todo',
      slug: 'followups',
    },
    {
      given: 'a file at the root',
      path: 'followups.md',
      meta: {},
      areaFolder: 'followups',
      slug: null,
    },
  ])(
    'featureSlug gives $slug for $given',
    ({ path, meta, areaFolder, slug }) => {
      const featureEntry = entry({
        path: `${FEATURES_ROOT}/${path}`,
        source: 'features',
        repo: 'r',
        root: FEATURES_ROOT,
        meta,
      });

      expect(featureSlug(featureEntry, posixPaths, areaFolder)).toBe(slug);
    },
  );
});

describe('findSkillEntry', () => {
  const skillOf = (path: string, plugin: string) =>
    entry({ path, kind: 'skill', title: 'make', plugin });

  it('findSkillEntry_ExactKey_Found', () => {
    const entries = [
      skillOf('/x/make/SKILL.md', 'wigley@x'),
      skillOf('/w/make/SKILL.md', 'wigley@w'),
    ];

    expect(findSkillEntry('make', 'wigley@w', entries)?.path).toBe(
      '/w/make/SKILL.md',
    );
  });

  it('findSkillEntry_OtherKeySameName_NotFound', () => {
    const entries = [skillOf('/x/make/SKILL.md', 'wigley@x')];

    expect(findSkillEntry('make', 'wigley@w', entries)).toBeNull();
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

describe('buildWikiTree', () => {
  const MAIN = '/dev/agents/wiki';
  const MAIN_FILE = `${MAIN}/Main.md`;
  const SHELF_ID = 'shelf:Shelf A';
  const AT_A = '/dev/agents/a.md';

  function shelfWith(target: WikiTarget): WikiShelf[] {
    const items = [{ type: 'page' as const, title: 'Link text', target }];
    return [{ title: 'Shelf A', items }];
  }

  function onlyChild(tree: readonly TreeNode[]): TreeNode {
    const [shelf] = tree;
    if (shelf.type !== 'group') {
      throw new Error(`${shelf.id} is no group`);
    }
    return shelf.children[0];
  }

  function leafTo(entryId: string): TreeLeaf {
    return {
      type: 'entry',
      id: `entry:${entryId}`,
      title: 'Link text',
      entryId,
    };
  }

  function danglingTo(target: WikiTarget): TreeWikiLink {
    return {
      type: 'wikiLink',
      id: `${SHELF_ID}/link:0`,
      title: 'Link text',
      target,
      count: null,
      isDangling: true,
    };
  }

  const makeSkill = (path: string, plugin: string) =>
    entry({ path, kind: 'skill', title: 'make', plugin });
  const SKILL_MAKE: WikiTarget = { type: 'skill', prefix: 'w:', name: 'make' };
  const UNMAPPED_MAKE: WikiTarget = {
    type: 'skill',
    prefix: 'other:',
    name: 'make',
  };
  const pathTo = (path: string): WikiTarget => ({ type: 'path', path });

  it.each<{
    given: string;
    target: WikiTarget;
    entries: IndexEntry[];
    expected: TreeNode;
  }>([
    {
      given: '~/ through walked',
      target: pathTo('~/agents/a.md'),
      entries: [entry({ path: AT_A, walked: ['/Users/u/agents/a.md'] })],
      expected: leafTo(AT_A),
    },
    {
      given: 'relative to the main folder',
      target: pathTo('../a.md'),
      entries: [entry({ path: AT_A })],
      expected: leafTo(AT_A),
    },
    {
      given: 'relative, fragment dropped',
      target: pathTo('../a.md#part'),
      entries: [entry({ path: AT_A })],
      expected: leafTo(AT_A),
    },
    {
      given: 'absolute',
      target: pathTo(AT_A),
      entries: [entry({ path: AT_A })],
      expected: leafTo(AT_A),
    },
    {
      given: 'real path beats a walked path',
      target: pathTo(AT_A),
      entries: [
        entry({ path: '/x/b.md', walked: [AT_A] }),
        entry({ path: AT_A }),
      ],
      expected: leafTo(AT_A),
    },
    {
      given: 'two walking entries: code-unit order, whatever the index order',
      target: pathTo(AT_A),
      entries: [
        entry({ path: '/z/a.md', walked: [AT_A] }),
        entry({ path: '/b/a.md', walked: [AT_A] }),
      ],
      expected: leafTo('/b/a.md'),
    },
    {
      given: 'skill of the plugin its prefix maps',
      target: SKILL_MAKE,
      entries: [
        makeSkill('/m/make/SKILL.md', 'ng@n'),
        makeSkill('/w/make/SKILL.md', 'wigley@w'),
      ],
      expected: leafTo('/w/make/SKILL.md'),
    },
    {
      given: 'skill: clone before an install',
      target: SKILL_MAKE,
      entries: [
        { ...makeSkill('/i/make/SKILL.md', 'wigley@w'), source: 'plugin' },
        { ...makeSkill('/w/make/SKILL.md', 'wigley@w'), source: 'repo' },
      ],
      expected: leafTo('/w/make/SKILL.md'),
    },
    {
      given: "skill: the user's own before a clone of a third party's",
      target: SKILL_MAKE,
      entries: [
        {
          ...makeSkill('/a/make/SKILL.md', 'wigley@w'),
          owner: 'third-party',
          source: 'repo',
        },
        { ...makeSkill('/w/make/SKILL.md', 'wigley@w'), source: 'plugin' },
      ],
      expected: leafTo('/w/make/SKILL.md'),
    },
    {
      given: 'skill of another plugin only',
      target: SKILL_MAKE,
      entries: [makeSkill('/m/make/SKILL.md', 'ng@n')],
      expected: danglingTo(SKILL_MAKE),
    },
    {
      given: 'skill of a same-named plugin in another marketplace',
      target: SKILL_MAKE,
      entries: [makeSkill('/x/make/SKILL.md', 'wigley@x')],
      expected: danglingTo(SKILL_MAKE),
    },
    {
      given: 'skill link whose prefix maps no plugin',
      target: UNMAPPED_MAKE,
      entries: [makeSkill('/w/make/SKILL.md', 'wigley@w')],
      expected: danglingTo(UNMAPPED_MAKE),
    },
    {
      given: 'no entry',
      target: pathTo('../gone.md'),
      entries: [],
      expected: danglingTo(pathTo('../gone.md')),
    },
    {
      given: 'only a follow-up item at that path',
      target: pathTo('../f.md'),
      entries: [
        entry({
          id: '/dev/agents/f.md#L3',
          path: '/dev/agents/f.md',
          line: 3,
        }),
      ],
      expected: danglingTo(pathTo('../f.md')),
    },
    {
      given: 'URL',
      target: pathTo('https://x.test'),
      entries: [],
      expected: danglingTo(pathTo('https://x.test')),
    },
    {
      given: 'empty path',
      target: pathTo(''),
      entries: [entry({ path: MAIN_FILE })],
      expected: danglingTo(pathTo('')),
    },
  ])('buildWikiTree_PageTarget ($given)', ({ target, entries, expected }) => {
    const tree = buildWikiTree(
      shelfWith(target),
      entries,
      MAIN_FILE,
      HOME,
      posixPaths,
      LINK_PREFIXES,
    );

    expect(onlyChild(tree)).toEqual(expected);
  });

  it('buildWikiTree_WindowsPath_ComparedAsSamePath', () => {
    const tree = buildWikiTree(
      shelfWith(pathTo('C:\\Dev\\a.md')),
      [entry({ path: 'c:\\dev\\a.md' })],
      'C:\\Dev\\wiki\\Main.md',
      'C:\\Users\\u',
      windowsPaths,
      LINK_PREFIXES,
    );

    expect(onlyChild(tree)).toEqual(leafTo('c:\\dev\\a.md'));
  });

  it.each<{ target: WikiTarget; count: number | null }>([
    { target: { type: 'kind', kind: 'skill' }, count: 2 },
    { target: { type: 'kind', kind: 'followup' }, count: 2 },
    { target: { type: 'kind', kind: 'made-up' }, count: 0 },
    { target: { type: 'owner', owner: 'third-party' }, count: 1 },
    { target: { type: 'all' }, count: null },
  ])('buildWikiTree_WikiLinkCount ($target)', ({ target, count }) => {
    const entries = [
      entry({ path: '/s/a/SKILL.md', kind: 'skill' }),
      entry({ path: '/s/b/SKILL.md', kind: 'skill' }),
      entry({ path: '/t/c/SKILL.md', kind: 'skill', owner: 'third-party' }),
      entry({ path: '/h.json', kind: 'hook' }),
      entry({ id: '/f.md#L1', path: '/f.md', kind: 'followup', line: 1 }),
      entry({ id: '/f.md#L2', path: '/f.md', kind: 'followup', line: 2 }),
    ];

    const tree = buildWikiTree(
      shelfWith(target),
      entries,
      MAIN_FILE,
      HOME,
      posixPaths,
      LINK_PREFIXES,
    );

    expect(onlyChild(tree)).toEqual({
      ...danglingTo(target),
      count,
      isDangling: false,
    });
  });

  it('buildWikiTree_Shape', () => {
    const page = {
      type: 'page' as const,
      title: 'A',
      target: pathTo('/a.md'),
    };
    const kindLink = {
      type: 'page' as const,
      title: 'Skills',
      target: { type: 'kind' as const, kind: 'skill' },
    };
    const shelves: WikiShelf[] = [
      {
        title: 'S',
        items: [{ type: 'label', title: 'L' }, page, kindLink],
      },
      { title: 'S', items: [page] },
      { title: 'Empty', items: [] },
    ];

    const tree = buildWikiTree(
      shelves,
      [entry({ path: '/a.md' })],
      MAIN_FILE,
      HOME,
      posixPaths,
      LINK_PREFIXES,
    );

    const groups = tree.filter((node) => node.type === 'group');
    expect(
      groups.map(({ id, folder, children }) => ({
        id,
        folder,
        children: ids(children),
      })),
    ).toEqual([
      {
        id: 'shelf:S',
        folder: '/',
        children: ['shelf:S/label:0', 'entry:/a.md', 'shelf:S/link:2'],
      },
      { id: 'shelf:S#2', folder: '/', children: ['shelf:S#2/0/entry:/a.md'] },
      { id: 'shelf:Empty', folder: null, children: [] },
    ]);
  });

  it('buildWikiFilterTree_MineOnly', () => {
    const tree = buildWikiFilterTree(
      [
        entry({ path: '/mine.md' }),
        entry({ path: '/theirs/SKILL.md', owner: 'third-party' }),
      ],
      HOME,
      posixPaths,
      'followups',
    );

    expect(ids(tree)).toEqual([MINE_ROOT_ID]);
    const shown = flattenedIds(tree);
    expect(shown).toContain('entry:/mine.md');
    expect(shown).not.toContain('entry:/theirs/SKILL.md');
  });
});
