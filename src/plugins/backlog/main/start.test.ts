import { describe, expect, it, vi } from 'vitest';
import type { Git } from '../../../contracts/git';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  DocsMainExports,
  IndexEntry,
  SourceRead,
} from '../../docs/contract';
import type { BacklogRead } from '../contract';
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

function entry(
  kind: string,
  path: string,
  meta: Record<string, unknown> = {},
): IndexEntry {
  return {
    id: path,
    kind,
    source: 'features',
    owner: 'mine',
    repo: 'r',
    root: HOME,
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

// Backlog's main part over a fake docs export serving `disk` and an index of
// `entries`. `invoke` calls a channel handler; `sent` holds each message;
// `watched` lists each live watch; `emit` fires a docs event at backlog.
function startBacklog(entries: IndexEntry[], disk: Record<string, string>) {
  const files = new Map(Object.entries(disk));
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
      const text = files.get(path);
      if (text === undefined) {
        throw missingFile(path);
      }
      return text;
    },
    writeDoc: async (path, text) => {
      files.set(path, text);
      return { type: 'written' };
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
      paths: posixPaths,
      runMode: 'live',
      log: (source: string, message: string) =>
        logged.push(`[${source}] ${message}`),
    },
    dependency: () => docs,
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
  return { part, files, watched, sent, logged, git, index, invoke, emit };
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

  it('load_FollowupFileChanged_Uncommitted', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.git.changedPaths.mockResolvedValue(['docs/features/followups.md']);

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].uncommitted).toBe(true);
    expect(backlog.git.changedPaths).toHaveBeenCalledWith(
      CLONE,
      'docs/features',
    );
  });

  it('load_OtherFileChanged_NotUncommitted', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.git.changedPaths.mockResolvedValue(['docs/features/f/notes.md']);

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].uncommitted).toBe(false);
  });

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
    expect(backlog.logged).toEqual([
      `[backlog] ${UI_FOLLOWUPS}: ENOENT: ${UI_FOLLOWUPS}`,
    ]);
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

  it('commit_NothingChanged_Rejects', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.git.fileAtHead.mockResolvedValue(FOLLOWUPS_TEXT);
    await backlog.invoke('load');

    await expect(backlog.invoke('commit', HOME)).rejects.toThrow(
      `Nothing to commit in ${HOME}`,
    );
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
});
