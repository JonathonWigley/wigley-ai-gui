import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
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
    owner: 'mine',
    repo: 'r',
    root: ROOT,
    plugin: null,
    line: null,
    title: 't',
    meta: {},
    walked: [],
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

function setUp(
  options: {
    files?: Files;
    entries?: readonly IndexEntry[];
    homeDir?: string;
    paths?: Paths;
  } = {},
) {
  const files = createMemoryFiles();
  const logged: string[] = [];
  const docFiles = createDocFiles({
    files: options.files ?? files,
    homeDir: options.homeDir ?? HOME,
    log: (source, message) => logged.push(`[${source}] ${message}`),
    paths: options.paths ?? posixPaths,
    entries: () => options.entries ?? ENTRIES,
  });
  return { files, docFiles, logged };
}

// `files` with symlinks: each key of `links` is a link to its value. A path
// through a link reads and writes the target; a write, rename or trash of the
// link itself (its folder resolved) replaces, moves or removes the link, as
// on disk.
function withLinks(files: MemoryFiles, links: Map<string, string>): Files {
  const resolve = (path: string): string => {
    for (const [link, target] of links) {
      if (path === link || path.startsWith(`${link}/`)) {
        return resolve(target + path.slice(link.length));
      }
    }
    return path;
  };
  const asItself = (path: string) =>
    posixPaths.join(resolve(posixPaths.parent(path)), posixPaths.base(path));
  return {
    ...files,
    read: (path) => files.read(resolve(path)),
    write: async (path, text) => {
      links.delete(asItself(path));
      await files.write(asItself(path), text);
    },
    stat: async (path) => {
      const found = await files.stat(resolve(path));
      return found && { ...found, isLink: links.has(asItself(path)) };
    },
    realPath: (path) => files.realPath(resolve(path)),
    makeFolder: (path) => files.makeFolder(resolve(path)),
    list: async (folder) => {
      const linked = [...links.keys()]
        .filter((link) => posixPaths.parent(link) === resolve(folder))
        .map((link) => ({
          path: posixPaths.base(link),
          kind: 'file' as const,
        }));
      return [...(await files.list(resolve(folder))), ...linked];
    },
    rename: async (from, to) => {
      const target = links.get(asItself(from));
      if (target === undefined) {
        await files.rename(asItself(from), asItself(to));
        return;
      }
      links.delete(asItself(from));
      links.set(asItself(to), target);
    },
    trash: async (path) => {
      if (!links.delete(asItself(path))) {
        await files.trash(asItself(path));
      }
    },
  };
}

// `files` on a case-insensitive volume: `stat` finds a name in any case, and
// `realPath` returns the name in its case on disk.
function caseInsensitive(files: MemoryFiles): Files {
  const onDisk = async (path: string): Promise<string> => {
    const name = posixPaths.base(path).toLowerCase();
    const siblings = await files.list(posixPaths.parent(path));
    const found = siblings.find(
      (sibling) => sibling.path.toLowerCase() === name,
    );
    return found === undefined
      ? path
      : posixPaths.join(posixPaths.parent(path), found.path);
  };
  return {
    ...files,
    stat: async (path) => files.stat(await onDisk(path)),
    realPath: async (path) => files.realPath(await onDisk(path)),
  };
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

  it('write_LinkWithTargetOutside_RejectsNamingTarget', async () => {
    const test = setUp();
    const links = new Map([[`${ROOT}/linked.md`, '/Users/u/Desktop/x.md']]);
    await test.files.write('/Users/u/Desktop/x.md', 'x');
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    await expect(
      docFiles.write(`${ROOT}/linked.md`, 'b', null),
    ).rejects.toThrow(
      'Refused: /Users/u/Desktop/x.md is outside the indexed folders',
    );
  });

  it('write_DanglingLink_RejectsKeepingLink', async () => {
    const test = setUp();
    const links = new Map([[`${ROOT}/linked.md`, `${ROOT}/gone.md`]]);
    await test.files.makeFolder(ROOT);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    await expect(
      docFiles.write(`${ROOT}/linked.md`, 'b', null),
    ).rejects.toThrow(
      'Refused: /Users/u/dev/r/linked.md is a link to a missing file',
    );
    expect(links.get(`${ROOT}/linked.md`)).toBe(`${ROOT}/gone.md`);
    expect(await test.files.stat(`${ROOT}/gone.md`)).toBeNull();
  });

  it('write_HomeFolder_Refused', async () => {
    const test = setUp({
      entries: [
        ...ENTRIES,
        entry({ path: `${HOME}/CLAUDE.md`, source: 'global', root: null }),
      ],
    });
    await test.files.makeFolder(HOME);

    await expect(
      test.docFiles.write(`${HOME}/x.md`, 'b', null),
    ).rejects.toThrow('Refused: /Users/u/x.md is outside the indexed folders');
    await test.docFiles.write(`${HOME}/CLAUDE.md`, 'own', null);
    expect(await test.files.read(`${HOME}/CLAUDE.md`)).toBe('own');
  });

  it('write_UnlistedCachedVersion_RejectsNamingCache', async () => {
    const test = setUp();
    const path = '/Users/u/.claude/plugins/cache/m/p/0/x.md';

    await expect(test.docFiles.write(path, 'b', null)).rejects.toThrow(
      `Refused: ${path} is inside the plugin cache /Users/u/.claude/plugins/cache`,
    );
  });

  it('write_GlobalDocFolders_Written', async () => {
    const test = setUp();

    await test.docFiles.write('~/.codex/prompts/p.md', 'p', null);
    await test.docFiles.write('~/.agents/skills/s/SKILL.md', 's', null);

    expect(await test.files.read(`${HOME}/.codex/prompts/p.md`)).toBe('p');
    expect(await test.files.read(`${HOME}/.agents/skills/s/SKILL.md`)).toBe(
      's',
    );
  });

  it('write_LinkedWigleyAgentsFolder_WritesInClone', async () => {
    const test = setUp();
    const clone = '/Users/u/src/wa';
    await test.files.makeFolder(clone);
    const links = new Map([[`${HOME}/wigley-agents`, clone]]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    await docFiles.write('~/wigley-agents/learning/l.md', 'l', null);

    expect(await test.files.read(`${clone}/learning/l.md`)).toBe('l');
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
    ).rejects.toThrow('A path is absolute or starts with ~');
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

  it('rename_CaseOnlyOnCaseInsensitiveVolume_Renames', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/a.md`, 'a');
    const docFiles = setUp({ files: caseInsensitive(test.files) }).docFiles;

    await docFiles.rename(`${ROOT}/a.md`, `${ROOT}/A.md`);

    expect(await test.files.read(`${ROOT}/A.md`)).toBe('a');
    expect(await test.files.stat(`${ROOT}/a.md`)).toBeNull();
  });

  it('rename_SymlinkedDoc_MovesLinkKeepsTarget', async () => {
    const test = setUp();
    const target = '/Users/u/src/clone/linked.md';
    await test.files.write(target, 'linked');
    const links = new Map([[`${ROOT}/linked.md`, target]]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    await docFiles.rename(`${ROOT}/linked.md`, `${ROOT}/sub/moved.md`);

    expect([...links]).toEqual([[`${ROOT}/sub/moved.md`, target]]);
    expect(await test.files.read(target)).toBe('linked');
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

    expect(trashed).toEqual({
      trashed: [`${ROOT}/.claude/skills/s`],
      error: null,
    });
    expect(await test.files.stat(`${ROOT}/.claude/skills/s`)).toBeNull();
    expect(await test.files.stat(`${ROOT}/.claude/skills/s/ref.md`)).toBeNull();
  });

  it('trash_File_TrashesOnlyIt', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/a.md`, 'a');
    await test.files.write(`${ROOT}/b.md`, 'b');

    const trashed = await test.docFiles.trash(`${ROOT}/a.md`);

    expect(trashed).toEqual({ trashed: [`${ROOT}/a.md`], error: null });
    expect(await test.files.stat(`${ROOT}/a.md`)).toBeNull();
    expect(await test.files.read(`${ROOT}/b.md`)).toBe('b');
  });

  it('trash_LinkToFile_TrashesTargetThenLink', async () => {
    const test = setUp();
    const target = `${ROOT}/docs/real.md`;
    const link = `${HOME}/.claude/linked.md`;
    await test.files.write(target, 'real');
    await test.files.makeFolder(`${HOME}/.claude`);
    const links = new Map([[link, target]]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    const trashed = await docFiles.trash(link);

    expect(trashed).toEqual({ trashed: [target, link], error: null });
    expect(links.size).toBe(0);
    expect(await test.files.stat(target)).toBeNull();
  });

  it('trash_SkillMdInLinkedSkillFolder_TrashesTargetFolderThenLink', async () => {
    const test = setUp();
    const target = `${ROOT}/skills/foo`;
    const link = `${HOME}/.claude/skills/foo`;
    await test.files.write(`${target}/SKILL.md`, 'skill');
    await test.files.write(`${target}/ref.md`, 'ref');
    await test.files.makeFolder(`${HOME}/.claude/skills`);
    const links = new Map([[link, target]]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    const trashed = await docFiles.trash(`${link}/SKILL.md`);

    expect(trashed).toEqual({ trashed: [target, link], error: null });
    expect(links.size).toBe(0);
    expect(await test.files.stat(target)).toBeNull();
    expect(await test.files.stat(`${target}/ref.md`)).toBeNull();
  });

  it('trash_DocInLinkedFolder_NamesRealPathAndPathAsAsked', async () => {
    const test = setUp();
    const linkedFolder = `${HOME}/dev/linked`;
    await test.files.write(`${ROOT}/a.md`, 'a');
    const links = new Map([[linkedFolder, ROOT]]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    const trashed = await docFiles.trash(`${linkedFolder}/a.md`);

    expect(trashed).toEqual({
      trashed: [`${ROOT}/a.md`, `${linkedFolder}/a.md`],
      error: null,
    });
    expect(await test.files.stat(`${ROOT}/a.md`)).toBeNull();
  });

  it('trash_LinkInLinkedFolder_NamesTargetLinkAndPathAsAsked', async () => {
    const test = setUp();
    const target = `${ROOT}/docs/real.md`;
    const linkedFolder = `${HOME}/dev/linked`;
    await test.files.write(target, 'real');
    const links = new Map([
      [linkedFolder, ROOT],
      [`${ROOT}/linked.md`, target],
    ]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    const trashed = await docFiles.trash(`${linkedFolder}/linked.md`);

    expect(trashed).toEqual({
      trashed: [target, `${ROOT}/linked.md`, `${linkedFolder}/linked.md`],
      error: null,
    });
    expect([...links]).toEqual([[linkedFolder, ROOT]]);
  });

  it('trashTargets_NameInOtherCaseOnCaseInsensitiveVolume_NamesTheFileOnce', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/a.md`, 'a');
    const docFiles = setUp({ files: caseInsensitive(test.files) }).docFiles;

    expect(await docFiles.trashTargets(`${ROOT}/A.md`)).toEqual([
      `${ROOT}/A.md`,
    ]);
  });

  it('trash_LinkChain_TrashesFinalTargetAndFirstLinkKeepsMiddle', async () => {
    const test = setUp();
    const first = `${ROOT}/a.md`;
    const middle = `${ROOT}/b.md`;
    const target = `${ROOT}/c.md`;
    await test.files.write(target, 'c');
    const links = new Map([
      [first, middle],
      [middle, target],
    ]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    const trashed = await docFiles.trash(first);

    expect(trashed).toEqual({ trashed: [target, first], error: null });
    expect([...links]).toEqual([[middle, target]]);
  });

  it('trash_LinkTrashFailsAfterTarget_ResolvesTargetAndFailure', async () => {
    const test = setUp();
    const target = `${ROOT}/docs/real.md`;
    const link = `${HOME}/.claude/linked.md`;
    await test.files.write(target, 'real');
    await test.files.makeFolder(`${HOME}/.claude`);
    const linked = withLinks(test.files, new Map([[link, target]]));
    const docFiles = setUp({
      files: {
        ...linked,
        trash: async (path) => {
          if (path === link) {
            throw new Error('Trash is full');
          }
          await linked.trash(path);
        },
      },
    }).docFiles;

    const trashed = await docFiles.trash(link);

    expect(trashed).toEqual({ trashed: [target], error: 'Trash is full' });
    expect(await test.files.stat(target)).toBeNull();
  });

  it('trash_FirstTrashFails_Rejects', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/a.md`, 'a');
    const docFiles = setUp({
      files: {
        ...test.files,
        trash: async () => {
          throw new Error('Trash is full');
        },
      },
    }).docFiles;

    await expect(docFiles.trash(`${ROOT}/a.md`)).rejects.toThrow(
      'Trash is full',
    );
  });

  it('trash_LinkToPluginCache_RefusedTrashesNeither', async () => {
    const test = setUp();
    const target = `${PLUGIN_ROOT}/skills/foo`;
    const link = `${HOME}/.claude/skills/foo`;
    await test.files.write(`${target}/SKILL.md`, 'skill');
    await test.files.makeFolder(`${HOME}/.claude/skills`);
    const links = new Map([[link, target]]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    await expect(docFiles.trash(`${link}/SKILL.md`)).rejects.toThrow(
      `Refused: ${target} is inside the plugin cache of p@m`,
    );
    expect([...links]).toEqual([[link, target]]);
    expect(await test.files.read(`${target}/SKILL.md`)).toBe('skill');
  });

  it('trashTargets_LinkToFile_TargetThenLinkNothingMoved', async () => {
    const test = setUp();
    const target = `${ROOT}/docs/real.md`;
    const link = `${HOME}/.claude/linked.md`;
    await test.files.write(target, 'real');
    await test.files.makeFolder(`${HOME}/.claude`);
    const links = new Map([[link, target]]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    expect(await docFiles.trashTargets('~/.claude/linked.md')).toEqual([
      target,
      link,
    ]);
    expect(links.size).toBe(1);
    expect(await test.files.read(target)).toBe('real');
  });

  // A repo skill `skills/s` the index walked into through `walkedSkill`, with
  // `links` set and an entry for its SKILL.md walked at `walkedSkill`.
  async function walkedSkillSetUp(
    links: Map<string, string>,
    walkedSkill: string,
    files = createMemoryFiles(),
  ) {
    const skill = `${ROOT}/skills/s`;
    await files.write(`${skill}/SKILL.md`, 'skill');
    await files.makeFolder(`${HOME}/.claude/skills`);
    const entries = [
      entry({
        path: `${skill}/SKILL.md`,
        kind: 'skill',
        walked: [`${walkedSkill}/SKILL.md`],
      }),
    ];
    const docFiles = setUp({
      files: withLinks(files, links),
      entries,
    }).docFiles;
    return { skill, files, docFiles };
  }

  it('trashTargets_WalkedLinkToSkillFolder_NamesLinkAfterTarget', async () => {
    const link = `${HOME}/.claude/skills/s`;
    const links = new Map([[link, `${ROOT}/skills/s`]]);
    const test = await walkedSkillSetUp(links, link);

    expect(await test.docFiles.trashTargets(`${test.skill}/SKILL.md`)).toEqual([
      test.skill,
      link,
    ]);
  });

  it('trashTargets_LinkedParentFolder_NotNamed', async () => {
    const links = new Map([[`${HOME}/.claude/skills`, `${ROOT}/skills`]]);
    const test = await walkedSkillSetUp(links, `${HOME}/.claude/skills/s`);

    expect(await test.docFiles.trashTargets(`${test.skill}/SKILL.md`)).toEqual([
      test.skill,
    ]);
  });

  it('trashTargets_WalkedLinkInsideTarget_NotNamed', async () => {
    const inner = `${ROOT}/skills/s/again`;
    const links = new Map([[inner, `${ROOT}/skills/s`]]);
    const test = await walkedSkillSetUp(links, inner);

    expect(await test.docFiles.trashTargets(`${test.skill}/SKILL.md`)).toEqual([
      test.skill,
    ]);
  });

  it('trashTargets_TwoEntriesSameLink_NamedOnce', async () => {
    const test = setUp();
    const skill = `${ROOT}/skills/s`;
    const link = `${HOME}/.claude/skills/s`;
    await test.files.write(`${skill}/SKILL.md`, 'skill');
    await test.files.write(`${skill}/ref.md`, 'ref');
    await test.files.makeFolder(`${HOME}/.claude/skills`);
    const links = new Map([[link, skill]]);
    const entries = [
      entry({ path: `${skill}/SKILL.md`, walked: [`${link}/SKILL.md`] }),
      entry({ path: `${skill}/ref.md`, walked: [`${link}/ref.md`] }),
    ];
    const docFiles = setUp({
      files: withLinks(test.files, links),
      entries,
    }).docFiles;

    expect(await docFiles.trashTargets(`${skill}/SKILL.md`)).toEqual([
      skill,
      link,
    ]);
  });

  it('trashTargets_WalkedLinkInLinkedConfigFolder_NamedWithRealFolder', async () => {
    const dotfiles = `${HOME}/dotfiles/claude`;
    const files = createMemoryFiles();
    await files.makeFolder(`${dotfiles}/skills`);
    const links = new Map([
      [`${HOME}/.claude`, dotfiles],
      [`${dotfiles}/skills/s`, `${ROOT}/skills/s`],
    ]);
    const test = await walkedSkillSetUp(
      links,
      `${HOME}/.claude/skills/s`,
      files,
    );

    expect(await test.docFiles.trashTargets(`${test.skill}/SKILL.md`)).toEqual([
      test.skill,
      `${dotfiles}/skills/s`,
    ]);
  });

  it('trash_WalkedLinkRefused_NothingMoves', async () => {
    const link = `${HOME}/elsewhere/s`;
    const links = new Map([[link, `${ROOT}/skills/s`]]);
    const files = createMemoryFiles();
    await files.makeFolder(`${HOME}/elsewhere`);
    const test = await walkedSkillSetUp(links, link, files);

    await expect(test.docFiles.trash(`${test.skill}/SKILL.md`)).rejects.toThrow(
      `Refused: ${link} is outside the indexed folders`,
    );
    expect([...links]).toEqual([[link, `${ROOT}/skills/s`]]);
    expect(await test.files.read(`${test.skill}/SKILL.md`)).toBe('skill');
  });

  it('trash_WalkedLink_TrashedAfterTarget', async () => {
    const link = `${HOME}/.claude/skills/s`;
    const links = new Map([[link, `${ROOT}/skills/s`]]);
    const test = await walkedSkillSetUp(links, link);

    const trashed = await test.docFiles.trash(`${test.skill}/SKILL.md`);

    expect(trashed).toEqual({ trashed: [test.skill, link], error: null });
    expect(links.size).toBe(0);
    expect(await test.files.stat(test.skill)).toBeNull();
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

  it('watch_WatchesFolderOneLevel', async () => {
    const memory = createMemoryFiles();
    await memory.write(path, 'a');
    const watched: { folder: string; recursive?: boolean }[] = [];
    const test = setUp({
      files: {
        ...memory,
        watch: (folder, onChange, options) => {
          watched.push({ folder, recursive: options?.recursive });
          return memory.watch(folder, onChange, options);
        },
      },
    });

    await test.docFiles.watch(path, () => {});

    expect(watched).toEqual([{ folder: ROOT, recursive: false }]);
  });
});

describe('on Windows', () => {
  const WINDOWS_HOME = 'C:\\Users\\u';

  const WINDOWS_ROOT = 'C:\\Users\\u\\dev\\r';
  const WINDOWS_ENTRIES = [
    entry({ path: `${WINDOWS_ROOT}\\AGENTS.md`, root: WINDOWS_ROOT }),
  ];

  // The memory files refuse Windows paths, so `read` records each path asked
  // and serves 'x', and `stubs` stand in for every other member a case
  // reaches.
  function setUpWindows(
    stubs: Partial<Files> = {},
    entries: readonly IndexEntry[] = ENTRIES,
  ) {
    const reads: string[] = [];
    const files: Files = {
      ...createMemoryFiles(),
      read: async (path) => {
        reads.push(path);
        return 'x';
      },
      ...stubs,
    };
    const { docFiles } = setUp({
      files,
      entries,
      homeDir: WINDOWS_HOME,
      paths: windowsPaths,
    });
    return { docFiles, reads };
  }

  it('read_WindowsDrivePath_ReadsNormalized', async () => {
    const test = setUpWindows();

    expect(await test.docFiles.read('C:/Users/u/dev/r/a.md')).toBe('x');
    expect(await test.docFiles.read('~/dev/r/a.md')).toBe('x');
    expect(await test.docFiles.read('~\\dev\\r\\a.md')).toBe('x');
    expect(test.reads).toEqual([
      'C:\\Users\\u\\dev\\r\\a.md',
      'C:\\Users\\u\\dev\\r\\a.md',
      'C:\\Users\\u\\dev\\r\\a.md',
    ]);
  });

  it('read_WindowsNotAbsolute_Rejects', async () => {
    const test = setUpWindows();

    await expect(test.docFiles.read('\\dev\\r\\a.md')).rejects.toThrow(
      'A path is absolute or starts with ~',
    );
    await expect(test.docFiles.read('C:dev\\a.md')).rejects.toThrow(
      'A path is absolute or starts with ~',
    );
    expect(test.reads).toEqual([]);
  });

  it('create_WindowsTrailingBackslash_RejectsFolder', async () => {
    const test = setUpWindows();

    await expect(
      test.docFiles.create({
        type: 'path',
        path: 'C:\\Users\\u\\dev\\r\\new\\',
      }),
    ).rejects.toThrow('A path names a file, not a folder');
  });

  it('create_WindowsNoExistingAncestor_StopsAtDriveRoot', async () => {
    const realPaths: string[] = [];
    const test = setUpWindows({
      stat: async () => null,
      list: async () => [],
      realPath: async (path) => {
        realPaths.push(path);
        return path;
      },
    });

    await expect(
      test.docFiles.create({ type: 'path', path: 'D:\\x\\y.md' }),
    ).rejects.toThrow('Refused: D:\\x\\y.md is outside the indexed folders');
    expect(realPaths).toContain('D:\\');
  });

  it('trash_WindowsDriveCaseDiffersFromRealPath_ReturnsOneTrashedPath', async () => {
    const asked = `c:\\Users\\u\\dev\\r\\a.md`;
    const real = `${WINDOWS_ROOT}\\a.md`;
    const trashedOnDisk: string[] = [];
    const test = setUpWindows(
      {
        stat: async (path) =>
          windowsPaths.isInside(path, WINDOWS_ROOT)
            ? {
                isFolder: windowsPaths.samePath(path, WINDOWS_ROOT),
                isLink: false,
              }
            : null,
        realPath: async (path) =>
          windowsPaths.samePath(path, WINDOWS_ROOT) ? WINDOWS_ROOT : path,
        trash: async (path) => {
          trashedOnDisk.push(path);
        },
      },
      WINDOWS_ENTRIES,
    );

    const trashed = await test.docFiles.trash(asked);

    expect(trashed).toEqual({ trashed: [real], error: null });
    expect(trashedOnDisk).toEqual([real]);
  });

  it('write_WindowsCaseDiffersFromDanglingLink_Refuses', async () => {
    const path = `${WINDOWS_ROOT}\\A.md`;
    const test = setUpWindows(
      {
        stat: async () => null,
        list: async (folder) =>
          windowsPaths.samePath(folder, WINDOWS_ROOT)
            ? [{ path: 'a.md', kind: 'file' }]
            : [],
        realPath: async (target) => target,
      },
      WINDOWS_ENTRIES,
    );

    await expect(test.docFiles.write(path, 'new', null)).rejects.toThrow(
      `Refused: ${path} is a link to a missing file`,
    );
  });

  it('watch_WindowsMissingFileCreatedInOtherCase_CallsChanged', async () => {
    let report: ((changedPath: string) => void) | undefined;
    const watched: string[] = [];
    const test = setUpWindows({
      realPath: async (path) => {
        throw Object.assign(new Error(`${path} is missing`), {
          code: 'ENOENT',
        });
      },
      watch: (folder, onChange) => {
        watched.push(folder);
        report = onChange;
        return { close: () => {} };
      },
    });
    let changes = 0;

    await test.docFiles.watch(`${WINDOWS_ROOT}\\A.md`, () => changes++);
    report?.('a.md');

    expect(watched).toEqual([WINDOWS_ROOT]);
    expect(changes).toBe(1);
  });
});
