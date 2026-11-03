import { describe, expect, it } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
import type { RunMode } from '../../../contracts/plugin';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { FakeProcesses } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { OwnedSession, SessionInfo } from '../../sessions/contract';
import type { DocsMainExports, IndexDocument } from '../contract';
import { MACHINE_INDEX_FILE } from './index-sources';
import { addDriveActions, docsMainPart, startDocs } from './start';

const HOME = '/home';
const CLAUDE_MD = `${HOME}/.claude/CLAUDE.md`;

function setUpFiles() {
  const files = createMemoryFiles();
  return files.makeFolder(HOME).then(() => files);
}

function start(files: ReturnType<typeof createMemoryFiles>, runMode: RunMode) {
  return startDocs(
    {
      files,
      processes: new FakeProcesses(),
      log: () => undefined,
      homeDir: HOME,
      runMode,
      paths: posixPaths,
    },
    () => '/script.py',
    () => [],
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
  it('dispose removes the actions and ends each session connectSession opened', async () => {
    const files = await setUpFiles();
    const ended: string[] = [];
    const drive = fakeDriveHost();
    const actions = addDriveActions(drive.host, {
      files,
      homeDir: HOME,
      started: Promise.resolve(),
      paths: posixPaths,
      channel: { send: () => undefined },
      sessions: {
        activate: () => undefined,
        open(info: SessionInfo): OwnedSession {
          const id = `row-${String(info.sessionId)}`;
          return {
            session: { id, info },
            end: () => ended.push(id),
            setHostSessionId: () => undefined,
          };
        },
      },
    });
    await drive.run('connectSession');
    await drive.run('connectSession', { sessionId: 'named' });

    actions.dispose();

    expect(ended).toEqual(['row-drive-docs-1', 'row-named']);
    expect([...drive.actions.keys()]).toEqual([]);
  });

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
    settings: () => ({ scriptPath: '/script.py' }),
    services: {
      files,
      processes,
      log: () => undefined,
      homeDir: '/',
      runMode: 'live',
      paths: posixPaths,
      selfTest: null,
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
  const exports = part.exports as DocsMainExports;
  return { part, exports, files, processes, invoke, emit, emitted };
}

const INDEX_DOCUMENT: IndexDocument = {
  schemaVersion: 4,
  generatedAt: '2026-10-20T00:00:00Z',
  entries: [],
  contexts: [],
};

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
      deadlineSeconds: null,
      harness: 'claude',
    };
    docs.emit('sessions.connected', { id: 'row-1', info });

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
      deadlineSeconds: null,
      harness: 'claude',
    };
    docs.emit('sessions.connected', { id: 'row-1', info });

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

  it('sessionSource_HostSessionChanged_RebuildAllowsItsDocWrites', async () => {
    const docs = startDocsPart();
    const path = '/p/notes.md';
    await docs.files.makeFolder('/p');
    await docs.files.write(path, 'one');
    const document: IndexDocument = {
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
          lastLoaded: null,
        },
      ],
    };
    docs.processes.script(
      'python3',
      ['-X', 'utf8', '/script.py', 'session', 'new-host'],
      {
        code: 0,
        stdout: JSON.stringify(document),
        stderr: '',
        timedOut: false,
      },
    );
    const info: SessionInfo = {
      sessionId: 'old-host',
      projectDir: '/p',
      deadlineSeconds: null,
      harness: 'claude',
    };
    docs.emit('sessions.connected', { id: 'row-1', info });
    docs.emit('sessions.hostSessionChanged', {
      id: 'row-1',
      info: { ...info, sessionId: 'new-host' },
    });
    await expect(
      docs.invoke('writeDoc', path, 'two', 'one') as Promise<unknown>,
    ).rejects.toThrow(path);

    await docs.invoke('rebuildIndex', 'session:row-1');

    expect(await docs.invoke('writeDoc', path, 'two', 'one')).toEqual({
      type: 'written',
    });
  });

  it('pluginStatus_MachineSourceNoClones_Empty', async () => {
    const docs = startDocsPart();
    await docs.invoke('loadIndex', 'machine');

    expect(await docs.invoke('pluginStatus', 'machine', false)).toEqual({
      clones: [],
    });
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

  it('exports_MachineIndexReads_EmitNothing', async () => {
    const docs = startDocsPart();

    await docs.exports.machineIndex();
    await docs.exports.rebuildMachineIndex();

    expect(docs.emitted).toEqual([]);
  });
});
