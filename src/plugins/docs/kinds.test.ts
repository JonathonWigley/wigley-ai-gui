import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import type { CreatePlace, IndexEntry } from './contract';
import { createTarget, nameProblem, placesFor, skillFolder } from './kinds';

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
    title: posixPaths.base(overrides.path),
    meta: {},
    walked: [],
    ...overrides,
  };
}

function place(folder: string, source: CreatePlace['source']): CreatePlace {
  return { title: folder, folder, source };
}

describe('placesFor', () => {
  it('placesFor_Skill_SkillsFolderOfEachEntry', () => {
    const entries = [
      entry({
        path: '/Users/u/dev/r/.claude/skills/c/SKILL.md',
        kind: 'skill',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
      }),
      entry({ path: '/Users/u/.claude/skills/a/SKILL.md', kind: 'skill' }),
      entry({ path: '/Users/u/.claude/skills/b/SKILL.md', kind: 'skill' }),
    ];

    expect(placesFor('skill', entries, HOME, posixPaths)).toEqual([
      {
        title: 'Global · ~/.claude/skills',
        folder: '/Users/u/.claude/skills',
        source: 'global',
      },
      {
        title: 'r · ~/dev/r/.claude/skills',
        folder: '/Users/u/dev/r/.claude/skills',
        source: 'repo',
      },
    ]);
  });

  it('placesFor_GlobalInstructions_OnlyWigleyAgentsFolder', () => {
    const entries = [
      '/Users/u/.claude/CLAUDE.md',
      '/Users/u/.claude-personal/CLAUDE.md',
      '/Users/u/.codex/AGENTS.md',
      '/Users/u/.agents/AGENTS.local.md',
      '/Users/u/AGENTS.md',
      '/Users/u/notes/imported.md',
      '/Users/u/wigley-agents/AGENTS.md',
      '/Users/u/wigley-agents/Unity.md',
    ].map((path) => entry({ path, kind: 'instructions' }));

    expect(placesFor('instructions', entries, HOME, posixPaths)).toEqual([
      {
        title: 'Global · ~/wigley-agents',
        folder: '/Users/u/wigley-agents',
        source: 'global',
      },
    ]);
  });

  it('placesFor_GlobalReferenceInWigleyAgents_NoPlace', () => {
    const entries = ['/Users/u/wigley-agents/decisions.md'].map((path) =>
      entry({ path, kind: 'reference' }),
    );

    expect(placesFor('reference', entries, HOME, posixPaths)).toEqual([]);
  });

  it('placesFor_ProjectReference_EntryFolder', () => {
    const entries = [
      entry({
        path: '/Users/u/dev/r/docs/notes.md',
        kind: 'reference',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
      }),
    ];

    expect(placesFor('reference', entries, HOME, posixPaths)).toEqual([
      {
        title: 'r · ~/dev/r/docs',
        folder: '/Users/u/dev/r/docs',
        source: 'repo',
      },
    ]);
  });

  it('placesFor_GlobalInstructionsLinkedClone_CloneFolder', () => {
    const entries = [
      entry({
        path: '/Users/u/dev/personal/wigley-agents/AGENTS.md',
        kind: 'instructions',
      }),
    ];

    expect(
      placesFor('instructions', entries, HOME, posixPaths).map((p) => p.folder),
    ).toEqual(['/Users/u/dev/personal/wigley-agents']);
  });

  it('placesFor_GlobalReferenceInLinkedClone_NoPlace', () => {
    const entries = [
      entry({
        path: '/Users/u/dev/personal/wigley-agents/decisions.md',
        kind: 'reference',
      }),
    ];

    expect(placesFor('reference', entries, HOME, posixPaths)).toEqual([]);
  });

  it('placesFor_PluginEntries_NoPlace', () => {
    const entries = [
      entry({
        path: '/Users/u/.claude/plugins/cache/m/p/1/skills/s/SKILL.md',
        kind: 'skill',
        source: 'plugin',
        plugin: 'p@m',
        root: '/Users/u/.claude/plugins/cache/m/p/1',
      }),
    ];

    expect(placesFor('skill', entries, HOME, posixPaths)).toEqual([]);
  });

  it('placesFor_UnknownSource_NoPlace', () => {
    const entries = [
      entry({
        path: '/Users/u/scratch/skills/s/SKILL.md',
        kind: 'skill',
        source: 'scratch',
        root: '/Users/u/scratch',
      }),
    ];

    expect(placesFor('skill', entries, HOME, posixPaths)).toEqual([]);
  });

  it('placesFor_InstructionsInDotClaude_DropsDotClaude', () => {
    const entries = [
      entry({
        path: '/Users/u/dev/r/.claude/CLAUDE.md',
        kind: 'instructions',
        source: 'repo',
        repo: 'r',
        root: '/Users/u/dev/r',
      }),
    ];

    expect(
      placesFor('instructions', entries, HOME, posixPaths).map((p) => p.folder),
    ).toEqual(['/Users/u/dev/r']);
  });

  it('placesFor_Followup_OnlyFollowupsMdFiles', () => {
    const root = '/Users/u/wigley-features/r';
    const feature = {
      kind: 'followup',
      source: 'features',
      repo: 'r',
      root,
    } as const;
    const entries = [
      entry({
        ...feature,
        path: `${root}/followups.md`,
        id: `${root}/followups.md#L3`,
        line: 3,
      }),
      entry({
        ...feature,
        path: `${root}/followups/ui.md`,
        id: `${root}/followups/ui.md#L1`,
        line: 1,
      }),
    ];

    expect(placesFor('followup', entries, HOME, posixPaths)).toEqual([
      {
        title: 'r features · ~/wigley-features/r',
        folder: root,
        source: 'features',
      },
    ]);
  });
});

describe('skillFolder', () => {
  it('skillFolder_SkillMdUnderSkills_Folder', () => {
    expect(skillFolder('/r/.claude/skills/tidy/SKILL.md', posixPaths)).toBe(
      '/r/.claude/skills/tidy',
    );
    expect(skillFolder('/r/skills/x/README.md', posixPaths)).toBe(null);
    expect(skillFolder('/r/docs/x/SKILL.md', posixPaths)).toBe(null);
  });
});

describe('createTarget', () => {
  it('createTarget_Skill_FolderAndFrontmatter', () => {
    const target = createTarget(
      'skill',
      place('/Users/u/.claude/skills', 'global'),
      'tidy',
      posixPaths,
    );

    expect(target.path).toBe('/Users/u/.claude/skills/tidy/SKILL.md');
    expect(target.contents(null)).toEqual({
      text: '---\nname: tidy\ndescription: \n---\n\n# tidy\n\n',
      line: 3,
    });
    expect(target.appends).toBe(false);
  });

  it('createTarget_InstructionsGlobal_FileInFolder', () => {
    const global = createTarget(
      'instructions',
      place('/Users/u/wigley-agents', 'global'),
      'Unity',
      posixPaths,
    );
    const repo = createTarget(
      'instructions',
      place('/Users/u/dev/r', 'repo'),
      'web',
      posixPaths,
    );

    expect(global.path).toBe('/Users/u/wigley-agents/Unity.md');
    expect(repo.path).toBe('/Users/u/dev/r/web/AGENTS.md');
  });

  it('createTarget_Followup_AppendsItem', () => {
    const target = createTarget(
      'followup',
      place('/Users/u/wigley-features/r', 'features'),
      'new',
      posixPaths,
    );

    expect(target.path).toBe('/Users/u/wigley-features/r/followups.md');
    expect(target.contents('# F\n- **a** — x')).toEqual({
      text: '# F\n- **a** — x\n- **new** — \n',
      line: 3,
    });
    expect(target.contents('')).toEqual({ text: '- **new** — \n', line: 1 });
    expect(target.contents(null)).toEqual({ text: '- **new** — \n', line: 1 });
    expect(target.appends).toBe(true);
  });
});

describe('nameProblem', () => {
  it('nameProblem_Rules_PinnedMessages', () => {
    expect(nameProblem('skill', ' ')).toBe('A name is required');
    expect(nameProblem('skill', 'My Skill')).toBe(
      'A skill name is lowercase letters, digits and hyphens',
    );
    expect(nameProblem('rule', 'a/b')).toBe(
      'A name holds no / or \\ and does not start with .',
    );
    expect(nameProblem('rule', 'a\\b')).toBe(
      'A name holds no / or \\ and does not start with .',
    );
    expect(nameProblem('rule', '.x')).toBe(
      'A name holds no / or \\ and does not start with .',
    );
    expect(nameProblem('followup', 'a\nb')).toBe(
      'A follow-up title is one line',
    );
    expect(nameProblem('rule', 'style')).toBe(null);
  });
});

describe('kinds on Windows', () => {
  it('createTarget_WindowsSkill_NativePath', () => {
    const target = createTarget(
      'skill',
      place('C:\\Users\\u\\dev\\r\\.claude\\skills', 'repo'),
      'demo',
      windowsPaths,
    );

    expect(target.path).toBe(
      'C:\\Users\\u\\dev\\r\\.claude\\skills\\demo\\SKILL.md',
    );
  });

  it('skillFolder_WindowsSkillMd_Folder', () => {
    expect(
      skillFolder(
        'C:\\Users\\u\\dev\\r\\.claude\\skills\\demo\\SKILL.md',
        windowsPaths,
      ),
    ).toBe('C:\\Users\\u\\dev\\r\\.claude\\skills\\demo');
  });

  it('placesFor_WindowsGlobalInstructions_TildeTitle', () => {
    const entries = [
      entry({
        path: 'C:\\Users\\u\\wigley-agents\\AGENTS.md',
        kind: 'instructions',
        title: 'AGENTS.md',
      }),
    ];

    expect(
      placesFor('instructions', entries, 'C:\\Users\\u', windowsPaths),
    ).toEqual([
      {
        title: 'Global · ~\\wigley-agents',
        folder: 'C:\\Users\\u\\wigley-agents',
        source: 'global',
      },
    ]);
  });
});
