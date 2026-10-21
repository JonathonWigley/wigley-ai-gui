import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { CreatePlace, IndexEntry } from '../contract';
import { createDocFiles } from './doc-files';

const HOME = '/Users/u';
const ROOT = '/Users/u/dev/r';
const SKILL = '/Users/u/dev/r/.claude/skills/s/SKILL.md';
const PLUGIN_ROOT = '/Users/u/.claude/plugins/cache/m/p/1';

function entry(fields: Partial<IndexEntry> & Pick<IndexEntry, 'path'>) {
  return {
    id: fields.path,
    kind: 'instructions',
    source: 'repo',
    repo: 'r',
    root: ROOT,
    plugin: null,
    line: null,
    title: 't',
    meta: {},
    ...fields,
  } satisfies IndexEntry;
}

const ENTRIES: IndexEntry[] = [
  entry({ path: `${ROOT}/AGENTS.md` }),
  entry({ path: SKILL, kind: 'skill' }),
  entry({
    path: PLUGIN_ROOT,
    kind: 'plugin',
    source: 'plugin',
    repo: null,
    root: PLUGIN_ROOT,
    plugin: 'p@m',
  }),
];

function setUp() {
  const files = createMemoryFiles();
  const logged: string[] = [];
  const docFiles = createDocFiles({
    files,
    homeDir: HOME,
    log: (source, message) => logged.push(`[${source}] ${message}`),
    entries: () => ENTRIES,
  });
  return { files, docFiles, logged };
}

const REPO_PLACE = (folder: string): CreatePlace => ({
  title: `r · ${folder}`,
  folder,
  source: 'repo',
});

describe('write', () => {
  const path = `${ROOT}/a.md`;

  it('write_ExpectedMatches_Writes', async () => {
    const test = setUp();
    await test.files.write(path, 'a');

    const result = await test.docFiles.write(path, 'b', 'a');

    expect(result).toEqual({ type: 'written' });
    expect(await test.files.read(path)).toBe('b');
  });

  it('write_ExpectedDiffers_ReturnsDiskText', async () => {
    const test = setUp();
    await test.files.write(path, 'c');

    const result = await test.docFiles.write(path, 'b', 'a');

    expect(result).toEqual({ type: 'changedOnDisk', diskText: 'c' });
    expect(await test.files.read(path)).toBe('c');
  });

  it('write_NullExpected_Overwrites', async () => {
    const test = setUp();
    await test.files.write(path, 'c');

    const result = await test.docFiles.write(path, 'b', null);

    expect(result).toEqual({ type: 'written' });
    expect(await test.files.read(path)).toBe('b');
  });

  it('write_InsidePluginCache_RejectsWithRefusal', async () => {
    const test = setUp();

    await expect(
      test.docFiles.write(`${PLUGIN_ROOT}/x.md`, 'b', null),
    ).rejects.toThrow(
      'Refused: /Users/u/.claude/plugins/cache/m/p/1/x.md is inside the plugin cache of p@m',
    );
  });

  it('write_Outside_RejectsNamingPath', async () => {
    const test = setUp();
    await test.files.makeFolder('/Users/u/Desktop');

    await expect(
      test.docFiles.write('/Users/u/Desktop/x.md', 'b', null),
    ).rejects.toThrow(
      'Refused: /Users/u/Desktop/x.md is outside the indexed folders',
    );
  });
});

describe('create', () => {
  it('create_KindSkill_WritesTemplateAndFolder', async () => {
    const test = setUp();

    const created = await test.docFiles.create({
      type: 'kind',
      kind: 'skill',
      place: {
        title: 'r · ~/dev/r/.claude/skills',
        folder: `${ROOT}/.claude/skills`,
        source: 'repo',
      },
      name: ' tidy ',
    });

    expect(created).toEqual({
      path: `${ROOT}/.claude/skills/tidy/SKILL.md`,
      line: 3,
    });
    expect(await test.files.read(created.path)).toBe(
      '---\nname: tidy\ndescription: \n---\n\n# tidy\n\n',
    );
  });

  it('create_KindBadName_RejectsWithProblem', async () => {
    const test = setUp();

    await expect(
      test.docFiles.create({
        type: 'kind',
        kind: 'skill',
        place: REPO_PLACE(`${ROOT}/.claude/skills`),
        name: 'My Skill',
      }),
    ).rejects.toThrow('A skill name is lowercase letters, digits and hyphens');
  });

  it('create_Existing_RejectsAlreadyExists', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/.claude/rules/a.md`, '# a\n');

    await expect(
      test.docFiles.create({
        type: 'kind',
        kind: 'rule',
        place: REPO_PLACE(`${ROOT}/.claude/rules`),
        name: 'a',
      }),
    ).rejects.toThrow('/Users/u/dev/r/.claude/rules/a.md already exists');
  });

  it('create_Followup_AppendsToExistingFile', async () => {
    const test = setUp();
    const followups = `${ROOT}/docs/features/followups.md`;
    await test.files.write(followups, '# F\n');

    const created = await test.docFiles.create({
      type: 'kind',
      kind: 'followup',
      place: REPO_PLACE(`${ROOT}/docs/features`),
      name: 'new',
    });

    expect(created).toEqual({ path: followups, line: 2 });
    expect(await test.files.read(followups)).toBe('# F\n- **new** — \n');
  });

  it('create_PathEndingInSlash_Rejects', async () => {
    const test = setUp();

    await expect(
      test.docFiles.create({ type: 'path', path: '~/dev/r/x/' }),
    ).rejects.toThrow('A path names a file, not a folder');
  });

  it('create_RelativePath_Rejects', async () => {
    const test = setUp();

    await expect(
      test.docFiles.create({ type: 'path', path: 'dev/x.md' }),
    ).rejects.toThrow('A path starts with / or ~');
  });

  it('create_Path_EmptyFileWithParents', async () => {
    const test = setUp();

    const created = await test.docFiles.create({
      type: 'path',
      path: '~/dev/r/new/deep/x.md',
    });

    expect(created).toEqual({ path: `${ROOT}/new/deep/x.md`, line: 1 });
    expect(await test.files.read(created.path)).toBe('');
  });
});

describe('rename', () => {
  it('rename_File_Moves', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/a.md`, 'a');

    const renamed = await test.docFiles.rename(
      `${ROOT}/a.md`,
      `${ROOT}/sub/b.md`,
    );

    expect(renamed).toBe(`${ROOT}/sub/b.md`);
    expect(await test.files.read(`${ROOT}/sub/b.md`)).toBe('a');
    expect(await test.files.stat(`${ROOT}/a.md`)).toBeNull();
  });

  it('rename_SkillToOtherFolder_MovesFolder', async () => {
    const test = setUp();
    await test.files.write(SKILL, 'skill');
    await test.files.write(`${ROOT}/.claude/skills/s/ref.md`, 'ref');

    const renamed = await test.docFiles.rename(
      SKILL,
      `${ROOT}/.claude/skills/t/SKILL.md`,
    );

    expect(renamed).toBe(`${ROOT}/.claude/skills/t/SKILL.md`);
    expect(await test.files.read(`${ROOT}/.claude/skills/t/SKILL.md`)).toBe(
      'skill',
    );
    expect(await test.files.read(`${ROOT}/.claude/skills/t/ref.md`)).toBe(
      'ref',
    );
    expect(await test.files.stat(`${ROOT}/.claude/skills/s`)).toBeNull();
  });

  it('rename_SkillToOtherName_Rejects', async () => {
    const test = setUp();
    await test.files.write(SKILL, 'skill');

    await expect(
      test.docFiles.rename(SKILL, `${ROOT}/.claude/skills/s/README.md`),
    ).rejects.toThrow("A skill's SKILL.md keeps its name; rename its folder");
  });

  it('rename_DestinationExists_Rejects', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/a.md`, 'a');
    await test.files.write(`${ROOT}/b.md`, 'b');

    await expect(
      test.docFiles.rename(`${ROOT}/a.md`, `${ROOT}/b.md`),
    ).rejects.toThrow('/Users/u/dev/r/b.md already exists');
  });

  it('rename_UnlistedSkill_MovesFolder', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/.claude/skills/new/SKILL.md`, 'new');

    await test.docFiles.rename(
      `${ROOT}/.claude/skills/new/SKILL.md`,
      `${ROOT}/.claude/skills/newer/SKILL.md`,
    );

    expect(await test.files.read(`${ROOT}/.claude/skills/newer/SKILL.md`)).toBe(
      'new',
    );
    expect(await test.files.stat(`${ROOT}/.claude/skills/new`)).toBeNull();
  });
});

describe('trash', () => {
  it('trash_SkillMd_TrashesFolder', async () => {
    const test = setUp();
    await test.files.write(SKILL, 'skill');
    await test.files.write(`${ROOT}/.claude/skills/s/ref.md`, 'ref');

    const trashed = await test.docFiles.trash(SKILL);

    expect(trashed).toBe(`${ROOT}/.claude/skills/s`);
    expect(await test.files.stat(`${ROOT}/.claude/skills/s`)).toBeNull();
    expect(await test.files.stat(`${ROOT}/.claude/skills/s/ref.md`)).toBeNull();
  });
});

describe('pluginConfigFile', () => {
  it('pluginConfigFile_ClaudeSecondDir_KeyLine', async () => {
    const test = setUp();
    await test.files.write(
      '/Users/u/.agents/wigley-docs/config.json',
      '{"claudeConfigDirs":["~/.claude","~/.claude-personal"]}',
    );
    await test.files.write(
      '/Users/u/.claude/plugins/installed_plugins.json',
      '{"plugins":{}}',
    );
    await test.files.write(
      '/Users/u/.claude-personal/plugins/installed_plugins.json',
      '{\n"plugins":{\n"p@m":[]\n}}',
    );

    expect(await test.docFiles.pluginConfigFile('p@m', 'claude')).toEqual({
      path: '/Users/u/.claude-personal/plugins/installed_plugins.json',
      line: 3,
    });
    expect(await test.docFiles.pluginConfigFile('q@m', 'claude')).toBeNull();
  });

  it('pluginConfigFile_Codex_ConfigToml', async () => {
    const test = setUp();
    await test.files.write(
      '/Users/u/.codex/config.toml',
      '[features]\n\n[plugins."p@m"]\nenabled = true\n',
    );

    expect(await test.docFiles.pluginConfigFile('p@m', 'codex')).toEqual({
      path: '/Users/u/.codex/config.toml',
      line: 3,
    });
  });

  it('pluginConfigFile_CodexKeyPrefixOfAnother_MatchesWholeKey', async () => {
    const test = setUp();
    await test.files.write(
      '/Users/u/.codex/config.toml',
      '[plugins."p@m-extra"]\nenabled = true\n\n[plugins.\'p@m\']\n',
    );

    expect(await test.docFiles.pluginConfigFile('p@m', 'codex')).toEqual({
      path: '/Users/u/.codex/config.toml',
      line: 4,
    });
  });
});

describe('list', () => {
  it('list_MissingFolder_Empty', async () => {
    const test = setUp();

    expect(await test.docFiles.list(`${ROOT}/none`)).toEqual([]);
  });

  it('list_File_Empty', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/a.md`, 'a');

    expect(await test.docFiles.list(`${ROOT}/a.md`)).toEqual([]);
  });

  it('list_Folder_OneLevelNamesAndFolders', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/a.md`, 'a');
    await test.files.write(`${ROOT}/sub/b.md`, 'b');

    const entries = await test.docFiles.list(ROOT);

    expect(entries.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'a.md', isFolder: false },
      { name: 'sub', isFolder: true },
    ]);
  });
});

describe('watch', () => {
  const path = `${ROOT}/a.md`;

  it('watch_ChangeToTheFile_CallsChanged', async () => {
    const test = setUp();
    await test.files.write(path, 'a');
    let changes = 0;
    await test.docFiles.watch(path, () => changes++);

    await test.files.write(path, 'b');

    expect(changes).toBe(1);
  });

  it('watch_OtherFileInTheFolder_NotCalled', async () => {
    const test = setUp();
    await test.files.write(path, 'a');
    let changes = 0;
    await test.docFiles.watch(path, () => changes++);

    await test.files.write(`${ROOT}/b.md`, 'b');
    await test.files.write(`${ROOT}/sub/a.md`, 'a');

    expect(changes).toBe(0);
  });

  it('watch_Closed_NotCalled', async () => {
    const test = setUp();
    await test.files.write(path, 'a');
    let changes = 0;
    const watch = await test.docFiles.watch(path, () => changes++);

    watch.close();
    await test.files.write(path, 'b');

    expect(changes).toBe(0);
  });
});
