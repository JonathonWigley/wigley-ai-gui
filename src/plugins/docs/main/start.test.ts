import { describe, expect, it, vi } from 'vitest';
import type { Disposable, Registrations } from '../../../contracts/disposable';
import type { Git } from '../../../contracts/git';
import type { RunMode } from '../../../contracts/plugin';
import type { ProcessResult } from '../../../contracts/processes';
import {
  harnessInfo,
  harnessRegistryOf,
} from '../../../shared/agent-harness-registry.test-support';
import {
  createFakeAgentHarness,
  FAKE_MICROTASK_TIMERS,
  type FakeAgentHarness,
} from '../../../shared/fake-agent-harness';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { FakeProcesses } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  type OwnedSession,
  type SessionInfo,
  sessionsMainKey,
  type SessionsMainExports,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import type { DocsMainExports, IndexDocument } from '../contract';
import { MACHINE_INDEX_FILE } from './index-sources';
import { docsFixtureInstalls } from './selftest-fixture';
import { addDriveActions, docsMainPart, startDocs } from './start';

const HOME = '/home';
const CLAUDE_MD = `${HOME}/.claude/CLAUDE.md`;

function setUpFiles() {
  const files = createMemoryFiles();
  return files.makeFolder(HOME).then(() => files);
}

function fakeHarness(): FakeAgentHarness {
  return createFakeAgentHarness(
    { now: () => 1000 },
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
}

// Docs started over `files` with `harness` registered, its profiles
// `FAKE_PROFILES`.
function start(
  files: ReturnType<typeof createMemoryFiles>,
  runMode: RunMode,
  harness: FakeAgentHarness = fakeHarness(),
) {
  return startDocs(
    {
      files,
      processes: new FakeProcesses(),
      log: () => undefined,
      homeDir: HOME,
      runMode,
      paths: posixPaths,
      agentHarnesses: harnessRegistryOf([harness]),
    },
    () => '/script.py',
    () => [],
    () => new Map([[harness.id, harness.info()]]),
  );
}

describe('startDocs', () => {
  it('writes the fixture into a drive home that has none', async () => {
    const files = await setUpFiles();

    await start(files, 'drive');

    expect(await files.stat(`${HOME}/${MACHINE_INDEX_FILE}`)).not.toBeNull();
  });

  it('keeps a drive home whose fixture an earlier start wrote', async () => {
    const files = await setUpFiles();
    await start(files, 'drive');
    await files.write(CLAUDE_MD, '# Edited by the agent\n');

    await start(files, 'drive');

    expect(await files.read(CLAUDE_MD)).toBe('# Edited by the agent\n');
  });

  it('writes no fixture into a live home', async () => {
    const files = await setUpFiles();

    await start(files, 'live');

    expect(await files.stat(`${HOME}/${MACHINE_INDEX_FILE}`)).toBeNull();
  });

  it.each([
    { runMode: 'drive', isSet: true },
    { runMode: 'live', isSet: false },
  ] as const)(
    'startDocs_NonLiveRun_SetsTheFixtureInstallsOnEachFakeProfile ($runMode)',
    async ({ runMode, isSet }) => {
      const files = await setUpFiles();
      const harness = fakeHarness();

      await start(files, runMode, harness);

      const expected = isSet ? docsFixtureInstalls(HOME, posixPaths) : [];
      expect(await harness.installedPlugins('~/.claude')).toEqual(expected);
      expect(await harness.installedPlugins('~/.claude-personal')).toEqual(
        expected,
      );
    },
  );
});

// The docs drive actions over a fresh home, whose sessions throw on open,
// once `started` settles. `sent` holds each channel message, in order.
async function driveOpeningNothing(
  started: Promise<unknown> = Promise.resolve(),
) {
  const files = await setUpFiles();
  const drive = fakeDriveHost();
  const sent: [string, unknown][] = [];
  addDriveActions(drive.host, {
    files,
    homeDir: HOME,
    started,
    paths: posixPaths,
    sessions: {
      activate: () => undefined,
      open: () => {
        throw new Error('not reached');
      },
    },
    channel: { send: (message, data) => sent.push([message, data]) },
  });
  return { ...drive, sent };
}

describe('docs drive actions', () => {
  it('connectSession rejects a sessionId that is not a string', async () => {
    const drive = await driveOpeningNothing();

    await expect(drive.run('connectSession', { sessionId: 3 })).rejects.toThrow(
      'sessionId',
    );
  });

  it.each([
    ['seed', -1, 'indexDelayMs'],
    ['connectSession', 'slow', 'indexDelayMs'],
  ])('%s rejects indexDelayMs %j', async (action, indexDelayMs, message) => {
    const drive = await driveOpeningNothing();

    await expect(drive.run(action, { indexDelayMs })).rejects.toThrow(message);
  });

  it('driveOpenDoc_SendsOpenDocMessage', async () => {
    const drive = await driveOpeningNothing();

    await drive.run('openDoc', { path: CLAUDE_MD });

    expect(drive.sent).toEqual([['openDoc', { path: CLAUDE_MD, line: null }]]);
  });

  it.each([0, 1.5])(
    'driveOpenDoc_LineNotPositiveWhole_Rejects (%j)',
    async (line) => {
      const drive = await driveOpeningNothing();

      await expect(
        drive.run('openDoc', { path: CLAUDE_MD, line }),
      ).rejects.toThrow('line');
      expect(drive.sent).toEqual([]);
    },
  );

  it('driveOpenDoc_WaitsForStart', async () => {
    const started = Promise.withResolvers<void>();
    const drive = await driveOpeningNothing(started.promise);

    const running = drive.run('openDoc', { path: CLAUDE_MD, line: 3 });
    await Promise.resolve();
    const sentBeforeStart = [...drive.sent];
    started.resolve();
    await running;

    expect(sentBeforeStart).toEqual([]);
    expect(drive.sent).toEqual([['openDoc', { path: CLAUDE_MD, line: 3 }]]);
  });
});

// Docs' main part started live over an empty home, running `/script.py`
// through `processes`. `invoke` calls the page channel's handler for `name`;
// `emit` fires a sessions event at docs; `emitted` holds each event docs
// emitted, in order.
function startDocsPart() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, (payload: unknown) => void>();
  const emitted: [string, unknown][] = [];
  const processes = new FakeProcesses();
  const files = createMemoryFiles();
  const git = {
    topLevel: vi.fn<Git['topLevel']>(async () => '/r'),
    log: vi.fn<Git['log']>(async () => []),
  };
  const api = {
    channel: {
      handle: (name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
      send: () => undefined,
    },
    events: {
      on: (name: string, listener: (payload: unknown) => void): Disposable => {
        listeners.set(name, listener);
        return { dispose: () => listeners.delete(name) };
      },
      emit: (name: string, payload: unknown) => emitted.push([name, payload]),
    },
    settings: () => ({ scriptPath: '/script.py', recentChangesLimit: 3 }),
    services: {
      files,
      processes,
      git,
      log: () => undefined,
      homeDir: '/',
      runMode: 'live',
      paths: posixPaths,
      selfTest: null,
      agentHarnesses: harnessRegistryOf([]),
    },
    state: {
      read: (key: unknown) =>
        key === sessionsRowsSlot
          ? { all: () => new Map(), on: () => ({ dispose: () => undefined }) }
          : {
              all: () =>
                new Map([['claude', harnessInfo({ label: 'Claude Code' })]]),
            },
    },
    dependency: () => ({}),
    drive: null,
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof docsMainPart.start>[0];
  const part = docsMainPart.start(api);
  const invoke = (name: string, ...args: unknown[]) => {
    const handler = handlers.get(name);
    if (handler === undefined) {
      throw new Error(`docs handles no ${name}`);
    }
    return handler(...args);
  };
  const emit = (name: string, payload: unknown) => {
    listeners.get(name)?.(payload);
  };
  const exports = part.exports?.(createRegistrations()) as DocsMainExports;
  return { part, exports, files, processes, git, invoke, emit, emitted };
}

const INDEX_DOCUMENT: IndexDocument = {
  schemaVersion: 5,
  generatedAt: '2026-10-20T00:00:00Z',
  entries: [],
  contexts: [],
};

function documentWithDoc(path: string): IndexDocument {
  return {
    ...INDEX_DOCUMENT,
    entries: [
      {
        id: path,
        kind: 'instructions',
        source: 'global',
        owner: 'mine',
        repo: null,
        root: null,
        plugin: null,
        path,
        line: null,
        title: 'notes',
        meta: {},
        walked: [],
        headings: [],
        links: [],
        lastLoaded: null,
      },
    ],
  };
}

describe('docs main part', () => {
  it('sessionSource_RegisteredWhileConnected', async () => {
    const docs = startDocsPart();
    docs.processes.script(
      'python3',
      ['-X', 'utf8', '/script.py', 'session', 'abc'],
      {
        code: 0,
        stdout: JSON.stringify(INDEX_DOCUMENT),
        stderr: '',
        timedOut: false,
      },
    );
    const info: SessionInfo = {
      sessionId: 'abc',
      projectDir: '/p',
      harness: 'claude',
      rowId: null,
    };
    docs.emit('sessions.connected', { id: 'row-1', info, owned: false });

    expect(await docs.invoke('loadIndex', 'session:row-1')).toEqual({
      document: INDEX_DOCUMENT,
      message: null,
      title: 'session index',
      canRebuild: false,
    });
    docs.emit('sessions.ended', { sessionId: 'row-1' });
    await expect(docs.invoke('loadIndex', 'session:row-1')).rejects.toThrow(
      'session:row-1',
    );
  });

  it('sessionSource_HostSessionChanged_LoadsNewId', async () => {
    const docs = startDocsPart();
    docs.processes.script(
      'python3',
      ['-X', 'utf8', '/script.py', 'session', 'new-host'],
      {
        code: 0,
        stdout: JSON.stringify(INDEX_DOCUMENT),
        stderr: '',
        timedOut: false,
      },
    );
    const info: SessionInfo = {
      sessionId: 'old-host',
      projectDir: '/p',
      harness: 'claude',
      rowId: null,
    };
    docs.emit('sessions.connected', { id: 'row-1', info, owned: true });

    docs.emit('sessions.hostSessionChanged', {
      id: 'row-1',
      info: { ...info, sessionId: 'new-host' },
    });

    expect(await docs.invoke('loadIndex', 'session:row-1')).toEqual({
      document: INDEX_DOCUMENT,
      message: null,
      title: 'session index',
      canRebuild: false,
    });
  });

  // Each run, old and new, indexes one doc of its own, so a source re-added
  // from the session's old info allows the old doc's writes and not the new.
  it.each<{
    event: 'sessions.hostSessionChanged';
    info: SessionInfo;
    changed: SessionInfo;
    oldRun: string[];
    oldPath: string;
    newRun: string[];
    newPath: string;
  }>([
    {
      event: 'sessions.hostSessionChanged',
      info: {
        sessionId: 'old-host',
        projectDir: '/p',
        harness: 'claude',
        rowId: null,
      },
      changed: {
        sessionId: 'new-host',
        projectDir: '/p',
        harness: 'claude',
        rowId: null,
      },
      oldRun: ['session', 'old-host'],
      oldPath: '/p/old.md',
      newRun: ['session', 'new-host'],
      newPath: '/p/notes.md',
    },
  ])(
    "a session source rebuild allows only the new run's doc writes ($event)",
    async ({ event, info, changed, oldRun, oldPath, newRun, newPath }) => {
      const docs = startDocsPart();
      for (const [run, path] of [
        [oldRun, oldPath],
        [newRun, newPath],
      ] as const) {
        await docs.files.makeFolder(path.slice(0, path.lastIndexOf('/')));
        await docs.files.write(path, 'one');
        docs.processes.script('python3', ['-X', 'utf8', '/script.py', ...run], {
          code: 0,
          stdout: JSON.stringify(documentWithDoc(path)),
          stderr: '',
          timedOut: false,
        });
      }
      docs.emit('sessions.connected', { id: 'row-1', info, owned: true });
      docs.emit(event, { id: 'row-1', info: changed });
      await expect(
        docs.invoke('writeDoc', newPath, 'two', 'one') as Promise<unknown>,
      ).rejects.toThrow(newPath);

      await docs.invoke('rebuildIndex', 'session:row-1');

      expect(await docs.invoke('writeDoc', newPath, 'two', 'one')).toEqual({
        type: 'written',
      });
      await expect(
        docs.invoke('writeDoc', oldPath, 'two', 'one') as Promise<unknown>,
      ).rejects.toThrow(oldPath);
    },
  );

  it('pluginStatus_MachineSourceNoClones_Empty', async () => {
    const docs = startDocsPart();
    await docs.invoke('loadIndex', 'machine');

    expect(await docs.invoke('pluginStatus', 'machine', false)).toEqual({
      clones: [],
    });
  });

  it('recentChanges_LimitFromSettings', async () => {
    const docs = startDocsPart();
    await docs.files.makeFolder('/r');
    await docs.files.write('/r/notes.md', 'one');

    await docs.invoke('recentChanges', ['/r/notes.md']);

    expect(docs.git.log).toHaveBeenCalledWith('/r', ['notes.md'], 3);
  });

  it('exports_AddSource_ServedOverChannel', async () => {
    const docs = startDocsPart();
    docs.exports.addSource({
      id: 'x',
      title: 'x index',
      load: () => Promise.resolve({ document: null, message: 'from x' }),
    });

    expect(await docs.invoke('loadIndex', 'x')).toEqual({
      document: null,
      message: 'from x',
      title: 'x index',
      canRebuild: false,
    });
  });

  it('exports_MachineIndex_ReturnsMachineSourceLoad', async () => {
    const docs = startDocsPart();
    await docs.files.write(
      `/${MACHINE_INDEX_FILE}`,
      JSON.stringify(INDEX_DOCUMENT),
    );

    expect(await docs.exports.machineIndex()).toEqual({
      document: INDEX_DOCUMENT,
      message: null,
      title: 'machine index',
      canRebuild: true,
    });
  });

  it('exports_WriteDocRefused_RejectsAsChannel', async () => {
    const docs = startDocsPart();
    const path = '/outside/notes.md';
    const channelWrite = docs.invoke('writeDoc', path, 'text', null);
    const channelError = (await (channelWrite as Promise<unknown>).catch(
      (error: unknown) => error,
    )) as Error;
    expect(channelError.message).toContain(path);

    await expect(docs.exports.writeDoc(path, 'text', null)).rejects.toThrow(
      channelError.message,
    );
  });

  it('exports_WatchDocDisposed_StopsCalls', async () => {
    const docs = startDocsPart();
    const path = '/notes.md';
    await docs.files.write(path, 'one');
    let calls = 0;
    const watch = await docs.exports.watchDoc(path, () => {
      calls += 1;
    });
    await docs.files.write(path, 'two');

    watch.dispose();
    await docs.files.write(path, 'three');

    expect(calls).toBe(1);
  });

  it.each(['loadIndex', 'rebuildIndex'])(
    '%s_EmitsIndexLoaded',
    async (method) => {
      const docs = startDocsPart();

      await docs.invoke(method, 'machine');

      expect(docs.emitted).toEqual([['indexLoaded', { sourceId: 'machine' }]]);
    },
  );

  describe('doc events', () => {
    const REPO = '/p';
    const DOC = `${REPO}/notes.md`;
    const REAL_DOC = `${REPO}/real.md`;

    // Docs over a repo source whose loaded entry allows changes inside `/p`.
    async function startOverRepo() {
      const docs = startDocsPart();
      await docs.files.makeFolder(REPO);
      await docs.files.write(DOC, 'one');
      await docs.files.write(REAL_DOC, 'real');
      docs.exports.addSource({
        id: 'repo',
        title: 'repo',
        load: async () => ({
          document: {
            ...INDEX_DOCUMENT,
            entries: [
              {
                id: DOC,
                kind: 'instructions',
                source: 'repo',
                owner: 'mine',
                repo: 'p',
                root: REPO,
                plugin: null,
                path: DOC,
                line: null,
                title: 'notes',
                meta: {},
                walked: [],
                lastLoaded: null,
                headings: [],
                links: [],
              },
            ],
          },
          message: null,
        }),
      });
      await docs.invoke('loadIndex', 'repo');
      docs.emitted.length = 0;
      return docs;
    }

    // `DOC` becomes a link to `REAL_DOC`, so a trash of it moves `REAL_DOC`, then
    // fails on the link.
    function makeDocALinkThatWillNotTrash({
      files,
    }: Awaited<ReturnType<typeof startOverRepo>>) {
      const { stat, realPath, trash } = files;
      vi.spyOn(files, 'stat').mockImplementation(async (path) => {
        const found = await stat(path);
        return found && { ...found, isLink: path === DOC };
      });
      vi.spyOn(files, 'realPath').mockImplementation((path) =>
        path === DOC ? Promise.resolve(REAL_DOC) : realPath(path),
      );
      vi.spyOn(files, 'trash').mockImplementation((path) =>
        path === DOC ? Promise.reject(new Error('in use')) : trash(path),
      );
    }

    it.each<{
      case: string;
      act: (docs: Awaited<ReturnType<typeof startOverRepo>>) => unknown;
      emitted: [string, unknown][];
    }>([
      {
        case: 'written',
        act: (docs) => docs.invoke('writeDoc', DOC, 'two', 'one'),
        emitted: [['docSaved', { path: DOC }]],
      },
      {
        case: 'written through the export',
        act: (docs) => docs.exports.writeDoc(DOC, 'two', 'one'),
        emitted: [['docSaved', { path: DOC }]],
      },
      {
        case: 'changed on disk',
        act: (docs) => docs.invoke('writeDoc', DOC, 'two', 'not what it holds'),
        emitted: [],
      },
      {
        case: 'bytes',
        act: (docs) => docs.invoke('writeBytes', DOC, new Uint8Array([1])),
        emitted: [['docSaved', { path: DOC }]],
      },
      {
        case: 'create',
        act: (docs) =>
          docs.invoke('createDoc', { type: 'path', path: `${REPO}/new.md` }),
        emitted: [['docCreated', { path: `${REPO}/new.md` }]],
      },
      {
        case: 'rename',
        act: (docs) => docs.invoke('renameDoc', DOC, `${REPO}/moved.md`),
        emitted: [['docRenamed', { from: DOC, to: `${REPO}/moved.md` }]],
      },
      {
        case: 'trash with targets',
        act: (docs) => docs.invoke('trashDoc', DOC),
        emitted: [['docTrashed', { path: DOC, trashed: [DOC] }]],
      },
      {
        case: 'trash whose second target fails',
        act: (docs) => {
          makeDocALinkThatWillNotTrash(docs);
          return docs.invoke('trashDoc', DOC);
        },
        emitted: [['docTrashed', { path: DOC, trashed: [REAL_DOC] }]],
      },
    ])('docEvents_CallLands_FireOnlyThen ($case)', async ({ act, emitted }) => {
      const docs = await startOverRepo();

      await act(docs);

      expect(docs.emitted).toEqual(emitted);
    });

    it.each<{
      case: string;
      act: (docs: Awaited<ReturnType<typeof startOverRepo>>) => unknown;
    }>([
      {
        case: 'write',
        act: (docs) => docs.invoke('writeDoc', '/elsewhere.md', 'two', null),
      },
      {
        case: 'bytes',
        act: (docs) =>
          docs.invoke('writeBytes', '/elsewhere.md', new Uint8Array([1])),
      },
      {
        case: 'create',
        act: (docs) =>
          docs.invoke('createDoc', { type: 'path', path: '/elsewhere.md' }),
      },
      {
        case: 'rename',
        act: (docs) => docs.invoke('renameDoc', DOC, '/elsewhere.md'),
      },
      {
        case: 'trash',
        act: (docs) => docs.invoke('trashDoc', '/elsewhere.md'),
      },
    ])('docEvents_CallLands_FireOnlyThen (rejected $case)', async ({ act }) => {
      const docs = await startOverRepo();

      await expect(act(docs)).rejects.toThrow();

      expect(docs.emitted).toEqual([]);
    });
  });

  it('exports_MachineIndexReads_EmitNothing', async () => {
    const docs = startDocsPart();

    await docs.exports.machineIndex();
    await docs.exports.rebuildMachineIndex();

    expect(docs.emitted).toEqual([]);
  });
});

const NOTES = '/notes.md';
// Docs' main part on the harness, live over an empty root, so it writes no
// fixture, running `/script.py`.
function startDocsOnHarness() {
  const harness = startMainPart(docsMainPart, {
    drive: true,
    settings: { ...docsMainPart.manifest.settings, scriptPath: '/script.py' },
    services: { homeDir: '/', runMode: 'live' },
  });
  const exportsTo = (consumer: Registrations) =>
    harness.started().exports?.(consumer) as DocsMainExports;
  return { harness, exportsTo };
}

function sourceWithId(id: string) {
  return {
    id,
    title: id,
    load: () => Promise.resolve({ document: null, message: null }),
  };
}

describe('docs main part lifecycle', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness } = startDocsOnHarness();
    await harness.files.write(NOTES, 'one');
    await harness.invoke('watchDoc', 'v', NOTES);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stop_EndsEachSessionConnectSessionOpened', async () => {
    const ended: string[] = [];
    // Sessions faked as its consumer view files each session it opens.
    const sessions = fakeDependency(
      sessionsMainKey,
      (consumer) =>
        ({
          activate: () => undefined,
          open(info: SessionInfo): OwnedSession {
            const id = `row-${String(info.sessionId)}`;
            consumer.track({ dispose: () => ended.push(id) });
            return {
              session: { id, info },
              end: () => ended.push(id),
              setHostSessionId: () => undefined,
              keep: () => undefined,
            };
          },
        }) as unknown as SessionsMainExports,
    );
    const harness = startMainPart(docsMainPart, {
      drive: true,
      dependencies: [sessions],
      settings: { ...docsMainPart.manifest.settings, scriptPath: '/script.py' },
      services: { homeDir: '/', runMode: 'live' },
    });
    await harness.drive?.run('connectSession');
    await harness.drive?.run('connectSession', { sessionId: 'named' });
    expect(ended).toEqual([]);

    await harness.stop();

    expect(ended.sort()).toEqual(['row-drive-docs-1', 'row-named']);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startDocsOnHarness();

    await harness.restart();

    expect(harness.started().exports).toBeDefined();
  });

  it('exports_ConsumerDisposed_FreesTheSourceId', () => {
    const { exportsTo } = startDocsOnHarness();
    const first = createRegistrations();
    exportsTo(first).addSource(sourceWithId('extra'));

    first.dispose();

    expect(() =>
      exportsTo(createRegistrations()).addSource(sourceWithId('extra')),
    ).not.toThrow();
  });

  it('exports_ConsumerDisposed_ClosesItsWatch', async () => {
    const { harness, exportsTo } = startDocsOnHarness();
    await harness.files.write(NOTES, 'one');
    const consumer = createRegistrations();
    const changed = vi.fn();
    await exportsTo(consumer).watchDoc(NOTES, changed);

    consumer.dispose();
    await harness.files.write(NOTES, 'two');

    expect(changed).toHaveBeenCalledTimes(0);
  });

  it('exports_DisposedBeforeWatchResolves_ClosesItAtOnce', async () => {
    const { harness, exportsTo } = startDocsOnHarness();
    const consumer = createRegistrations();
    const changed = vi.fn();
    const watching = exportsTo(consumer).watchDoc(NOTES, changed);

    consumer.dispose();
    await watching;
    await harness.files.write(NOTES, 'two');

    expect(changed).toHaveBeenCalledTimes(0);
  });

  it('stop_ClosesViewWatches', async () => {
    const { harness } = startDocsOnHarness();
    await harness.files.write(NOTES, 'one');
    await harness.invoke('watchDoc', 'v', NOTES);
    await harness.files.write(NOTES, 'two');
    const sentWhileLive = harness.sent.length;

    await harness.stop();
    await harness.files.write(NOTES, 'three');

    expect(sentWhileLive).toBe(1);
    expect(harness.sent).toHaveLength(sentWhileLive);
  });

  // Breaks if docs adds a session's source only on `sessions.connected`: a docs
  // restart while sessions run hears none, so each Docs tab reads `No docs
  // index source`, and a row a connected session gains later never gets one.
  it.each<{ when: string; seed: 'before restart' | 'after start' | 'both' }>([
    { when: 'a row held when docs restarts', seed: 'before restart' },
    { when: 'a row added after the start', seed: 'after start' },
    { when: 'a row and its connected event', seed: 'both' },
  ])('serves the session index of $when', async ({ seed }) => {
    const { harness } = startDocsOnHarness();
    harness.processes.script(
      'python3',
      ['-X', 'utf8', '/script.py', 'session', 'abc'],
      {
        code: 0,
        stdout: JSON.stringify(INDEX_DOCUMENT),
        stderr: '',
        timedOut: false,
      },
    );
    const rows = harness.state.publish(sessionsRowsSlot);
    const row = sessionRow('row-1', { hostSessionId: 'abc', projectDir: '/p' });
    rows.set('row-1', row);
    if (seed === 'before restart') {
      await harness.restart();
    }
    if (seed === 'both') {
      harness.emit('sessions.connected', {
        id: 'row-1',
        info: {
          sessionId: 'abc',
          projectDir: '/p',
          harness: 'claude',
          rowId: null,
        },
        owned: true,
      });
    }

    expect(await harness.invoke('loadIndex', 'session:row-1')).toEqual({
      document: INDEX_DOCUMENT,
      message: null,
      title: 'session index',
      canRebuild: false,
    });
  });

  it('stop_IndexRunInFlight_LogsNoFailure', async () => {
    const { harness } = startDocsOnHarness();
    harness.processes.script(
      'python3',
      ['-X', 'utf8', '/script.py', 'session', 'abc'],
      Promise.withResolvers<ProcessResult>().promise,
    );
    harness.emit('sessions.connected', {
      id: 'row-1',
      info: {
        sessionId: 'abc',
        projectDir: '/p',
        harness: 'claude',
        rowId: null,
      },
      owned: false,
    });
    const load = harness.invoke(
      'loadIndex',
      'session:row-1',
    ) as Promise<unknown>;
    await vi.waitFor(() => expect(harness.processes.runs).toHaveLength(1));
    const loadStopped = expect(load).rejects.toThrow('Stopped python3');

    await harness.stop();

    await loadStopped;
    expect(
      harness.logs.filter(({ source }) => source !== 'plugin-host'),
    ).toEqual([]);
    expect(harness.processes.runs).toHaveLength(1);
  });
});
