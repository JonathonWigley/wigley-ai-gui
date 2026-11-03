import { describe, expect, it, vi } from 'vitest';
import type { Git } from '../../../contracts/git';
import {
  type FollowupDraft,
  followupTitleProblem,
  parseFollowups,
} from '../../../shared/followups/followup-file';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  DocsMainExports,
  IndexEntry,
  SourceRead,
} from '../../docs/contract';
import type {
  BacklogEdit,
  BacklogMainExports,
  BacklogRead,
  NoteTarget,
} from '../contract';
import { backlogMainPart } from './start';

const CLONE = '/dev/r';
const HOME = `${CLONE}/docs/features`;
const FOLLOWUPS = `${HOME}/followups.md`;
const UI_FOLLOWUPS = `${HOME}/followups/ui.md`;

const FOLLOWUPS_TEXT = [
  '# Follow-ups — r',
  '',
  '**Contents**',
  '',
  '- **Alpha** — first thing',
  '',
  '## Alpha',
  '',
  'Alpha body.',
  '',
].join('\n');

const UI_TEXT = '# UI\n\n- **Button** — *agent-ready*: bigger button\n';

const BAD_TITLE_FOLLOWUPS_TEXT = '# Follow-ups — r\n\n## Wrap this:\n\nBody.\n';

// 2026-10-27T14:03:09Z
const NOW = 1793109789000;
const IMAGES = `${HOME}/followups-images`;
const CHIP_TITLE = "Fix the chip's colour!";
const CHIP_FOLDER = '20261027-140309-fix-the-chip-s-colour';
const OLD_FOLDER = '20261020-090000-old';
const OLD_BODY = `Old.\n\n![1](followups-images/${OLD_FOLDER}/1.png)`;
const PNG_A = new Uint8Array([137, 80, 78, 71, 1]);
const PNG_B = new Uint8Array([137, 80, 78, 71, 2]);

const CHIP_TARGET: NoteTarget = {
  type: 'create',
  title: CHIP_TITLE,
  oneLine: 'The chip is grey',
  tags: ['agent-ready'],
};

// A `##`-section follow-ups file holding each item, its one line `<title>
// gist`.
function followupsFile(...items: { title: string; body: string }[]): string {
  return [
    '# Follow-ups — r',
    '',
    '**Contents**',
    '',
    ...items.map(({ title }) => `- **${title}** — ${title} gist`),
    '',
    ...items.flatMap(({ title, body }) => [`## ${title}`, '', body, '']),
  ].join('\n');
}

function bodyOf(text: string | undefined, title: string): string | undefined {
  return parseFollowups(text ?? '').items.find((item) => item.title === title)
    ?.body;
}

function entry(
  kind: string,
  path: string,
  meta: Record<string, unknown> = {},
  root = HOME,
): IndexEntry {
  return {
    id: path,
    kind,
    source: 'features',
    owner: 'mine',
    repo: 'r',
    root,
    plugin: null,
    path,
    line: null,
    title: path,
    meta,
    walked: [],
    lastLoaded: null,
  };
}

function indexRead(entries: IndexEntry[]): SourceRead {
  return {
    document: {
      schemaVersion: 4,
      generatedAt: '2026-10-27T00:00:00Z',
      entries,
      contexts: [],
    },
    message: null,
    title: 'machine index',
    canRebuild: true,
  };
}

function missingFile(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
}

// A clone at CLONE holding HOME, nothing changed; every method a mock a test
// can rescript.
function fakeGit() {
  return {
    topLevel: vi.fn<Git['topLevel']>(async () => CLONE),
    currentBranch: vi.fn<Git['currentBranch']>(async () => 'main'),
    isLinkedWorktree: vi.fn<Git['isLinkedWorktree']>(async () => false),
    hasUpstream: vi.fn<Git['hasUpstream']>(async () => true),
    changedPaths: vi.fn<Git['changedPaths']>(async () => []),
    unpushedPaths: vi.fn<Git['unpushedPaths']>(async () => []),
    upstreamBlobs: vi.fn<Git['upstreamBlobs']>(async () => new Map()),
    fetch: vi.fn<Git['fetch']>(async () => false),
    lastFetch: vi.fn<Git['lastFetch']>(async () => null),
    fileAtHead: vi.fn<Git['fileAtHead']>(async () => null),
    commitPaths: vi.fn<Git['commitPaths']>(async () => undefined),
  } satisfies Git;
}

// Each docs call of `name`'s path, in order.
function callsOf(calls: [string, string][], name: string): string[] {
  return calls.filter(([called]) => called === name).map(([, path]) => path);
}

// The first home's first follow-up as an editor draft.
function firstFollowupDraft(read: BacklogRead): FollowupDraft {
  const { title, oneLine, tags, body } =
    read.homes[0].followupFiles[0].items[0];
  return { title, oneLine, tags, body };
}

// Backlog's main part over a fake docs export serving `disk` and an index of
// `entries`. `invoke` calls a channel handler; `exports` are the part's;
// `sent` holds each message; `watched` lists each live watch; `emit` fires a
// docs event at backlog. `links` maps a symlinked path to its real path.
// `calls` lists each docs read, write and trash in order; a path in `refuse`
// makes its `writeDoc` or `writeBytes` reject with that reason. `listed` is
// what `Files.list` reads.
function startBacklog(entries: IndexEntry[], disk: Record<string, string>) {
  const links = new Map<string, string>();
  const files = new Map(Object.entries(disk));
  const listed = createMemoryFiles();
  const calls: [string, string][] = [];
  const refuse = new Map<string, string>();
  const refusing = (path: string) => {
    const reason = refuse.get(path);
    if (reason !== undefined) {
      throw new Error(reason);
    }
  };
  const watched: { path: string; changed: () => void }[] = [];
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, (payload: unknown) => void>();
  const sent: [string, unknown][] = [];
  const logged: string[] = [];
  const git = fakeGit();
  const index = { read: indexRead(entries) };
  const docs: DocsMainExports = {
    addSource: () => ({ dispose: () => undefined }),
    machineIndex: async () => index.read,
    rebuildMachineIndex: async () => index.read,
    readDoc: async (path) => {
      calls.push(['readDoc', path]);
      const text = files.get(path);
      if (text === undefined) {
        throw missingFile(path);
      }
      return text;
    },
    writeDoc: async (path, text) => {
      calls.push(['writeDoc', path]);
      refusing(path);
      files.set(path, text);
      return { type: 'written' };
    },
    writeBytes: async (path) => {
      calls.push(['writeBytes', path]);
      refusing(path);
      return { type: 'written' };
    },
    trashDoc: async (path) => {
      calls.push(['trashDoc', path]);
      return { trashed: [path], error: null };
    },
    watchDoc: async (path, changed) => {
      const watch = { path, changed };
      watched.push(watch);
      return { dispose: () => watched.splice(watched.indexOf(watch), 1) };
    },
  };
  const api = {
    channel: {
      handle: (name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
      send: (name: string, data: unknown) => sent.push([name, data]),
    },
    events: {
      on: (name: string, listener: (payload: unknown) => void) =>
        listeners.set(name, listener),
      emit: () => undefined,
    },
    services: {
      git,
      files: {
        realPath: async (path: string) => links.get(path) ?? path,
        list: listed.list,
      },
      paths: posixPaths,
      clock: { now: () => NOW },
      runMode: 'live',
      log: (source: string, message: string) =>
        logged.push(`[${source}] ${message}`),
    },
    dependency: () => docs,
    settings: () => ({ tags: ['agent-ready'], layout: 'default' }),
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof backlogMainPart.start>[0];
  const part = backlogMainPart.start(api);
  const invoke = async <T>(name: string, ...args: unknown[]): Promise<T> => {
    const handler = handlers.get(name);
    if (handler === undefined) {
      throw new Error(`backlog handles no ${name}`);
    }
    return (await handler(...args)) as T;
  };
  const emit = (name: string, payload: unknown) =>
    listeners.get(name)?.(payload);
  return {
    part,
    exports: part.exports as BacklogMainExports,
    docs,
    calls,
    refuse,
    listed,
    files,
    links,
    watched,
    sent,
    logged,
    git,
    index,
    invoke,
    emit,
  };
}

describe('backlog main part', () => {
  it('load_FeaturesHome_FollowupFilesParsed', async () => {
    const backlog = startBacklog(
      [entry('followup', FOLLOWUPS), entry('followup', UI_FOLLOWUPS)],
      { [FOLLOWUPS]: FOLLOWUPS_TEXT, [UI_FOLLOWUPS]: UI_TEXT },
    );

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.message).toBeNull();
    const [home] = read.homes;
    expect(home).toMatchObject({
      repo: 'r',
      root: HOME,
      gitRoot: CLONE,
      isCreateTarget: true,
      uncommitted: false,
    });
    expect(
      home.followupFiles.map((file) => [
        file.path,
        file.items.map((item) => [item.title, item.tags]),
      ]),
    ).toEqual([
      [FOLLOWUPS, [['Alpha', []]]],
      [UI_FOLLOWUPS, [['Button', ['agent-ready']]]],
    ]);
  });

  it('load_IndexFailed_NoHomesWithItsMessage', async () => {
    const backlog = startBacklog([], {});
    backlog.index.read = {
      document: null,
      message: 'docs_index.py exited 1',
      title: 'machine index',
      canRebuild: true,
    };

    expect(await backlog.invoke('load')).toEqual({
      homes: [],
      message: 'docs_index.py exited 1',
    });
  });

  it.each([
    { changed: 'docs/features/followups.md', uncommitted: true },
    { changed: 'docs/features/followups-images/F/1.png', uncommitted: true },
    { changed: 'docs/features/f/notes.md', uncommitted: false },
    { changed: 'docs/features/followups-images/.DS_Store', uncommitted: false },
  ])(
    'load with $changed changed: uncommitted $uncommitted',
    async ({ changed, uncommitted }) => {
      const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
        [FOLLOWUPS]: FOLLOWUPS_TEXT,
      });
      backlog.git.changedPaths.mockResolvedValue([changed]);

      const read = await backlog.invoke<BacklogRead>('load');

      expect(read.homes[0].uncommitted).toBe(uncommitted);
      expect(backlog.git.changedPaths).toHaveBeenCalledWith(
        CLONE,
        'docs/features',
      );
    },
  );

  it('load_CreateTargetFileOnDiskNotIndexed_Listed', async () => {
    const backlog = startBacklog([entry('followup', UI_FOLLOWUPS)], {
      [UI_FOLLOWUPS]: UI_TEXT,
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].followupFiles.map((file) => file.path)).toEqual([
      UI_FOLLOWUPS,
      FOLLOWUPS,
    ]);
    expect(backlog.watched.map((watch) => watch.path)).toContain(FOLLOWUPS);
    expect(backlog.logged).toEqual([]);
  });

  it('load_CreateTargetFileMissing_NotListedNorLogged', async () => {
    const backlog = startBacklog([entry('followup', UI_FOLLOWUPS)], {
      [UI_FOLLOWUPS]: UI_TEXT,
    });

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].followupFiles.map((file) => file.path)).toEqual([
      UI_FOLLOWUPS,
    ]);
    expect(backlog.logged).toEqual([]);
  });

  it('load_ListedFileUnreadable_LoggedAndSkipped', async () => {
    const backlog = startBacklog(
      [entry('followup', FOLLOWUPS), entry('followup', UI_FOLLOWUPS)],
      { [FOLLOWUPS]: FOLLOWUPS_TEXT },
    );

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].followupFiles.map((file) => file.path)).toEqual([
      FOLLOWUPS,
    ]);
    expect(backlog.logged).toEqual([expect.stringContaining(UI_FOLLOWUPS)]);
  });

  it.each([
    ['# Backlog mode — plan\n', 'Backlog mode'],
    ['# Backlog mode\n', 'Backlog mode'],
    ['No heading here.\n', 'plan-backlog'],
  ])('load_PlanHeading %j_Title %s', async (heading, title) => {
    const planPath = `${HOME}/backlog/plan-backlog/plan.md`;
    const backlog = startBacklog(
      [entry('plan', planPath, { feature: 'backlog', checked: 2, total: 9 })],
      {
        [planPath]: `${heading}\nFeature: Backlog\nTarget: gui \`main\` · Written: 2026-10-26\n`,
      },
    );

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].plans).toEqual([
      {
        path: planPath,
        feature: 'backlog',
        title,
        checked: 2,
        total: 9,
        target: 'gui `main`',
        written: '2026-10-26',
        tasks: [],
      },
    ]);
  });

  it('load_PlanWithoutWrittenDate_WrittenNull', async () => {
    const planPath = `${HOME}/f/plan-p/plan.md`;
    const backlog = startBacklog([entry('plan', planPath, { feature: 'f' })], {
      [planPath]: '# P\n\nTarget: main\n',
    });

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].plans[0]).toMatchObject({
      target: 'main',
      written: null,
    });
  });

  it('commit_OneFollowupFileChanged_CommitsOnlyIt', async () => {
    const edited = FOLLOWUPS_TEXT.replace(
      '- **Alpha** — first thing',
      '- **Alpha** — *agent-ready*: first thing',
    );
    const backlog = startBacklog(
      [entry('followup', FOLLOWUPS), entry('followup', UI_FOLLOWUPS)],
      { [FOLLOWUPS]: edited, [UI_FOLLOWUPS]: UI_TEXT },
    );
    backlog.git.fileAtHead.mockImplementation(async (_root, path) =>
      path === 'docs/features/followups.md' ? FOLLOWUPS_TEXT : UI_TEXT,
    );
    await backlog.invoke('load');

    const message = await backlog.invoke('commit', HOME);

    expect(message).toBe('Follow-ups edited in Backlog: tagged Alpha');
    expect(backlog.git.commitPaths).toHaveBeenCalledWith(
      CLONE,
      ['docs/features/followups.md'],
      message,
    );
    expect(backlog.sent).toContainEqual(['changed', { homeRoot: HOME }]);
  });

  it('commit_UnbornHead_AllItemsAdded', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.git.fileAtHead.mockRejectedValue(
      new Error('git cat-file exited 128: Not a valid object name HEAD'),
    );
    await backlog.invoke('load');

    expect(await backlog.invoke('commit', HOME)).toBe(
      'Follow-ups edited in Backlog: added Alpha',
    );
  });

  it('load_HomeInLinkedWorktree_Dropped', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.git.isLinkedWorktree.mockResolvedValue(true);

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes).toEqual([]);
    expect(backlog.git.isLinkedWorktree).toHaveBeenCalledWith(CLONE);
  });

  it('load_HomeNotItsClonesFeaturesFolder_NotInGit', async () => {
    const elsewhere = '/dev/wigley-features/r';
    const backlog = startBacklog(
      [entry('followup', `${elsewhere}/followups.md`, {}, elsewhere)],
      { [`${elsewhere}/followups.md`]: FOLLOWUPS_TEXT },
    );
    backlog.git.topLevel.mockResolvedValue('/dev');
    backlog.git.changedPaths.mockResolvedValue(['docs/features/followups.md']);

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0]).toMatchObject({ gitRoot: null, uncommitted: false });
    expect(backlog.git.changedPaths).not.toHaveBeenCalled();
  });

  it('load_HomeOutsideLinkedWorktreesFeaturesFolder_KeptNotInGit', async () => {
    const elsewhere = '/dev/wigley-features/r';
    const backlog = startBacklog(
      [entry('followup', `${elsewhere}/followups.md`, {}, elsewhere)],
      { [`${elsewhere}/followups.md`]: FOLLOWUPS_TEXT },
    );
    backlog.git.topLevel.mockResolvedValue('/dev');
    backlog.git.isLinkedWorktree.mockResolvedValue(true);

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes.map((home) => home.root)).toEqual([elsewhere]);
    expect(read.homes[0].gitRoot).toBeNull();
  });

  it('load_InGitHomeSortsAfterOther_InGitHomeIsCreateTarget', async () => {
    const elsewhere = '/a/features';
    const backlog = startBacklog(
      [
        entry('followup', `${elsewhere}/followups.md`, {}, elsewhere),
        entry('followup', FOLLOWUPS),
      ],
      {
        [`${elsewhere}/followups.md`]: FOLLOWUPS_TEXT,
        [FOLLOWUPS]: FOLLOWUPS_TEXT,
      },
    );
    backlog.git.topLevel.mockImplementation(async (folder) =>
      folder === elsewhere ? '/a' : CLONE,
    );

    const read = await backlog.invoke<BacklogRead>('load');

    expect(
      read.homes.map((home) => [home.root, home.gitRoot, home.isCreateTarget]),
    ).toEqual([
      [elsewhere, null, false],
      [HOME, CLONE, true],
    ]);
  });

  it('commit_HomeThroughSymlink_CommitsClonePaths', async () => {
    const linked = '/link/features';
    const linkedFollowups = `${linked}/followups.md`;
    const backlog = startBacklog(
      [entry('followup', linkedFollowups, {}, linked)],
      { [linkedFollowups]: FOLLOWUPS_TEXT },
    );
    backlog.links.set(linked, HOME);
    backlog.git.changedPaths.mockImplementation(async (_root, pathspec) =>
      pathspec === 'docs/features' ? ['docs/features/followups.md'] : [],
    );
    const read = await backlog.invoke<BacklogRead>('load');

    await backlog.invoke('commit', linked);

    expect(read.homes[0]).toMatchObject({ gitRoot: CLONE, uncommitted: true });
    expect(backlog.git.commitPaths).toHaveBeenCalledWith(
      CLONE,
      ['docs/features/followups.md'],
      'Follow-ups edited in Backlog: added Alpha',
    );
  });

  it('commit_OnlyHeaderChanged_PlainSubject', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT.replace('# Follow-ups — r', '# Follow-ups'),
    });
    backlog.git.fileAtHead.mockResolvedValue(FOLLOWUPS_TEXT);
    await backlog.invoke('load');

    expect(await backlog.invoke('commit', HOME)).toBe(
      'Follow-ups edited in Backlog',
    );
    expect(backlog.git.commitPaths).toHaveBeenCalledWith(
      CLONE,
      ['docs/features/followups.md'],
      'Follow-ups edited in Backlog',
    );
  });

  it.each([
    { change: 'nothing changed', changed: [] },
    {
      change: 'only a stray file in the images folder changed',
      changed: ['docs/features/followups-images/.chip.png.1a2b.tmp'],
    },
  ])('commit rejects and commits nothing when $change', async ({ changed }) => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.git.fileAtHead.mockResolvedValue(FOLLOWUPS_TEXT);
    backlog.git.changedPaths.mockResolvedValue(changed);
    await backlog.invoke('load');

    await expect(backlog.invoke('commit', HOME)).rejects.toThrow(HOME);
    expect(backlog.git.commitPaths).not.toHaveBeenCalled();
  });

  it('applyEdit_NoPath_CreatesTheCreateTargetFile', async () => {
    const backlog = startBacklog([entry('followup', UI_FOLLOWUPS)], {
      [UI_FOLLOWUPS]: UI_TEXT,
    });
    await backlog.invoke('load');

    const result = await backlog.invoke('applyEdit', HOME, null, {
      type: 'create',
      draft: { title: 'New', oneLine: 'a new one', tags: [], body: '' },
    });

    expect(result).toMatchObject({ type: 'applied' });
    expect(backlog.files.get(FOLLOWUPS)).toContain('# Follow-ups — r');
    expect(backlog.files.get(FOLLOWUPS)).toContain('## New');
  });

  it('applyEdit_PathNotTheHomesFollowupFile_Refused', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    await backlog.invoke('load');
    const other = `${HOME}/backlog/design.md`;

    const result = await backlog.invoke('applyEdit', HOME, other, {
      type: 'delete',
      title: 'Alpha',
    });

    expect(result).toEqual({
      type: 'refused',
      reason: `${other} is not a follow-up file of ${HOME}`,
    });
  });

  it('applyEdit_TitleWouldNotReadBack_RefusedWithTheProblem', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    await backlog.invoke('load');

    const result = await backlog.invoke('applyEdit', HOME, null, {
      type: 'create',
      draft: { title: ' ', oneLine: '', tags: [], body: '' },
    });

    expect(result).toEqual({
      type: 'refused',
      reason: followupTitleProblem(' '),
    });
    expect(backlog.files.get(FOLLOWUPS)).toBe(FOLLOWUPS_TEXT);
  });

  it.each<(item: FollowupDraft) => BacklogEdit>([
    (item) => ({ type: 'setTags', title: item.title, tags: ['agent-ready'] }),
    (item) => ({
      type: 'edit',
      title: item.title,
      draft: { ...item, body: 'New body.' },
      baseline: item,
    }),
  ])(
    'applyEdit_ExistingTitleWouldNotReadBackAndKept_RefusedPointingToDocs %#',
    async (editOf) => {
      const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
        [FOLLOWUPS]: BAD_TITLE_FOLLOWUPS_TEXT,
      });
      const read = await backlog.invoke<BacklogRead>('load');
      const item = firstFollowupDraft(read);

      const result = await backlog.invoke(
        'applyEdit',
        HOME,
        FOLLOWUPS,
        editOf(item),
      );

      expect(item.title).toBe('Wrap this:');
      expect(result).toEqual({
        type: 'refused',
        reason: expect.stringContaining('Wrap this:'),
      });
      expect(backlog.files.get(FOLLOWUPS)).toBe(BAD_TITLE_FOLLOWUPS_TEXT);
    },
  );

  it('watch_FollowupFileChanged_SendsChangedWithHomeRoot', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    await backlog.invoke('load');

    backlog.watched.find((watch) => watch.path === FOLLOWUPS)?.changed();

    expect(backlog.sent).toEqual([['changed', { homeRoot: HOME }]]);
  });

  it('watch_Reload_DisposesTheLastLoadsWatches', async () => {
    const backlog = startBacklog(
      [entry('followup', FOLLOWUPS), entry('followup', UI_FOLLOWUPS)],
      { [FOLLOWUPS]: FOLLOWUPS_TEXT, [UI_FOLLOWUPS]: UI_TEXT },
    );
    await backlog.invoke('load');
    backlog.index.read = indexRead([entry('followup', UI_FOLLOWUPS)]);
    backlog.files.delete(FOLLOWUPS);

    await backlog.invoke('rescan');

    expect(backlog.watched.map((watch) => watch.path)).toEqual([UI_FOLLOWUPS]);
  });

  it('dispose_DisposesEveryWatch', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    await backlog.invoke('load');

    await backlog.part.dispose?.();

    expect(backlog.watched).toEqual([]);
  });

  it.each([
    ['machine', [['changed', { homeRoot: null }]]],
    ['session:row-1', []],
  ])('indexLoaded %s_Sends %j', (sourceId, sent) => {
    const backlog = startBacklog([], {});

    backlog.emit('docs.indexLoaded', { sourceId });

    expect(backlog.sent).toEqual(sent);
  });

  it('fileNote_Create_WritesImagesThenLinkedBody', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });

    const result = await backlog.exports.fileNote(
      HOME,
      CHIP_TARGET,
      'The chip is grey.',
      [PNG_A, PNG_B],
    );

    expect(result).toMatchObject({ type: 'applied' });
    expect(backlog.calls.filter(([name]) => name !== 'readDoc')).toEqual([
      ['writeBytes', `${IMAGES}/${CHIP_FOLDER}/1.png`],
      ['writeBytes', `${IMAGES}/${CHIP_FOLDER}/2.png`],
      ['writeDoc', FOLLOWUPS],
    ]);
    expect(bodyOf(backlog.files.get(FOLLOWUPS), CHIP_TITLE)).toBe(
      `The chip is grey.\n\n![1](followups-images/${CHIP_FOLDER}/1.png)\n![2](followups-images/${CHIP_FOLDER}/2.png)`,
    );
    expect(backlog.sent).toContainEqual(['changed', { homeRoot: HOME }]);
  });

  it('fileNote_NewFolderNameTaken_NextSuffix', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    await backlog.listed.writeBytes(`${IMAGES}/${CHIP_FOLDER}/1.png`, PNG_A);

    await backlog.exports.fileNote(HOME, CHIP_TARGET, 'Text.', [PNG_A]);

    expect(callsOf(backlog.calls, 'writeBytes')).toEqual([
      `${IMAGES}/${CHIP_FOLDER}-2/1.png`,
    ]);
  });

  it('fileNote_Append_ReusesFolderNumbersOn', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: followupsFile({ title: 'Old item', body: OLD_BODY }),
    });
    await backlog.listed.writeBytes(`${IMAGES}/${OLD_FOLDER}/1.png`, PNG_A);
    await backlog.listed.writeBytes(`${IMAGES}/${OLD_FOLDER}/2.png`, PNG_B);

    const result = await backlog.exports.fileNote(
      HOME,
      { type: 'append', path: FOLLOWUPS, title: 'Old item' },
      'More.',
      [PNG_A],
    );

    expect(result).toMatchObject({ type: 'applied' });
    expect(callsOf(backlog.calls, 'writeBytes')).toEqual([
      `${IMAGES}/${OLD_FOLDER}/3.png`,
    ]);
    expect(bodyOf(backlog.files.get(FOLLOWUPS), 'Old item')).toBe(
      `${OLD_BODY}\n\nMore.\n\n![3](followups-images/${OLD_FOLDER}/3.png)`,
    );
  });

  it('fileNote_TextRefused_TrashesNewFolder', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.refuse.set(FOLLOWUPS, 'Refused: x');

    const result = await backlog.exports.fileNote(HOME, CHIP_TARGET, 'Text.', [
      PNG_A,
    ]);

    expect(result).toEqual({ type: 'refused', reason: 'Refused: x' });
    expect(callsOf(backlog.calls, 'trashDoc')).toEqual([
      `${IMAGES}/${CHIP_FOLDER}`,
    ]);
    expect(backlog.sent).toEqual([]);
  });

  it('fileNote_TextRefusedOnReuse_TrashesWrittenFilesOnly', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: followupsFile({ title: 'Old item', body: OLD_BODY }),
    });
    await backlog.listed.writeBytes(`${IMAGES}/${OLD_FOLDER}/1.png`, PNG_A);
    await backlog.listed.writeBytes(`${IMAGES}/${OLD_FOLDER}/2.png`, PNG_B);
    backlog.refuse.set(FOLLOWUPS, 'Refused: x');

    const result = await backlog.exports.fileNote(
      HOME,
      { type: 'append', path: FOLLOWUPS, title: 'Old item' },
      'More.',
      [PNG_A],
    );

    expect(result).toEqual({ type: 'refused', reason: 'Refused: x' });
    expect(callsOf(backlog.calls, 'trashDoc')).toEqual([
      `${IMAGES}/${OLD_FOLDER}/3.png`,
    ]);
  });

  it('fileNote_AppendItemChangedOnDisk_TrashesImagesPassesChanged', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: followupsFile({ title: 'Old item', body: 'Old.' }),
    });
    const { writeBytes } = backlog.docs;
    backlog.docs.writeBytes = async (path, bytes) => {
      backlog.files.set(
        FOLLOWUPS,
        followupsFile({ title: 'Old item', body: 'Edited by hand.' }),
      );
      return writeBytes(path, bytes);
    };

    const result = await backlog.exports.fileNote(
      HOME,
      { type: 'append', path: FOLLOWUPS, title: 'Old item' },
      'More.',
      [PNG_A],
    );

    expect(result).toMatchObject({
      type: 'changed',
      title: 'Old item',
      item: { body: 'Edited by hand.' },
    });
    expect(callsOf(backlog.calls, 'trashDoc')).toEqual([
      `${IMAGES}/20261027-140309-old-item`,
    ]);
  });

  it('fileNote_ImageWriteRejects_TrashesAndSkipsText', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.refuse.set(`${IMAGES}/${CHIP_FOLDER}/2.png`, 'Refused: y');

    const result = await backlog.exports.fileNote(HOME, CHIP_TARGET, 'Text.', [
      PNG_A,
      PNG_B,
    ]);

    expect(result).toEqual({ type: 'refused', reason: 'Refused: y' });
    expect(callsOf(backlog.calls, 'writeDoc')).toEqual([]);
    expect(callsOf(backlog.calls, 'trashDoc')).toEqual([
      `${IMAGES}/${CHIP_FOLDER}`,
    ]);
  });

  it('fileNote_CreateTitleWouldNotReadBack_RefusesWritingNoImage', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });

    const result = await backlog.exports.fileNote(
      HOME,
      { type: 'create', title: ' ', oneLine: '', tags: [] },
      'Text.',
      [PNG_A],
    );

    expect(result).toEqual({
      type: 'refused',
      reason: followupTitleProblem(' '),
    });
    expect(backlog.calls.filter(([name]) => name !== 'readDoc')).toEqual([]);
  });

  it('fileNote_AppendMissingItem_WritesNothing', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });

    const result = await backlog.exports.fileNote(
      HOME,
      { type: 'append', path: FOLLOWUPS, title: 'Gone' },
      'More.',
      [PNG_A],
    );

    expect(result).toEqual({ type: 'missing', title: 'Gone' });
    expect(callsOf(backlog.calls, 'writeBytes')).toEqual([]);
  });

  it('fileNote_CreateOnNonTargetHome_WritesNothing', async () => {
    const elsewhere = '/a/features';
    const backlog = startBacklog(
      [
        entry('followup', `${elsewhere}/followups.md`, {}, elsewhere),
        entry('followup', FOLLOWUPS),
      ],
      {
        [`${elsewhere}/followups.md`]: FOLLOWUPS_TEXT,
        [FOLLOWUPS]: FOLLOWUPS_TEXT,
      },
    );
    backlog.git.topLevel.mockImplementation(async (folder) =>
      folder === elsewhere ? '/a' : CLONE,
    );

    const result = await backlog.exports.fileNote(
      elsewhere,
      CHIP_TARGET,
      'Text.',
      [PNG_A],
    );

    expect(result).toEqual({
      type: 'refused',
      reason: expect.stringContaining(elsewhere),
    });
    expect(callsOf(backlog.calls, 'writeBytes')).toEqual([]);
  });

  it('delete_ItemWithImages_TrashesFolderAfterWrite', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: followupsFile(
        { title: 'A', body: 'See ![1](followups-images/F/1.png)' },
        { title: 'B', body: 'Nothing linked.' },
      ),
    });
    await backlog.invoke('load');

    const result = await backlog.invoke('applyEdit', HOME, FOLLOWUPS, {
      type: 'delete',
      title: 'A',
    });

    expect(result).toMatchObject({ type: 'applied' });
    expect(backlog.calls.filter(([name]) => name !== 'readDoc')).toEqual([
      ['writeDoc', FOLLOWUPS],
      ['trashDoc', `${IMAGES}/F`],
    ]);
  });

  it('delete_FolderStillLinked_KeepsFolder', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: followupsFile(
        { title: 'A', body: 'See ![1](followups-images/F/1.png)' },
        { title: 'B', body: 'See ![2](followups-images/F/2.png)' },
      ),
    });
    await backlog.invoke('load');

    await backlog.invoke('applyEdit', HOME, FOLLOWUPS, {
      type: 'delete',
      title: 'A',
    });

    expect(callsOf(backlog.calls, 'trashDoc')).toEqual([]);
  });

  it('delete_LinkOutsideImagesFolder_KeepsIt', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: followupsFile({
        title: 'A',
        body: 'See ![1](../followups-images/F/1.png)',
      }),
    });
    await backlog.invoke('load');

    await backlog.invoke('applyEdit', HOME, FOLLOWUPS, {
      type: 'delete',
      title: 'A',
    });

    expect(callsOf(backlog.calls, 'trashDoc')).toEqual([]);
  });

  it('delete_WriteRefused_TrashesNothing', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: followupsFile({
        title: 'A',
        body: 'See ![1](followups-images/F/1.png)',
      }),
    });
    await backlog.invoke('load');
    backlog.refuse.set(FOLLOWUPS, 'Refused: x');

    const result = await backlog.invoke('applyEdit', HOME, FOLLOWUPS, {
      type: 'delete',
      title: 'A',
    });

    expect(result).toEqual({ type: 'refused', reason: 'Refused: x' });
    expect(callsOf(backlog.calls, 'trashDoc')).toEqual([]);
  });

  it('commit_ChangedImages_CommitsThemWithFollowups', async () => {
    const imagePath = `docs/features/followups-images/${CHIP_FOLDER}/1.png`;
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: followupsFile(
        { title: 'Alpha', body: 'Alpha body.' },
        { title: CHIP_TITLE, body: 'The chip is grey.' },
      ),
    });
    backlog.git.fileAtHead.mockResolvedValue(
      followupsFile({ title: 'Alpha', body: 'Alpha body.' }),
    );
    backlog.git.changedPaths.mockImplementation(async (_root, pathspec) =>
      pathspec === 'docs/features/followups-images' ? [imagePath] : [],
    );
    await backlog.invoke('load');

    const message = await backlog.invoke('commit', HOME);

    expect(message).toBe(
      `Follow-ups edited in Backlog: added ${CHIP_TITLE}; images ${CHIP_FOLDER}`,
    );
    expect(backlog.git.commitPaths).toHaveBeenCalledWith(
      CLONE,
      ['docs/features/followups.md', imagePath],
      message,
    );
  });

  it('commit_StrayFileInImagesFolder_LeftOutOfCommitAndMessage', async () => {
    const imagePath = `docs/features/followups-images/${CHIP_FOLDER}/1.png`;
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.git.fileAtHead.mockResolvedValue(FOLLOWUPS_TEXT);
    backlog.git.changedPaths.mockImplementation(async (_root, pathspec) =>
      pathspec === 'docs/features/followups-images'
        ? ['docs/features/followups-images/.DS_Store', imagePath]
        : [],
    );
    await backlog.invoke('load');

    const message = await backlog.invoke('commit', HOME);

    expect(message).not.toContain('followups-images');
    expect(message).toContain(CHIP_FOLDER);
    expect(backlog.git.commitPaths).toHaveBeenCalledWith(
      CLONE,
      [imagePath],
      message,
    );
  });
});
