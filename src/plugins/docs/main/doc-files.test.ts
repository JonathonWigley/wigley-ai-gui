import { describe, expect, it } from 'vitest';
import type { InstalledPlugin } from '../../../contracts/agent';
import type { Files, WatchOptions } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import type { CreatePlace, IndexEntry } from '../contract';
import { createDocFiles } from './doc-files';
import type { HarnessFolders } from './harness-folders';

const HOME = '/Users/u';
const ROOT = '/Users/u/dev/r';
const SKILL = '/Users/u/dev/r/.claude/skills/s/SKILL.md';
const PLUGIN_ROOT = '/Users/u/.claude/plugins/cache/m/p/1';
const FEATURES_HOME = '/Users/u/wigley-features/r';
const IMAGE_FOLDER = `${FEATURES_HOME}/followups-images/20261027-140309-fix-chip`;

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
    headings: [],
    links: [],
    lastLoaded: null,
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

const FEATURES_ENTRIES: IndexEntry[] = [
  entry({
    path: `${FEATURES_HOME}/followups.md`,
    kind: 'followup',
    source: 'features',
    root: FEATURES_HOME,
  }),
];

const PROFILE_DIRS = ['/Users/u/.claude', '/Users/u/.claude-personal'];

// Two `claude` profiles at `PROFILE_DIRS`, each with its `plugins/cache`;
// `installs[n]` are the installs profile n lists.
function foldersOf(
  installs: readonly (readonly InstalledPlugin[])[] = [],
): HarnessFolders {
  return {
    roots: () =>
      PROFILE_DIRS.map((configDir, at) => ({
        harnessId: 'claude',
        profile: `profile-${String(at + 1)}`,
        roots: { configDir, pluginCacheDirs: [`${configDir}/plugins/cache`] },
      })),
    installedPlugins: async () =>
      installs.flatMap((plugins) =>
        plugins.map((plugin) => ({ harnessId: 'claude', plugin })),
      ),
  };
}

function setUp(
  options: {
    files?: Files;
    entries?: readonly IndexEntry[];
    homeDir?: string;
    paths?: Paths;
    folders?: HarnessFolders;
  } = {},
) {
  const files = createMemoryFiles();
  const logged: string[] = [];
  const docFiles = createDocFiles({
    files: options.files ?? files,
    homeDir: options.homeDir ?? HOME,
    log: (message) => logged.push(message),
    paths: options.paths ?? posixPaths,
    folders: options.folders ?? foldersOf(),
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
    ).rejects.toThrow('/Users/u/.claude/plugins/cache/m/p/1/x.md');
  });

  it('write_LinkWithTargetOutside_RejectsNamingTarget', async () => {
    const test = setUp();
    const links = new Map([[`${ROOT}/linked.md`, '/Users/u/Desktop/x.md']]);
    await test.files.write('/Users/u/Desktop/x.md', 'x');
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    await expect(
      docFiles.write(`${ROOT}/linked.md`, 'b', null),
    ).rejects.toThrow('/Users/u/Desktop/x.md');
  });

  it('write_DanglingLink_RejectsKeepingLink', async () => {
    const test = setUp();
    const links = new Map([[`${ROOT}/linked.md`, `${ROOT}/gone.md`]]);
    await test.files.makeFolder(ROOT);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    await expect(
      docFiles.write(`${ROOT}/linked.md`, 'b', null),
    ).rejects.toThrow('/Users/u/dev/r/linked.md');
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
    ).rejects.toThrow('/Users/u/x.md');
    await test.docFiles.write(`${HOME}/CLAUDE.md`, 'own', null);
    expect(await test.files.read(`${HOME}/CLAUDE.md`)).toBe('own');
  });

  it('write_UnlistedCachedVersion_RejectsNamingCache', async () => {
    const test = setUp();
    const path = '/Users/u/.claude/plugins/cache/m/p/0/x.md';

    await expect(test.docFiles.write(path, 'b', null)).rejects.toThrow(path);
  });

  it('write_InsideSyncedSkills_RejectsAsDownloadedCopy', async () => {
    const test = setUp();
    const path = '/Users/u/.claude/skills/synced/anthropic/pdf/SKILL.md';

    await expect(test.docFiles.write(path, 'b', null)).rejects.toThrow(path);
    expect(await test.files.stat(path)).toBeNull();
  });

  it('write_SecondConfigFolderSynced_Rejects', async () => {
    const test = setUp();
    const path = '/Users/u/.claude-personal/skills/synced/b/s/SKILL.md';

    await expect(test.docFiles.write(path, 'b', null)).rejects.toThrow(path);
  });

  it('write_GlobalDocFolders_Written', async () => {
    const test = setUp();

    await test.docFiles.write('~/.claude-personal/rules/r.md', 'r', null);
    await test.docFiles.write('~/.agents/skills/s/SKILL.md', 's', null);

    expect(await test.files.read(`${HOME}/.claude-personal/rules/r.md`)).toBe(
      'r',
    );
    expect(await test.files.read(`${HOME}/.agents/skills/s/SKILL.md`)).toBe(
      's',
    );
  });

  it('write_DeclaredConfigFolderWithTilde_ExpandedAndWritten', async () => {
    const test = setUp({
      folders: {
        ...foldersOf(),
        roots: () => [
          {
            harnessId: 'other',
            profile: 'p',
            roots: { configDir: '~/.other', pluginCacheDirs: [] },
          },
        ],
      },
    });

    await test.docFiles.write(`${HOME}/.other/rules/r.md`, 'r', null);

    expect(await test.files.read(`${HOME}/.other/rules/r.md`)).toBe('r');
  });

  it('write_DeclaredConfigFolderNotAbsolute_DroppedAndRefused', async () => {
    const test = setUp({
      folders: {
        ...foldersOf(),
        roots: () => [
          {
            harnessId: 'other',
            profile: 'p',
            roots: { configDir: 'rel/.other', pluginCacheDirs: [] },
          },
        ],
      },
    });

    await expect(
      test.docFiles.write(`${HOME}/rel/.other/r.md`, 'r', null),
    ).rejects.toThrow('outside the indexed folders');
  });

  it('write_InsideCodexFolder_RefusedOutsideIndexedFolders', async () => {
    const test = setUp();

    await expect(
      test.docFiles.write('/Users/u/.codex/AGENTS.md', 'a', null),
    ).rejects.toThrow(
      'Refused: /Users/u/.codex/AGENTS.md is outside the indexed folders',
    );
  });

  it('write_SecondProfilesPluginCache_Rejects', async () => {
    const test = setUp();
    const path = '/Users/u/.claude-personal/plugins/cache/m/p/1/x.md';

    await expect(test.docFiles.write(path, 'b', null)).rejects.toThrow(path);
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
    ).rejects.toThrow('/Users/u/Desktop/x.md');
  });
});

describe('writeBytes', () => {
  it('writeBytes_InsideFeaturesRoot_WritesBytesAndFolders', async () => {
    const test = setUp({ entries: FEATURES_ENTRIES });

    const result = await test.docFiles.writeBytes(
      `${IMAGE_FOLDER}/1.png`,
      new Uint8Array([1, 2, 3]),
    );

    expect(result).toEqual({ type: 'written' });
    expect([...test.files.bytesOf(`${IMAGE_FOLDER}/1.png`)]).toEqual([1, 2, 3]);
  });

  it('writeBytes_Outside_RejectsNamingPath', async () => {
    const test = setUp();

    await expect(
      test.docFiles.writeBytes('/Users/u/elsewhere/1.png', new Uint8Array([1])),
    ).rejects.toThrow('/Users/u/elsewhere/1.png');
    expect(await test.files.stat('/Users/u/elsewhere/1.png')).toBeNull();
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
    ).rejects.toThrow();
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
    ).rejects.toThrow('/Users/u/dev/r/.claude/rules/a.md');
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

    expect(created).toEqual({ path: followups, line: 3 });
    expect(await test.files.read(followups)).toBe('# F\n\n- **new** — \n');
  });

  it('create_PathEndingInSlash_Rejects', async () => {
    const test = setUp();

    await expect(
      test.docFiles.create({ type: 'path', path: '~/dev/r/x/' }),
    ).rejects.toThrow();
  });

  it('create_RelativePath_Rejects', async () => {
    const test = setUp();

    await expect(
      test.docFiles.create({ type: 'path', path: 'dev/x.md' }),
    ).rejects.toThrow();
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
    ).rejects.toThrow();
  });

  it('rename_DestinationExists_Rejects', async () => {
    const test = setUp();
    await test.files.write(`${ROOT}/a.md`, 'a');
    await test.files.write(`${ROOT}/b.md`, 'b');

    await expect(
      test.docFiles.rename(`${ROOT}/a.md`, `${ROOT}/b.md`),
    ).rejects.toThrow('/Users/u/dev/r/b.md');
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

  it('trash_ImageFolderInsideFeaturesRoot_TrashesFolder', async () => {
    const test = setUp({ entries: FEATURES_ENTRIES });
    await test.files.writeBytes(`${IMAGE_FOLDER}/1.png`, new Uint8Array([1]));

    const trashed = await test.docFiles.trash(IMAGE_FOLDER);

    expect(trashed).toEqual({ trashed: [IMAGE_FOLDER], error: null });
    expect(await test.files.stat(`${IMAGE_FOLDER}/1.png`)).toBeNull();
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

    await expect(docFiles.trash(`${link}/SKILL.md`)).rejects.toThrow(target);
    expect([...links]).toEqual([[link, target]]);
    expect(await test.files.read(`${target}/SKILL.md`)).toBe('skill');
  });

  it('trash_LinkToSyncedSkill_RefusedTrashesNeither', async () => {
    const test = setUp();
    const target = `${HOME}/.claude/skills/synced/anthropic/pdf`;
    const link = `${HOME}/.claude/skills/pdf`;
    await test.files.write(`${target}/SKILL.md`, 'skill');
    const links = new Map([[link, target]]);
    const docFiles = setUp({ files: withLinks(test.files, links) }).docFiles;

    await expect(docFiles.trash(`${link}/SKILL.md`)).rejects.toThrow(target);
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
      link,
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

describe('readIfPresent', () => {
  it('readIfPresent_NothingThere_Null', async () => {
    const { docFiles } = setUp();

    expect(await docFiles.readIfPresent(`${HOME}/gone.md`)).toBeNull();
  });

  it('readIfPresent_FileThere_ItsText', async () => {
    const test = setUp();
    await test.files.write(`${HOME}/there.md`, 'text');

    expect(await test.docFiles.readIfPresent(`${HOME}/there.md`)).toBe('text');
  });

  it('readIfPresent_OtherFailure_Rejects', async () => {
    const test = setUp();
    const failing = {
      ...test.files,
      read: () => Promise.reject(new Error('denied')),
    };

    await expect(
      setUp({ files: failing }).docFiles.readIfPresent(`${HOME}/x.md`),
    ).rejects.toThrow('denied');
  });
});

describe('wikiMainPath', () => {
  const CLONE = '/Users/u/src/wa';

  it.each<{
    name: string;
    links: [string, string][];
    folders: string[];
    written: string | null;
    expected: string;
  }>([
    {
      name: 'PlainHomeFolder',
      links: [],
      folders: [],
      written: `${HOME}/wigley-agents/wiki/Main.md`,
      expected: '/Users/u/wigley-agents/wiki/Main.md',
    },
    {
      name: 'LinkedFolder_FilePresent',
      links: [[`${HOME}/wigley-agents`, CLONE]],
      folders: [CLONE],
      written: `${CLONE}/wiki/Main.md`,
      expected: '/Users/u/src/wa/wiki/Main.md',
    },
    {
      name: 'LinkedFolder_WikiFolderMissing',
      links: [[`${HOME}/wigley-agents`, CLONE]],
      folders: [CLONE],
      written: null,
      expected: '/Users/u/src/wa/wiki/Main.md',
    },
  ])(
    'the wiki main path is the real path ($name)',
    async ({ links, folders, written, expected }) => {
      const test = setUp();
      for (const folder of folders) {
        await test.files.makeFolder(folder);
      }
      if (written !== null) {
        await test.files.write(written, 'text');
      }
      const files = withLinks(test.files, new Map(links));

      const path = await setUp({ files }).docFiles.wikiMainPath();

      expect(path).toBe(expected);
    },
  );
});

describe('pluginConfigFile', () => {
  it('pluginConfigFile_SecondProfileListsKey_ItsListedAt', async () => {
    const listedAt = {
      path: '/Users/u/.claude-personal/plugins/installed_plugins.json',
      line: 3,
    };
    const test = setUp({
      folders: foldersOf([
        [{ key: 'p@m', installDir: '/i/1', version: null, listedAt: null }],
        [{ key: 'p@m', installDir: '/i/2', version: '1.0.0', listedAt }],
      ]),
    });

    expect(await test.docFiles.pluginConfigFile('p@m', 'claude')).toEqual(
      listedAt,
    );
    expect(await test.docFiles.pluginConfigFile('q@m', 'claude')).toBeNull();
  });

  it('pluginConfigFile_UnregisteredHarness_Null', async () => {
    const test = setUp({
      folders: foldersOf([
        [
          {
            key: 'p@m',
            installDir: '/i/1',
            version: null,
            listedAt: { path: '/Users/u/.claude/x.json', line: 2 },
          },
        ],
      ]),
    });

    expect(await test.docFiles.pluginConfigFile('p@m', 'codex')).toBeNull();
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

    watch.dispose();
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

  // Breaks if a missed burst does not report a write the watch missed, or
  // reports again with no new write, which sets off a caller that watches
  // again on each change.
  it('watch_OnMissed_CallsChangedOnlyWhenTheFileChanged', async () => {
    let time = 10;
    const memory = createMemoryFiles({ now: () => time });
    await memory.write(path, 'a');
    let watchOptions: WatchOptions | undefined;
    const test = setUp({
      files: {
        ...memory,
        watch: (_folder, _onChange, options) => {
          watchOptions = options;
          return { dispose: () => undefined };
        },
      },
    });
    let changes = 0;
    await test.docFiles.watch(path, () => changes++);
    time = 20;
    await memory.write(path, 'b');

    watchOptions?.onMissed?.();
    await new Promise((settle) => setImmediate(settle));
    watchOptions?.onMissed?.();
    await new Promise((settle) => setImmediate(settle));

    expect(changes).toBe(1);
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

    await expect(test.docFiles.read('\\dev\\r\\a.md')).rejects.toThrow();
    await expect(test.docFiles.read('C:dev\\a.md')).rejects.toThrow();
    expect(test.reads).toEqual([]);
  });

  it('create_WindowsTrailingBackslash_RejectsFolder', async () => {
    const test = setUpWindows();

    await expect(
      test.docFiles.create({
        type: 'path',
        path: 'C:\\Users\\u\\dev\\r\\new\\',
      }),
    ).rejects.toThrow();
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
    ).rejects.toThrow('D:\\x\\y.md');
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

    await expect(test.docFiles.write(path, 'new', null)).rejects.toThrow(path);
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
        return { dispose: () => {} };
      },
    });
    let changes = 0;

    await test.docFiles.watch(`${WINDOWS_ROOT}\\A.md`, () => changes++);
    report?.('a.md');

    expect(watched).toEqual([WINDOWS_ROOT]);
    expect(changes).toBe(1);
  });
});
