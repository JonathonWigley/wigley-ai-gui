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
    repo: null,
    root: null,
    plugin: null,
    line: null,
    title: posixPaths.base(overrides.path),
    meta: {},
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
    expect(refusal('/Users/u/x.md')).toBe(
      'Refused: /Users/u/x.md is outside the indexed folders',
    );
    expect(refusal('/Users/u/notes/other.md')).toBe(
      'Refused: /Users/u/notes/other.md is outside the indexed folders',
    );
  });

  it('changeRefusal_UnlistedCachedVersion_RefusedNamingCache', () => {
    const target = '/Users/u/.claude/plugins/cache/m/p/0/skills/s/SKILL.md';

    expect(refusal(target)).toBe(
      `Refused: ${target} is inside the plugin cache /Users/u/.claude/plugins/cache`,
    );
  });

  it('changeRefusal_InsideCodexCache_Refused', () => {
    const target = '/Users/u/.codex/plugins/cache/m/p/1/SKILL.md';

    expect(refusal(target)).toBe(
      `Refused: ${target} is inside the plugin cache /Users/u/.codex/plugins/cache`,
    );
  });

  it('changeRefusal_InsidePluginCache_RefusedNamingPlugin', () => {
    expect(refusal(PLUGIN_SKILL)).toBe(
      `Refused: ${PLUGIN_SKILL} is inside the plugin cache of p@m`,
    );
  });

  it('changeRefusal_Outside_RefusedNamingPath', () => {
    expect(refusal('/Users/u/Desktop/x.md')).toBe(
      'Refused: /Users/u/Desktop/x.md is outside the indexed folders',
    );
  });
});

describe('isIndexedPath', () => {
  it('isIndexedPath_PluginFile_Openable', () => {
    expect(isIndexedPath(PLUGIN_SKILL, ENTRIES, posixPaths)).toBe(true);
    expect(isIndexedPath('/Users/u/Desktop/x.md', ENTRIES, posixPaths)).toBe(
      false,
    );
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
  const NO_FOLDERS: GuardFolders = { globalDocFolders: [], pluginCaches: [] };
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
    ).toBe(
      'Refused: C:\\Users\\u\\dev\\rx\\a.md is outside the indexed folders',
    );
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
