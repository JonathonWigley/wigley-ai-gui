import { describe, expect, it, vi } from 'vitest';
import type { DemoMainStep } from '../../../contracts/demo';
import type { Files } from '../../../contracts/files';
import type { Git, GitCommit } from '../../../contracts/git';
import {
  followupTitleProblem,
  parseFollowups,
} from '../../../shared/followups/followup-file';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  type ChatMainExports,
  chatMainKey,
  type SessionCloseReason,
} from '../../chat/contract';
import {
  type DocsMainExports,
  docsMainKey,
  type IndexEntry,
  type SourceRead,
} from '../../docs/contract';
import {
  type ScopedAgentSpec,
  type ScopedAgentsMainExports,
  scopedAgentsMainKey,
} from '../../scoped-agents/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
  type ToolDefinition,
} from '../../sessions/contract';
import type {
  BacklogChunk,
  BacklogMainExports,
  BacklogRead,
  ChunkStart,
  NoteTarget,
} from '../contract';
import type { backlogManifest } from '../manifest';
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

// The session the harness's assistant holds.
const ASSISTANT_ROW = 'row-1';

// The demo's scratch folder.
const SCRATCH = '/scratch';

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

const WRITTEN: GitCommit = {
  sha: 'w',
  subject: 'Add follow-ups',
  at: '2026-10-01T10:00:00+00:00',
  paths: [],
};

type BacklogSettings = typeof backlogManifest.settings;

const SETTINGS: BacklogSettings = {
  tags: ['agent-ready'],
  layout: 'default',
  launchBrief: 'Work these.',
  repoFolders: [],
};

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
    headings: [],
    links: [],
    lastLoaded: null,
  };
}

function indexRead(entries: IndexEntry[]): SourceRead {
  return {
    document: {
      schemaVersion: 5,
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
    originRepoName: vi.fn<Git['originRepoName']>(async () => null),
    currentBranch: vi.fn<Git['currentBranch']>(async () => 'main'),
    isLinkedWorktree: vi.fn<Git['isLinkedWorktree']>(async () => false),
    worktrees: vi.fn<Git['worktrees']>(async () => [
      { path: CLONE, branch: 'main', isMain: true },
    ]),
    commonDir: vi.fn<Git['commonDir']>(async () => `${CLONE}/.git`),
    hasUpstream: vi.fn<Git['hasUpstream']>(async () => true),
    changedPaths: vi.fn<Git['changedPaths']>(async () => []),
    unpushedPaths: vi.fn<Git['unpushedPaths']>(async () => []),
    upstreamBlobs: vi.fn<Git['upstreamBlobs']>(async () => new Map()),
    fetch: vi.fn<Git['fetch']>(async () => false),
    lastFetch: vi.fn<Git['lastFetch']>(async () => null),
    resolveCommit: vi.fn<Git['resolveCommit']>(async () => null),
    isAncestor: vi.fn<Git['isAncestor']>(async () => false),
    fileAtHead: vi.fn<Git['fileAtHead']>(async () => null),
    commitPaths: vi.fn<Git['commitPaths']>(async () => undefined),
    log: vi.fn<Git['log']>(async () => []),
    firstAdded: vi.fn<Git['firstAdded']>(async () => null),
  } satisfies Git;
}

// Each docs call of `name`'s path, in order.
function callsOf(calls: [string, string][], name: string): string[] {
  return calls.filter(([called]) => called === name).map(([, path]) => path);
}

// A chunk of repo `r`, unstarted unless `sessionId` says otherwise.
function chunkOf(
  id: string,
  titles: string[],
  sessionId: string | null = null,
): BacklogChunk {
  return { id, repo: 'r', name: id, titles, headless: false, sessionId };
}

// Backlog's main part over a fake docs export serving `disk` and an index of
// `entries`. `invoke` calls a channel handler; `exports` are the part's;
// `sent` holds each message; `watched` lists each live watch; `emit` fires a
// docs or chat event at backlog. `links` maps a symlinked path to its real path.
// `chat` is a fake chat export whose `launch` resolves to `sess-1` and holds
// it; `held` lists the sessions its `profileOf` knows.
// `calls` lists each docs read, write and trash in order; a path in `refuse`
// makes its `writeDoc` or `writeBytes` reject with that reason. `listed` is
// what `Files` reads, `realPath` aside, seeded with every `disk` file at time
// 0; `setTime` sets the modified time its next writes stamp. `data` is the
// plugin data folder; `pushSettings` replaces the settings and tells each
// `onSettingsChanged` listener. `specs` holds each `addScopedAgent` spec, and
// `asked` each of its agent's asks, which resolve `sess-a`; `contributed`
// holds each `contributeTools` call's tool names. `enterStep` enters the
// Backlog demo step in SCRATCH, whose sample docs read `index.sample`, its
// fixture's git runs all succeeding; `trash` spies on `Files.trash`. The page
// never opened Backlog, and the run is no drive run.
function startBacklog(entries: IndexEntry[], disk: Record<string, string>) {
  const links = new Map<string, string>();
  const files = new Map(Object.entries(disk));
  let time = 0;
  const listed = createMemoryFiles({ now: () => time });
  for (const [path, text] of files) {
    // The memory write stores before its first await, so the seed is in place
    // when this returns.
    void listed.write(path, text);
  }
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
  const emitted: [string, unknown][] = [];
  const logged: string[] = [];
  const git = fakeGit();
  const index = { read: indexRead(entries), sample: indexRead([]) };
  const data = createMemoryFiles();
  const demoSteps = createDemoStepRegistry<DemoMainStep>();
  const trash = vi.spyOn(listed, 'trash');
  let settings = SETTINGS;
  const settingsListeners: ((next: BacklogSettings) => void)[] = [];
  const held = new Set<string>();
  const chat = {
    launch: vi.fn<ChatMainExports['launch']>(async () => {
      held.add('sess-1');
      return 'sess-1';
    }),
    defaultProfile: () => 'work',
    profileOf: (sessionId: string) => (held.has(sessionId) ? 'work' : null),
    restored: async () => undefined,
  };
  const specs: ScopedAgentSpec[] = [];
  const asked: [string, string][] = [];
  const scopedAgents: ScopedAgentsMainExports = {
    addScopedAgent(spec) {
      specs.push(spec);
      return {
        ask: async (scope, text) => {
          asked.push([scope, text]);
          return 'sess-a';
        },
        sessionOf: async () => null,
        scopeOf: async () => null,
        dispose: () => undefined,
      };
    },
  };
  const contributed: string[][] = [];
  const sessions = {
    contributeTools: (tools: ToolDefinition[]) => {
      contributed.push(tools.map((tool) => tool.name));
      return { dispose: () => undefined };
    },
  } as unknown as SessionsMainExports;
  const docs: DocsMainExports = {
    addSource: () => ({ dispose: () => undefined }),
    addSampleDocs: async () => ({
      load: async () => index.sample,
      dispose: () => undefined,
    }),
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
  const dependencies: Record<string, unknown> = {
    chat,
    docs,
    'scoped-agents': scopedAgents,
    sessions,
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
      emit: (name: string, payload: unknown) => emitted.push([name, payload]),
    },
    services: {
      git,
      files: {
        realPath: async (path: string) => links.get(path) ?? path,
        read: (path: string) => listed.read(path),
        modified: (path: string) => listed.modified(path),
        stat: (path: string) => listed.stat(path),
        list: (...args: Parameters<Files['list']>) => listed.list(...args),
        watch: (...args: Parameters<Files['watch']>) => listed.watch(...args),
        makeFolder: (path: string) => listed.makeFolder(path),
        write: (path: string, text: string) => listed.write(path, text),
        rename: (from: string, to: string) => listed.rename(from, to),
        trash: (path: string) => listed.trash(path),
      },
      // Every git run of the fixture succeeds.
      processes: {
        run: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
      },
      paths: posixPaths,
      clock: { now: () => NOW },
      runMode: 'live',
      homeDir: '/home/me',
      log: (message: string) => logged.push(message),
      randomHex: () => 'c-new',
      demoSteps,
    },
    dependency: (key: { id: string }) => dependencies[key.id],
    settings: () => settings,
    onSettingsChanged: (listener: (next: BacklogSettings) => void) => {
      settingsListeners.push(listener);
      return { dispose: () => undefined };
    },
    data,
    layouts: { register: () => ({ dispose: () => undefined }) },
    state: {
      read: () => ({
        get: () => undefined,
        on: () => ({ dispose: () => undefined }),
      }),
    },
    drive: null,
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
  // Enters the Backlog demo step's main half in SCRATCH.
  const enterStep = () => {
    const step = demoSteps.list().find(({ id }) => id === 'backlog.mode');
    if (step === undefined) {
      throw new Error('backlog registered no backlog.mode step');
    }
    return step.enter({
      scratchDir: SCRATCH,
      launchSession: () => Promise.reject(new Error('no launch')),
      processEvents: () => {
        throw new Error('no process events in this test');
      },
    });
  };
  return {
    part,
    exports: part.exports?.(createRegistrations()) as BacklogMainExports,
    docs,
    enterStep,
    trash,
    calls,
    refuse,
    listed,
    setTime: (next: number) => {
      time = next;
    },
    files,
    links,
    watched,
    sent,
    emitted,
    logged,
    git,
    index,
    data,
    chat,
    held,
    specs,
    asked,
    contributed,
    // The chunks `chunks.json` holds.
    savedChunks: async (): Promise<BacklogChunk[]> =>
      (JSON.parse(await data.read('chunks.json')) as { chunks: BacklogChunk[] })
        .chunks,
    pushSettings: (next: BacklogSettings) => {
      settings = next;
      for (const listener of settingsListeners) {
        listener(next);
      }
    },
    invoke,
    emit,
  };
}

// Lets a staleness pass over immediate fakes run to its end.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Backlog's main part on the harness over a docs fake that lists FOLLOWUPS and
// files each watch under the part, as docs' view does, a chat fake that
// holds no session, a scoped-agents fake whose assistant holds
// ASSISTANT_ROW at scope `global`, and a sessions fake that files nothing;
// a drive run when `drive`. `watched` lists each live watch's path.
function startBacklogOnHarness({ drive = false } = {}) {
  const watched: string[] = [];
  const docs = fakeDependency(
    docsMainKey,
    (consumer) =>
      ({
        machineIndex: async () => indexRead([entry('followup', FOLLOWUPS)]),
        readDoc: async () => FOLLOWUPS_TEXT,
        watchDoc: async (path: string) => {
          watched.push(path);
          return consumer.track({
            dispose: () => watched.splice(watched.indexOf(path), 1),
          });
        },
      }) as unknown as DocsMainExports,
  );
  const chat = fakeDependency(
    chatMainKey,
    () =>
      ({
        restored: async () => undefined,
        profileOf: () => null,
      }) as unknown as ChatMainExports,
  );
  const scopedAgents = fakeDependency(
    scopedAgentsMainKey,
    (): ScopedAgentsMainExports => ({
      addScopedAgent: () => ({
        ask: async () => 'sess-a',
        sessionOf: async (scope) => (scope === 'global' ? ASSISTANT_ROW : null),
        scopeOf: async (session) =>
          session.id === ASSISTANT_ROW ? 'global' : null,
        dispose: () => undefined,
      }),
    }),
  );
  const sessions = fakeDependency(
    sessionsMainKey,
    () =>
      ({
        contributeTools: () => ({ dispose: () => undefined }),
      }) as unknown as SessionsMainExports,
  );
  const harness = startMainPart(backlogMainPart, {
    dependencies: [docs, chat, scopedAgents, sessions],
    services: { git: fakeGit(), runMode: 'live' },
    drive,
  });
  return { harness, watched };
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
      repoFolder: CLONE,
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

  it('staleness_Invoke_CachedThenSendsTheRest', async () => {
    const backlog = startBacklog(
      [entry('followup', FOLLOWUPS), entry('followup', UI_FOLLOWUPS)],
      { [FOLLOWUPS]: FOLLOWUPS_TEXT, [UI_FOLLOWUPS]: UI_TEXT },
    );
    backlog.git.resolveCommit.mockResolvedValue('h1');
    backlog.git.firstAdded.mockResolvedValue(WRITTEN);
    const read = await backlog.invoke<BacklogRead>('load');
    const alpha = read.homes[0].followupFiles[0].items[0];
    const facts = { writtenAt: WRITTEN.at, commitsSince: 0, lastCommit: null };
    await backlog.data.write(
      'staleness.json',
      JSON.stringify({
        entries: {
          'r\nAlpha': {
            heads: 'h1 h1',
            body: `${alpha.oneLine}\n${alpha.body}`,
            facts,
          },
        },
      }),
    );

    const cached = await backlog.invoke('staleness');
    await settle();

    expect(cached).toEqual({
      'r\nAlpha': { ...facts, namedPaths: [], gonePaths: [], level: 'fresh' },
    });
    expect(backlog.git.firstAdded).toHaveBeenCalledTimes(1);
    expect(backlog.git.firstAdded).toHaveBeenCalledWith(
      CLONE,
      'docs/features/followups/ui.md',
      '**Button**',
    );
    expect(backlog.sent).toEqual([
      [
        'stalenessRead',
        {
          entries: {
            'r\nButton': expect.objectContaining({
              writtenAt: WRITTEN.at,
              level: 'fresh',
            }),
          },
        },
      ],
    ]);
  });

  it('commitsSince_UnknownKey_Rejects', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    await backlog.invoke('load');

    await expect(backlog.invoke('commitsSince', 'r\nNobody')).rejects.toThrow(
      'No Backlog row r — Nobody',
    );
  });

  it.each<{ name: string; next: BacklogSettings; sent: unknown[] }>([
    {
      name: 'repoFolders changed',
      next: { ...SETTINGS, repoFolders: [{ repo: 'r', folder: '~/dev/r' }] },
      sent: [['changed', { homeRoot: null }]],
    },
    {
      name: 'only tags changed',
      next: { ...SETTINGS, tags: ['agent-ready', 'later'] },
      sent: [],
    },
  ])('settings_RepoFoldersChanged_SendsChanged ($name)', ({ next, sent }) => {
    const backlog = startBacklog([], {});

    backlog.pushSettings(next);

    expect(backlog.sent).toEqual(sent);
  });

  it('lastRead_AfterLoad_NoSecondLoad', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    const machineIndex = vi.spyOn(backlog.docs, 'machineIndex');

    await backlog.invoke('load');
    await backlog.invoke('staleness');

    expect(machineIndex).toHaveBeenCalledTimes(1);
  });

  it('dispose_Part_DisposesTheReaderAndTheWatches', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    await backlog.invoke('load');
    const watchesBefore = backlog.watched.length;

    await backlog.part.dispose?.('end');
    const cached = await backlog.invoke('staleness');
    await settle();

    expect(watchesBefore).toBeGreaterThan(0);
    expect(backlog.watched).toEqual([]);
    expect(cached).toEqual({});
    expect(backlog.git.firstAdded).not.toHaveBeenCalled();
    expect(backlog.sent).toEqual([]);
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

  it('load_CalledWhileOneRuns_LaterCallsShareOneNextLoad', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    let releaseFirst = (): void => undefined;
    backlog.git.topLevel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve(CLONE);
        }),
    );
    const first = backlog.invoke<BacklogRead>('load');
    await vi.waitFor(() => expect(backlog.git.topLevel).toHaveBeenCalled());

    const later = [1, 2, 3].map(() => backlog.invoke<BacklogRead>('load'));
    releaseFirst();
    const laterReads = await Promise.all(later);
    await first;

    expect(backlog.git.topLevel).toHaveBeenCalledTimes(2);
    expect(new Set(laterReads).size).toBe(1);
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

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].gitRoot).toBeNull();
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

  it('load_HomeThroughSymlink_GitRootIsTheClone', async () => {
    const linked = '/link/features';
    const backlog = startBacklog(
      [entry('followup', `${linked}/followups.md`, {}, linked)],
      { [`${linked}/followups.md`]: FOLLOWUPS_TEXT },
    );
    backlog.links.set(linked, HOME);

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].gitRoot).toBe(CLONE);
  });

  it('load_ProjectFolderHome_InGitWithTheProjectAsRepoFolder', async () => {
    const projectHome = `${CLONE}/proj/docs/features`;
    const backlog = startBacklog(
      [entry('followup', `${projectHome}/followups.md`, {}, projectHome)],
      { [`${projectHome}/followups.md`]: FOLLOWUPS_TEXT },
    );

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes.map((home) => [home.gitRoot, home.repoFolder])).toEqual([
      [CLONE, `${CLONE}/proj`],
    ]);
  });

  it('load_DocsFeaturesDeeperThanAProjectFolder_NotInGit', async () => {
    const deep = `${CLONE}/a/proj/docs/features`;
    const backlog = startBacklog(
      [entry('followup', `${deep}/followups.md`, {}, deep)],
      { [`${deep}/followups.md`]: FOLLOWUPS_TEXT },
    );

    const read = await backlog.invoke<BacklogRead>('load');

    expect(read.homes[0].gitRoot).toBeNull();
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

  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness, watched } = startBacklogOnHarness();
    await harness.invoke('load');
    expect(watched).toEqual([FOLLOWUPS]);

    await harness.stop();

    expect(watched).toEqual([]);
    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness, watched } = startBacklogOnHarness();
    await harness.invoke('load');

    await harness.restart();
    await harness.invoke('load');

    expect(harness.started().exports).toBeDefined();
    expect(watched).toEqual([FOLLOWUPS]);
  });

  it.each([
    ['machine', [['changed', { homeRoot: null }]]],
    ['session:row-1', []],
  ])('indexLoaded %s_Sends %j', (sourceId, sent) => {
    const backlog = startBacklog([], {});

    backlog.emit('docs.indexLoaded', { sourceId });

    expect(backlog.sent).toEqual(sent);
  });

  it('chunks_Invoke_ServesTheStore', async () => {
    const backlog = startBacklog([], {});
    const chunks = [chunkOf('c1', ['Alpha']), chunkOf('c2', ['Beta'])];
    await backlog.data.write('chunks.json', JSON.stringify({ chunks }));

    expect(await backlog.invoke('chunks')).toEqual(chunks);
  });

  it('startChunks_Invoke_LaunchesThroughChat', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    await backlog.data.write(
      'chunks.json',
      JSON.stringify({ chunks: [chunkOf('c1', ['Alpha'])] }),
    );

    const started = await backlog.invoke<ChunkStart[]>('startChunks', ['c1']);

    expect(started).toEqual([{ chunkId: 'c1', sessionId: 'sess-1' }]);
    expect(backlog.chat.launch).toHaveBeenCalledWith({
      projectDir: CLONE,
      profile: 'work',
      message: {
        text: `Work these.\n\n## Alpha\n\nfirst thing\n\nAlpha body.\n\nFrom ${FOLLOWUPS}:7`,
        images: [],
      },
      headless: false,
    });
    expect(backlog.sent.filter(([name]) => name === 'chunksChanged')).toEqual([
      ['chunksChanged', { chunks: [chunkOf('c1', ['Alpha'], 'sess-1')] }],
    ]);
  });

  it.each<SessionCloseReason>([
    'user',
    'start-failed',
    'project-closed',
    'finished',
  ])('sessionClosed_StartedChunk_Retired (%s)', async (reason) => {
    const backlog = startBacklog([], {});
    const chunks = [
      chunkOf('c1', ['Alpha'], 'sess-1'),
      chunkOf('c2', ['Beta']),
    ];
    await backlog.data.write('chunks.json', JSON.stringify({ chunks }));

    backlog.emit('chat.sessionClosed', { sessionId: 'sess-1', reason });
    await settle();

    expect(await backlog.savedChunks()).toEqual([chunkOf('c2', ['Beta'])]);
    expect(backlog.sent).toEqual([
      ['chunksChanged', { chunks: [chunkOf('c2', ['Beta'])] }],
    ]);
  });

  it('sessionClosed_RetireRejects_Logged', async () => {
    const backlog = startBacklog([], {});
    await backlog.data.write(
      'chunks.json',
      JSON.stringify({ chunks: [chunkOf('c1', ['Alpha'], 'sess-1')] }),
    );
    vi.spyOn(backlog.data, 'write').mockRejectedValue(new Error('disk full'));

    backlog.emit('chat.sessionClosed', { sessionId: 'sess-1', reason: 'user' });
    await settle();

    expect(backlog.logged).toEqual(['chunk of sess-1 not retired: disk full']);
  });

  it.each<{ name: string; entries: IndexEntry[]; expected: BacklogChunk[] }>([
    {
      name: 'every file read, gone items pruned',
      entries: [entry('followup', FOLLOWUPS)],
      expected: [{ ...chunkOf('c1', ['Alpha']), name: 'Renamed' }],
    },
    {
      name: 'a listed file unread, the repo left unpruned',
      entries: [entry('followup', FOLLOWUPS), entry('followup', UI_FOLLOWUPS)],
      expected: [
        { ...chunkOf('c1', ['Alpha', 'Gone']), name: 'Renamed' },
        chunkOf('c2', ['Gone too']),
      ],
    },
  ])('editChunks_PrunedBeforeEdit ($name)', async ({ entries, expected }) => {
    const backlog = startBacklog(entries, { [FOLLOWUPS]: FOLLOWUPS_TEXT });
    await backlog.data.write(
      'chunks.json',
      JSON.stringify({
        chunks: [chunkOf('c1', ['Alpha', 'Gone']), chunkOf('c2', ['Gone too'])],
      }),
    );

    const chunks = await backlog.invoke('editChunks', {
      type: 'rename',
      chunkId: 'c1',
      name: 'Renamed',
    });

    expect(chunks).toEqual(expected);
  });

  it('start_RegistersTheAssistant', async () => {
    const backlog = startBacklog([], {});

    const [spec] = backlog.specs;

    expect(backlog.specs).toHaveLength(1);
    expect(spec.owner).toBe('backlog');
    expect(spec.agentId).toBe('assistant');
    expect(spec.folder('global')).toBe('/home/me');
    expect(await spec.title('global')).toBe('Backlog assistant');
  });

  it('start_DriveRun_CallToolRunsAsTheAssistant', async () => {
    const { harness } = startBacklogOnHarness({ drive: true });

    const result = await harness.drive?.run('callTool', {
      session: 'assistant',
      tool: 'read_backlog_state',
    });

    expect(result).toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('## Chunks') }],
    });
  });

  it('start_ContributesBothTools', () => {
    const backlog = startBacklog([], {});

    expect(backlog.contributed).toEqual([
      ['read_backlog_state', 'set_backlog_chunks'],
    ]);
  });

  it('sweep_KnownRepo_AsksTheAssistant', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.git.resolveCommit.mockResolvedValue('h1');
    const read = await backlog.invoke<BacklogRead>('load');
    const alpha = read.homes[0].followupFiles[0].items[0];
    await backlog.data.write(
      'staleness.json',
      JSON.stringify({
        entries: {
          'r\nAlpha': {
            heads: 'h1 h1',
            body: `${alpha.oneLine}\n${alpha.body}`,
            facts: { writtenAt: WRITTEN.at, commitsSince: 2, lastCommit: null },
          },
        },
      }),
    );
    await backlog.invoke('staleness');

    const sessionId = await backlog.invoke('sweep', 'r');

    expect(sessionId).toBe('sess-a');
    expect(backlog.asked).toHaveLength(1);
    const [[scope, text]] = backlog.asked;
    expect(scope).toBe('global');
    expect(text).toContain(`Files:\n- ${FOLLOWUPS}\n\n`);
    expect(text).toContain(
      'Items Backlog reads as stale or moved:\n- Alpha: moved; 2 commits since it was written; gone: none\n\n',
    );
  });

  it('sweep_UnknownRepo_Rejects', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    await backlog.invoke('load');

    await expect(backlog.invoke('sweep', 'x')).rejects.toThrow(
      'No Backlog repo x',
    );
    expect(backlog.asked).toEqual([]);
  });

  describe('follow-up events', () => {
    it.each<{ case: string; target: NoteTarget; event: string; title: string }>(
      [
        {
          case: 'a new follow-up',
          target: CHIP_TARGET,
          event: 'followupCreated',
          title: CHIP_TITLE,
        },
        {
          case: 'an append',
          target: { type: 'append', path: FOLLOWUPS, title: 'Alpha' },
          event: 'followupEdited',
          title: 'Alpha',
        },
      ],
    )(
      'followupEvents_EditLands_FireByType (fileNote: $case)',
      async ({ target, event, title }) => {
        const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
          [FOLLOWUPS]: FOLLOWUPS_TEXT,
        });

        await backlog.exports.fileNote(HOME, target, 'Text.', []);

        expect(backlog.emitted).toEqual([[event, { homeRoot: HOME, title }]]);
        expect(backlog.sent).toEqual([['changed', { homeRoot: HOME }]]);
      },
    );
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

  it('fileNote_CreateTargetFileMissing_CreatesIt', async () => {
    const backlog = startBacklog([entry('followup', UI_FOLLOWUPS)], {
      [UI_FOLLOWUPS]: UI_TEXT,
    });

    const result = await backlog.exports.fileNote(
      HOME,
      CHIP_TARGET,
      'Text.',
      [],
    );

    expect(result).toMatchObject({ type: 'applied' });
    expect(backlog.files.get(FOLLOWUPS)).toContain('# Follow-ups — r');
    expect(bodyOf(backlog.files.get(FOLLOWUPS), CHIP_TITLE)).toBe('Text.');
  });

  it('fileNote_AppendPathNotTheHomesFollowupFile_Refused', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    const other = `${HOME}/backlog/design.md`;

    const result = await backlog.exports.fileNote(
      HOME,
      { type: 'append', path: other, title: 'Alpha' },
      'More.',
      [],
    );

    expect(result).toEqual({
      type: 'refused',
      reason: `${other} is not a follow-up file of ${HOME}`,
    });
    expect(callsOf(backlog.calls, 'writeDoc')).toEqual([]);
  });

  it('fileNote_AppendExistingTitleWouldNotReadBack_RefusedPointingToDocs', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: BAD_TITLE_FOLLOWUPS_TEXT,
    });

    const result = await backlog.exports.fileNote(
      HOME,
      { type: 'append', path: FOLLOWUPS, title: 'Wrap this:' },
      'More.',
      [],
    );

    expect(result).toEqual({
      type: 'refused',
      reason: expect.stringContaining('Wrap this:'),
    });
    expect(backlog.files.get(FOLLOWUPS)).toBe(BAD_TITLE_FOLLOWUPS_TEXT);
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
});

describe('backlog demo step', () => {
  const SAMPLE_HOME = `${SCRATCH}/sample-home`;
  const SAMPLE_REPO = `${SAMPLE_HOME}/dev/backlog-repo`;
  const SAMPLE_FEATURES = `${SAMPLE_REPO}/docs/features`;
  const SAMPLE_FOLLOWUPS = `${SAMPLE_FEATURES}/followups.md`;

  it('serves the sample without rebuilding the machine index', async () => {
    const backlog = startBacklog([entry('followup', FOLLOWUPS)], {
      [FOLLOWUPS]: FOLLOWUPS_TEXT,
      [SAMPLE_FOLLOWUPS]: FOLLOWUPS_TEXT,
    });
    backlog.index.sample = indexRead([
      {
        ...entry('followup', SAMPLE_FOLLOWUPS, {}, SAMPLE_FEATURES),
        repo: 'backlog-repo',
      },
    ]);
    const rebuild = vi.spyOn(backlog.docs, 'rebuildMachineIndex');
    const machineIndex = vi.spyOn(backlog.docs, 'machineIndex');
    await backlog.enterStep();

    const read = await backlog.invoke<BacklogRead>('rescan');

    expect(rebuild).not.toHaveBeenCalled();
    expect(read.homes.map((home) => home.repo)).toEqual(['backlog-repo']);
    await expect(
      backlog.invoke('editChunks', {
        type: 'rename',
        chunkId: 'c1',
        name: 'Renamed',
      }),
    ).rejects.toThrow('keeps no chunks');
    await expect(backlog.invoke('startChunks', ['c1'])).rejects.toThrow(
      'keeps no chunks',
    );
    expect(await backlog.data.stat('chunks.json')).toBeNull();
    const exported = await backlog.exports.load();
    expect(exported.homes.map((home) => home.repo)).toEqual(['r']);
    expect(machineIndex).toHaveBeenCalled();
  });

  it('moves an emptied earlier repo aside before it writes', async () => {
    const backlog = startBacklog([], {});
    await backlog.listed.makeFolder(SAMPLE_REPO);

    await backlog.enterStep();

    expect(
      await backlog.listed.stat(`${SCRATCH}/old-backlog/1`),
    ).not.toBeNull();
    expect(await backlog.listed.stat(SAMPLE_FOLLOWUPS)).not.toBeNull();
    expect(backlog.trash).not.toHaveBeenCalled();
  });
});
