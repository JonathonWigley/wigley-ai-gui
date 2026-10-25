import { describe, expect, it } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
import type { RunMode } from '../../../contracts/plugin';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { FakeProcesses } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { ConnectedSession, SessionInfo } from '../../sessions/contract';
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

// The docs drive actions over a fresh home, whose sessions throw on connect,
// once `started` settles. `sent` holds each channel message, in order.
async function driveConnectingNothing(
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
      connect: () => {
        throw new Error('not reached');
      },
    },
    channel: { send: (message, data) => sent.push([message, data]) },
  });
  return { ...drive, sent };
}

describe('docs drive actions', () => {
  it('dispose removes the actions and ends each session connectSession connected', async () => {
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
        connect(info: SessionInfo): ConnectedSession {
          const id = `row-${String(info.sessionId)}`;
          return {
            session: { id, info },
            call: () => Promise.reject(new Error('no tools')),
            end: () => ended.push(id),
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
    const drive = await driveConnectingNothing();

    await expect(drive.run('connectSession', { sessionId: 3 })).rejects.toThrow(
      'sessionId must be a string',
    );
  });

  it.each([
    ['seed', -1, 'indexDelayMs must not be negative'],
    ['seed', 'slow', 'indexDelayMs must be a number'],
    ['connectSession', -1, 'indexDelayMs must not be negative'],
    ['connectSession', 'slow', 'indexDelayMs must be a number'],
  ])('%s rejects indexDelayMs %j', async (action, indexDelayMs, message) => {
    const drive = await driveConnectingNothing();

    await expect(drive.run(action, { indexDelayMs })).rejects.toThrow(message);
  });

  it('driveOpenDoc_SendsOpenDocMessage', async () => {
    const drive = await driveConnectingNothing();

    await drive.run('openDoc', { path: CLAUDE_MD });

    expect(drive.sent).toEqual([['openDoc', { path: CLAUDE_MD, line: null }]]);
  });

  it.each([0, -2, 1.5])(
    'driveOpenDoc_LineNotPositiveWhole_Rejects (%j)',
    async (line) => {
      const drive = await driveConnectingNothing();

      await expect(
        drive.run('openDoc', { path: CLAUDE_MD, line }),
      ).rejects.toThrow('line must be a positive whole number');
      expect(drive.sent).toEqual([]);
    },
  );

  it('driveOpenDoc_WaitsForStart', async () => {
    const started = Promise.withResolvers<void>();
    const drive = await driveConnectingNothing(started.promise);

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
// `emit` fires a sessions event at docs.
function startDocsPart() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, (payload: unknown) => void>();
  const processes = new FakeProcesses();
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
    },
    settings: () => ({ scriptPath: '/script.py' }),
    services: {
      files: createMemoryFiles(),
      processes,
      log: () => undefined,
      homeDir: '/',
      runMode: 'live',
      paths: posixPaths,
      selfTest: null,
    },
    dependency: () => ({}),
    drive: null,
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
  return { part, processes, invoke, emit };
}

const SESSION_DOCUMENT: IndexDocument = {
  schemaVersion: 3,
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
        stdout: JSON.stringify(SESSION_DOCUMENT),
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
      document: SESSION_DOCUMENT,
      message: null,
      title: 'session index',
      canRebuild: false,
    });
    docs.emit('sessions.ended', { sessionId: 'row-1' });
    await expect(docs.invoke('loadIndex', 'session:row-1')).rejects.toThrow(
      'No docs index source session:row-1',
    );
  });

  it('pluginStatus_UnknownSource_Rejects', async () => {
    const docs = startDocsPart();

    await expect(docs.invoke('pluginStatus', 'nope', false)).rejects.toThrow(
      'No docs index source nope',
    );
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
    const exports = docs.part.exports as DocsMainExports;
    exports.addSource({
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
});
