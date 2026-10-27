import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import type { IndexEntry } from './contract';
import { changeRefusal, type GuardFolders, isIndexedPath } from './path-guard';

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
    lastLoaded: null,
    ...overrides,
  };
}

const PLUGIN_SKILL = '/Users/u/.claude/plugins/cache/m/p/1/skills/s/SKILL.md';
const ENTRIES = [
  entry({
    path: '/Users/u/dev/r/AGENTS.md',
    kind: 'instructions',
    source: 'repo',
    repo: 'r',
    root: '/Users/u/dev/r',
  }),
  entry({ path: '/Users/u/.claude/CLAUDE.md', kind: 'instructions' }),
  entry({
    path: PLUGIN_SKILL,
    kind: 'skill',
    source: 'plugin',
    plugin: 'p@m',
    root: '/Users/u/.claude/plugins/cache/m/p/1',
  }),
];
const THIRD_PARTY_SKILL =
  '/Users/u/.claude/plugins/cache/n/q/2/skills/s/SKILL.md';
const THIRD_PARTY_PLUGIN_ENTRY = entry({
  path: THIRD_PARTY_SKILL,
  kind: 'skill',
  source: 'plugin',
  owner: 'third-party',
  plugin: 'q@n',
  root: '/Users/u/.claude/plugins/cache/n/q/2',
});
const FOLDERS: GuardFolders = {
  globalDocFolders: [
    '/Users/u/.claude',
    '/Users/u/.claude-personal',
    '/Users/u/.codex',
  ],
  pluginCaches: [
    '/Users/u/.claude/plugins/cache',
    '/Users/u/.claude-personal/plugins/cache',
    '/Users/u/.codex/plugins/cache',
  ],
  thirdPartyFolders: [
    '/Users/u/.claude/skills/synced',
    '/Users/u/.claude-personal/skills/synced',
  ],
};

function refusal(target: string): string | null {
  return changeRefusal(target, ENTRIES, FOLDERS, posixPaths);
}

describe('changeRefusal', () => {
  it('changeRefusal_InsideRepoRoot_Allowed', () => {
    expect(refusal('/Users/u/dev/r/new/AGENTS.md')).toBe(null);
  });

  it('changeRefusal_InsideGlobalDocFolder_Allowed', () => {
    expect(refusal('/Users/u/.claude/rules/x.md')).toBe(null);
    expect(refusal('/Users/u/.claude-personal/CLAUDE.md')).toBe(null);
  });

  it('changeRefusal_GlobalEntryOutsideDocFolders_OwnFileOnly', () => {
    const entries = [
      ...ENTRIES,
      entry({ path: '/Users/u/CLAUDE.md', kind: 'instructions' }),
      entry({ path: '/Users/u/notes/imported.md', kind: 'instructions' }),
    ];
    const refusal = (target: string) =>
      changeRefusal(target, entries, FOLDERS, posixPaths);

    expect(refusal('/Users/u/CLAUDE.md')).toBe(null);
    expect(refusal('/Users/u/notes/imported.md')).toBe(null);
    expect(refusal('/Users/u/x.md')).toContain('/Users/u/x.md');
    expect(refusal('/Users/u/notes/other.md')).toContain(
      '/Users/u/notes/other.md',
    );
  });

  it('changeRefusal_InsideUnknownSourceRoot_Refused', () => {
    const entries = [
      entry({
        path: '/Users/u/scratch/a.md',
        source: 'scratch',
        root: '/Users/u/scratch',
      }),
    ];

    expect(
      changeRefusal('/Users/u/scratch/b.md', entries, FOLDERS, posixPaths),
    ).toContain('/Users/u/scratch/b.md');
  });

  it('changeRefusal_ImageInsideFeaturesRoot_Allowed', () => {
    const home = '/Users/u/wigley-features/r';
    const entries = [
      entry({
        path: `${home}/followups.md`,
        kind: 'followup',
        source: 'features',
        repo: 'r',
        root: home,
      }),
    ];

    expect(
      changeRefusal(
        `${home}/followups-images/20261027-140309-fix-chip/1.png`,
        entries,
        FOLDERS,
        posixPaths,
      ),
    ).toBe(null);
  });

  it('changeRefusal_UnknownSourceEntryPath_Allowed', () => {
    const entries = [
      entry({
        path: '/Users/u/scratch/a.md',
        source: 'scratch',
        root: '/Users/u/scratch',
      }),
    ];

    expect(
      changeRefusal('/Users/u/scratch/a.md', entries, FOLDERS, posixPaths),
    ).toBe(null);
  });

  it.each([
    {
      target: '/Users/u/.claude/plugins/cache/m/p/0/skills/s/SKILL.md',
      cache: '/Users/u/.claude/plugins/cache',
    },
    {
      target: '/Users/u/.codex/plugins/cache/m/p/1/SKILL.md',
      cache: '/Users/u/.codex/plugins/cache',
    },
  ])(
    'changeRefusal_UnlistedFileInCache_RefusedNamingCache $cache',
    ({ target, cache }) => {
      expect(refusal(target)).toContain(cache);
    },
  );

  it('changeRefusal_InsidePluginCache_RefusedNamingPlugin', () => {
    expect(refusal(PLUGIN_SKILL)).toContain('p@m');
  });

  it.each([
    '/Users/u/.claude/skills/synced/anthropic/pdf/SKILL.md',
    '/Users/u/.claude-personal/skills/synced/b/x.md',
  ])('changeRefusal_InsideAConfigFoldersSyncedSkills_Refused %s', (target) => {
    expect(refusal(target)).toContain(target);
  });

  it('changeRefusal_ThirdPartyPluginEntry_RefusedNamingPlugin', () => {
    const entries = [...ENTRIES, THIRD_PARTY_PLUGIN_ENTRY];

    expect(
      changeRefusal(THIRD_PARTY_SKILL, entries, FOLDERS, posixPaths),
    ).toContain('q@n');
  });

  it('changeRefusal_ThirdPartyEntryNoPlugin_SyncedSkill', () => {
    const target = '/Users/u/notes/synced.md';
    const entries = [entry({ path: target, owner: 'third-party' })];
    const folders = { ...FOLDERS, thirdPartyFolders: [] };

    expect(changeRefusal(target, entries, folders, posixPaths)).toContain(
      target,
    );
  });

  it('changeRefusal_BesideSynced_Allowed', () => {
    expect(refusal('/Users/u/.claude/skills/mine/SKILL.md')).toBe(null);
    expect(refusal('/Users/u/.claude/skills/syncedx/SKILL.md')).toBe(null);
  });

  it('changeRefusal_Outside_RefusedNamingPath', () => {
    expect(refusal('/Users/u/Desktop/x.md')).toContain('/Users/u/Desktop/x.md');
  });
});

describe('isIndexedPath', () => {
  it('isIndexedPath_PluginFile_Openable', () => {
    expect(isIndexedPath(PLUGIN_SKILL, ENTRIES, posixPaths)).toBe(true);
    expect(isIndexedPath('/Users/u/Desktop/x.md', ENTRIES, posixPaths)).toBe(
      false,
    );
  });

  it('isIndexedPath_ThirdPartyEntry_Openable', () => {
    const entries = [...ENTRIES, THIRD_PARTY_PLUGIN_ENTRY];

    expect(isIndexedPath(THIRD_PARTY_SKILL, entries, posixPaths)).toBe(true);
  });

  it('isIndexedPath_InsideRepoRoot_Openable', () => {
    expect(
      isIndexedPath('/Users/u/dev/r/docs/notes.md', ENTRIES, posixPaths),
    ).toBe(true);
  });

  it('isIndexedPath_BesideGlobalEntry_NotOpenable', () => {
    expect(
      isIndexedPath('/Users/u/.claude/CLAUDE.md', ENTRIES, posixPaths),
    ).toBe(true);
    expect(
      isIndexedPath('/Users/u/.claude/notes.md', ENTRIES, posixPaths),
    ).toBe(false);
  });
});

describe('path guard on Windows', () => {
  const NO_FOLDERS: GuardFolders = {
    globalDocFolders: [],
    pluginCaches: [],
    thirdPartyFolders: [],
  };
  const REPO_ENTRIES = [
    entry({
      path: 'C:\\Users\\u\\dev\\r\\AGENTS.md',
      kind: 'instructions',
      source: 'repo',
      repo: 'r',
      root: 'C:\\Users\\u\\dev\\r',
      title: 'AGENTS.md',
    }),
  ];

  it('changeRefusal_WindowsOtherCase_Allowed', () => {
    expect(
      changeRefusal(
        'c:\\users\\u\\dev\\r\\docs\\notes.md',
        REPO_ENTRIES,
        NO_FOLDERS,
        windowsPaths,
      ),
    ).toBe(null);
  });

  it('changeRefusal_WindowsSiblingPrefix_Refused', () => {
    expect(
      changeRefusal(
        'C:\\Users\\u\\dev\\rx\\a.md',
        REPO_ENTRIES,
        NO_FOLDERS,
        windowsPaths,
      ),
    ).toContain('C:\\Users\\u\\dev\\rx\\a.md');
  });

  it('changeRefusal_WindowsSyncedOtherCase_Refused', () => {
    const folders = {
      ...NO_FOLDERS,
      thirdPartyFolders: ['C:\\Users\\u\\.claude\\skills\\synced'],
    };
    const target = 'c:\\users\\u\\.claude\\skills\\synced\\a\\SKILL.md';

    expect(
      changeRefusal(target, REPO_ENTRIES, folders, windowsPaths),
    ).toContain(target);
  });

  it('isIndexedPath_WindowsOtherCase_Openable', () => {
    const entries = [
      entry({
        path: 'C:\\Users\\u\\.claude\\CLAUDE.md',
        kind: 'instructions',
        title: 'CLAUDE.md',
      }),
    ];

    expect(
      isIndexedPath('c:\\users\\u\\.claude\\claude.md', entries, windowsPaths),
    ).toBe(true);
  });
});
