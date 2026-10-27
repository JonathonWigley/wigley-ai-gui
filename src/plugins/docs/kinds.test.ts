import { describe, expect, it } from 'vitest';
import { parseFollowups } from '../../shared/followups/followup-file';
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

function place(folder: string, source: CreatePlace['source']): CreatePlace {
  return { title: folder, folder, source };
}

function itemFields(text: string, title: string) {
  const item = parseFollowups(text).items.find((each) => each.title === title);
  return { oneLine: item?.oneLine, tags: item?.tags };
}

function followupTarget(name: string) {
  return createTarget(
    'followup',
    place('/Users/u/wigley-features/r', 'features'),
    name,
    posixPaths,
  );
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

  it('placesFor_ThirdPartyEntries_NoPlace', () => {
    const entries = [
      entry({
        path: '/Users/u/.claude/skills/synced/anthropic/pdf/SKILL.md',
        kind: 'skill',
        owner: 'third-party',
      }),
      entry({ path: '/Users/u/.claude/skills/a/SKILL.md', kind: 'skill' }),
    ];

    expect(placesFor('skill', entries, HOME, posixPaths)).toEqual([
      {
        title: 'Global · ~/.claude/skills',
        folder: '/Users/u/.claude/skills',
        source: 'global',
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

  it('createTarget_FollowupSectionsFile_AddsContentsLineAndSection', () => {
    const target = followupTarget('Fix the badge');
    const existing = [
      '# Follow-ups — r',
      '',
      '**Contents**',
      '',
      '- **Old** — one',
      '',
      '## Old',
      '',
      'one',
      '',
      '',
    ].join('\n');

    expect(target.path).toBe('/Users/u/wigley-features/r/followups.md');
    expect(target.contents(existing)).toEqual({
      text: [
        '# Follow-ups — r',
        '',
        '**Contents**',
        '',
        '- **Old** — one',
        '- **Fix the badge** — ',
        '',
        '## Old',
        '',
        'one',
        '',
        '## Fix the badge',
        '',
      ].join('\n'),
      line: 6,
    });
    expect(target.appends).toBe(true);
  });

  it('createTarget_FollowupListFile_AppendsItem', () => {
    const target = followupTarget('new');

    expect(target.contents('# F\n- **a** — x\n')).toEqual({
      text: '# F\n- **a** — x\n- **new** — \n',
      line: 3,
    });
  });

  it('createTarget_Followup_OpenDashReadsAnEmptyOneLine', () => {
    const target = followupTarget('new');
    const sectioned = target.contents(null).text;
    const listed = target.contents('# F\n- **a** — x\n').text;

    expect(itemFields(sectioned, 'new')).toEqual({ oneLine: '', tags: [] });
    expect(itemFields(listed, 'new')).toEqual({ oneLine: '', tags: [] });
  });

  it('createTarget_FollowupMissingFile_StartsNewFileNamedForFolder', () => {
    const target = followupTarget('new');
    const created = {
      text: [
        '# Follow-ups — r',
        '',
        '**Contents**',
        '',
        '- **new** — ',
        '',
        'Deferred work for the r repo. Each entry is one `##` section and stands on its own as a task brief.',
        '',
        '## new',
        '',
      ].join('\n'),
      line: 5,
    };

    expect(target.contents(null)).toEqual(created);
    expect(target.contents('')).toEqual(created);
    expect(target.contents('\n  \n')).toEqual(created);
  });

  it('createTarget_FollowupMissingInRepoFile_NamesFileForClone', () => {
    const target = createTarget(
      'followup',
      place('/Users/u/dev/game/docs/features', 'features'),
      'new',
      posixPaths,
    );

    expect(target.contents(null).text.split('\n')[0]).toBe(
      '# Follow-ups — game',
    );
  });

  it('createTarget_FollowupTitleTaken_Throws', () => {
    const target = followupTarget('Old');
    const existing = '# F\n\n**Contents**\n\n- **Old**\n\n## Old\n';

    expect(() => target.contents(existing)).toThrow(
      'A follow-up titled Old already exists',
    );
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
    expect(nameProblem('followup', 'Wait:')).toBe(
      'A follow-up title does not end with :',
    );
    expect(nameProblem('followup', 'Fix it')).toBe(null);
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
