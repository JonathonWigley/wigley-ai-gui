import { describe, expect, it } from 'vitest';
import type { IndexEntry } from './contract';
import { baseName } from './doc-paths';
import { changeRefusal, isIndexedPath } from './path-guard';

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
const CONFIG_DIRS = ['/Users/u/.claude-personal'];

function refusal(target: string): string | null {
  return changeRefusal(target, ENTRIES, CONFIG_DIRS);
}

describe('changeRefusal', () => {
  it('changeRefusal_InsideRepoRoot_Allowed', () => {
    expect(refusal('/Users/u/dev/r/new/AGENTS.md')).toBe(null);
  });

  it('changeRefusal_InsideGlobalEntryFolder_Allowed', () => {
    expect(refusal('/Users/u/.claude/rules/x.md')).toBe(null);
  });

  it('changeRefusal_InsideConfigDir_Allowed', () => {
    expect(refusal('/Users/u/.claude-personal/CLAUDE.md')).toBe(null);
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
    expect(isIndexedPath(PLUGIN_SKILL, ENTRIES)).toBe(true);
    expect(isIndexedPath('/Users/u/Desktop/x.md', ENTRIES)).toBe(false);
  });
});
