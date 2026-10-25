import { describe, expect, it, vi } from 'vitest';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  IndexDocument,
  IndexEntry,
  IndexLoad,
  IndexSource,
} from '../contract';
import {
  createIndexSourceRegistry,
  createMachineSource,
  createSessionSource,
  type SessionSourceSpec,
} from './index-sources';

const HOME = '/Users/u';
const SCRIPT = '/s/docs_index.py';
const INDEX_FILE = '/Users/u/.agents/wigley-docs/index.json';
const BUILD = ['-X', 'utf8', SCRIPT, 'build'];

const ENTRY: IndexEntry = {
  id: '/Users/u/.claude/CLAUDE.md',
  kind: 'instructions',
  source: 'global',
  owner: 'mine',
  repo: null,
  root: null,
  plugin: null,
  path: '/Users/u/.claude/CLAUDE.md',
  line: null,
  title: 'Mine',
  meta: {},
  walked: [],
};

function documentOf(entries: IndexEntry[]): IndexDocument {
  return {
    schemaVersion: 3,
    generatedAt: '2026-10-20T00:00:00Z',
    entries,
    contexts: [],
  };
}

function exited(code: number, stderr = '', stdout = ''): ProcessResult {
  return { code, stdout, stderr, timedOut: false };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

// `machine` is the machine source; `session(spec)` builds the source of row
// `row-1`; `registry` holds no source until a test adds one.
function setUp(scriptPath = SCRIPT) {
  const files = createMemoryFiles();
  const processes = new FakeProcesses();
  const logged: [string, string][] = [];
  const deps = {
    files,
    processes,
    homeDir: HOME,
    scriptPath: () => scriptPath,
    log: (source: string, message: string) => logged.push([source, message]),
    paths: posixPaths,
  };
  const machine = createMachineSource(deps);
  const session = (spec: SessionSourceSpec) =>
    createSessionSource(deps, 'row-1', spec);
  const registry = createIndexSourceRegistry();
  return { files, processes, logged, machine, session, registry };
}

function rebuildOf(source: IndexSource): Promise<IndexLoad> {
  if (source.rebuild === undefined) {
    throw new Error(`${source.id} has no rebuild`);
  }
  return source.rebuild();
}

describe('machine source', () => {
  it('load_NoFile_BuildingMessage', async () => {
    const test = setUp();

    expect(await test.machine.load()).toEqual({
      document: null,
      message: 'No docs index yet — building…',
    });
  });

  it('load_SchemaFour_PinnedMessage', async () => {
    const test = setUp();
    await test.files.write(INDEX_FILE, '{"schemaVersion":4}');

    test.registry.add(test.machine);

    const load = await test.registry.load('machine');

    expect(load.message).toBe(
      'Unsupported docs index schema 4; this app reads 3',
    );
    expect(test.registry.loadedEntries()).toEqual([]);
  });

  it('rebuild_ExitZero_ReadsTheNewFile', async () => {
    const test = setUp();
    test.processes.script('python3', BUILD, exited(0));
    const machine = createMachineSource({
      files: test.files,
      processes: {
        run: async (command, args) => {
          const result = await test.processes.run(command, args);
          await test.files.write(
            INDEX_FILE,
            JSON.stringify(documentOf([ENTRY])),
          );
          return result;
        },
      },
      homeDir: HOME,
      scriptPath: () => SCRIPT,
      log: () => undefined,
      paths: posixPaths,
    });

    test.registry.add(machine);

    const load = await test.registry.rebuild('machine');

    expect(load.document?.entries).toEqual([ENTRY]);
    expect(load.message).toBeNull();
    expect(test.registry.loadedEntries()).toEqual([ENTRY]);
  });

  it('rebuild_ExitNonZero_LastStderrLineAndLog', async () => {
    const test = setUp();
    await test.files.write(INDEX_FILE, JSON.stringify(documentOf([ENTRY])));
    const stderr =
      'warning: slow disk\nTraceback (most recent call last):\n' +
      '  File "docs_index.py", line 9\nValueError: bad root\n\n';
    test.processes.script('python3', BUILD, exited(1, stderr));

    const load = await rebuildOf(test.machine);

    expect(load.message).toBe('ValueError: bad root');
    expect(load.document?.entries).toEqual([ENTRY]);
    expect(test.logged).toEqual([
      ['docs', `docs_index.py build exited 1: ${stderr.trim()}`],
    ]);
  });

  it('rebuild_ExitNonZeroNoStderr_ExitCodeMessage', async () => {
    const test = setUp();
    test.processes.script('python3', BUILD, exited(3));

    const load = await rebuildOf(test.machine);

    expect(load.message).toBe('docs_index.py exited 3');
  });

  it('rebuild_RunRejects_RejectionText', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      BUILD,
      new Error('Could not run python3: spawn python3 ENOENT'),
    );

    const load = await rebuildOf(test.machine);

    expect(load.message).toBe('Could not run python3: spawn python3 ENOENT');
  });

  it('rebuild_NoScript_NotFoundMessage', async () => {
    const test = setUp('');

    const load = await rebuildOf(test.machine);

    expect(load.message).toBe('docs_index.py not found — set docs.scriptPath');
    expect(test.processes.runs).toEqual([]);
  });

  it('rebuild_CalledTwiceWhileRunning_OneMoreBuild', async () => {
    const test = setUp();
    const firstRun = deferred<ProcessResult>();
    test.processes.script('python3', BUILD, firstRun.promise);

    const first = rebuildOf(test.machine);
    const second = rebuildOf(test.machine);
    const third = rebuildOf(test.machine);
    await vi.waitFor(() => expect(test.processes.runs).toHaveLength(1));
    const secondRun = deferred<ProcessResult>();
    test.processes.script('python3', BUILD, secondRun.promise);
    firstRun.resolve(exited(0));
    await first;
    secondRun.resolve(exited(0));
    const [secondLoad, thirdLoad] = await Promise.all([second, third]);

    expect(test.processes.runs).toHaveLength(2);
    expect(secondLoad).toBe(thirdLoad);
  });
});

describe('session source', () => {
  it('load_ClaudeSession_RunsSession', async () => {
    const test = setUp();
    const document = documentOf([ENTRY]);
    test.processes.script(
      'python3',
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
      exited(0, '', JSON.stringify(document)),
    );

    const load = await test
      .session({
        hostSessionId: 'abc',
        projectDir: '/p',
        harness: 'claude',
      })
      .load();

    expect(test.processes.runs.map((run) => run.args)).toEqual([
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
    ]);
    expect(load).toEqual({ document, message: null });
  });

  it('load_NullHarnessWithHostId_RunsSession', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
      exited(0),
    );

    await test
      .session({
        hostSessionId: 'abc',
        projectDir: '/p',
        harness: null,
      })
      .load();

    expect(test.processes.runs.map((run) => run.args)).toEqual([
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
    ]);
  });

  it('load_CodexWithFolder_RunsContext', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      ['-X', 'utf8', SCRIPT, 'context', '/p'],
      exited(0),
    );

    await test
      .session({
        hostSessionId: null,
        projectDir: '/p',
        harness: 'codex',
      })
      .load();

    expect(test.processes.runs.map((run) => run.args)).toEqual([
      ['-X', 'utf8', SCRIPT, 'context', '/p'],
    ]);
  });

  it('load_NoFolder_Message', async () => {
    const test = setUp();

    const load = await test
      .session({
        hostSessionId: null,
        projectDir: null,
        harness: 'codex',
      })
      .load();

    expect(load).toEqual({
      document: null,
      message: 'No project folder is known for this session',
    });
    expect(test.processes.runs).toEqual([]);
  });

  it('load_ExitZeroWithStderr_Logged', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
      exited(0, 'warn', JSON.stringify(documentOf([]))),
    );

    await test
      .session({
        hostSessionId: 'abc',
        projectDir: null,
        harness: 'claude',
      })
      .load();

    expect(test.logged).toEqual([
      ['docs', 'docs_index.py session wrote to stderr: warn'],
    ]);
  });

  it('load_SessionFails_FallsBackToContextAndLogs', async () => {
    const test = setUp();
    const document = documentOf([ENTRY]);
    test.processes.script(
      'python3',
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
      exited(1, 'LookupError: no transcript for abc'),
    );
    test.processes.script(
      'python3',
      ['-X', 'utf8', SCRIPT, 'context', '/p'],
      exited(0, '', JSON.stringify(document)),
    );

    const load = await test
      .session({
        hostSessionId: 'abc',
        projectDir: '/p',
        harness: 'claude',
      })
      .load();

    expect(load).toEqual({ document, message: null });
    expect(test.processes.runs.map((run) => run.args)).toEqual([
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
      ['-X', 'utf8', SCRIPT, 'context', '/p'],
    ]);
    expect(test.logged).toContainEqual([
      'docs',
      'session abc not indexed (LookupError: no transcript for abc); indexing /p instead',
    ]);
  });

  it('load_NoScript_NotFoundMessageWithoutFallback', async () => {
    const test = setUp('');

    const load = await test
      .session({
        hostSessionId: 'abc',
        projectDir: '/p',
        harness: 'claude',
      })
      .load();

    expect(load).toEqual({
      document: null,
      message: 'docs_index.py not found — set docs.scriptPath',
    });
    expect(test.processes.runs).toEqual([]);
    expect(test.logged).toEqual([]);
  });

  it('load_SessionFailsNoFolder_SessionMessage', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
      exited(1, 'LookupError: no transcript for abc'),
    );

    const load = await test
      .session({
        hostSessionId: 'abc',
        projectDir: null,
        harness: 'claude',
      })
      .load();

    expect(load).toEqual({
      document: null,
      message: 'LookupError: no transcript for abc',
    });
    expect(test.processes.runs).toHaveLength(1);
  });
});

describe('registry', () => {
  const SESSION_ENTRY: IndexEntry = {
    ...ENTRY,
    id: '/p/AGENTS.md',
    path: '/p/AGENTS.md',
    source: 'repo',
    repo: 'p',
    root: '/p',
  };
  const SPEC: SessionSourceSpec = {
    hostSessionId: 'abc',
    projectDir: '/p',
    harness: 'claude',
  };

  // A source with no `rebuild` whose `load` gives `load()`'s result.
  function fixed(id: string, load: () => Promise<IndexLoad>): IndexSource {
    return { id, title: `${id} title`, load };
  }

  function loaded(entries: IndexEntry[]): () => Promise<IndexLoad> {
    return () =>
      Promise.resolve({ document: documentOf(entries), message: null });
  }

  async function withSessionLoaded() {
    const test = setUp();
    await test.files.write(INDEX_FILE, JSON.stringify(documentOf([ENTRY])));
    test.processes.script(
      'python3',
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
      exited(0, '', JSON.stringify(documentOf([SESSION_ENTRY]))),
    );
    test.registry.add(test.machine);
    test.registry.add(test.session(SPEC));
    await test.registry.load('machine');
    await test.registry.load('session:row-1');
    return test;
  }

  it('loadedEntries_MachineAndSession_Both', async () => {
    const test = await withSessionLoaded();

    expect(test.registry.loadedEntries()).toEqual([ENTRY, SESSION_ENTRY]);
  });

  it('sourceEntries_EachSource_ItsOwnEntries', async () => {
    const test = await withSessionLoaded();

    expect(test.registry.sourceEntries('machine')).toEqual([ENTRY]);
    expect(test.registry.sourceEntries('session:row-1')).toEqual([
      SESSION_ENTRY,
    ]);
  });

  it('sourceEntries_UnknownId_Throws', () => {
    const { registry } = setUp();

    expect(() => registry.sourceEntries('nope')).toThrow(
      'No docs index source nope',
    );
  });

  it('loadedEntries_NoMachineIndex_SessionEntries', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      ['-X', 'utf8', SCRIPT, 'session', 'abc'],
      exited(0, '', JSON.stringify(documentOf([SESSION_ENTRY]))),
    );
    test.registry.add(test.machine);
    test.registry.add(test.session(SPEC));

    await test.registry.load('machine');
    await test.registry.load('session:row-1');

    expect(test.registry.loadedEntries()).toEqual([SESSION_ENTRY]);
  });

  it('load_MachineSource_TitleAndCanRebuild', async () => {
    const test = setUp();
    test.registry.add(test.machine);

    const read = await test.registry.load('machine');

    expect(read).toEqual({
      document: null,
      message: 'No docs index yet — building…',
      title: 'machine index',
      canRebuild: true,
    });
  });

  it('add_TakenId_Throws', () => {
    const { registry } = setUp();
    registry.add(fixed('x', loaded([])));

    expect(() => registry.add(fixed('x', loaded([])))).toThrow(
      'Docs index source x is already registered',
    );
  });

  it('rebuild_NoRebuild_RunsLoad', async () => {
    const { registry } = setUp();
    const load = vi.fn(loaded([ENTRY]));
    registry.add(fixed('x', load));

    const read = await registry.rebuild('x');

    expect(load).toHaveBeenCalledOnce();
    expect(read.title).toBe('x title');
    expect(read.canRebuild).toBe(false);
    expect(registry.loadedEntries()).toEqual([ENTRY]);
  });

  it('dispose_DropsEntries', async () => {
    const { registry } = setUp();
    const first = registry.add(fixed('x', loaded([ENTRY])));
    registry.add(fixed('y', loaded([SESSION_ENTRY])));
    await registry.load('x');
    await registry.load('y');

    first.dispose();
    first.dispose();

    expect(registry.loadedEntries()).toEqual([SESSION_ENTRY]);
  });

  it('dispose_DuringLoad_KeepsNoEntries', async () => {
    const { registry } = setUp();
    const running = deferred<IndexLoad>();
    const added = registry.add(fixed('x', () => running.promise));
    const load = registry.load('x');

    added.dispose();
    running.resolve({ document: documentOf([ENTRY]), message: null });
    await load;

    expect(registry.loadedEntries()).toEqual([]);
  });

  it('dispose_ThenSameIdAdded_OldLoadKeepsNoEntries', async () => {
    const { registry } = setUp();
    const running = deferred<IndexLoad>();
    const added = registry.add(fixed('x', () => running.promise));
    const load = registry.load('x');
    added.dispose();
    registry.add(fixed('x', loaded([SESSION_ENTRY])));
    await registry.load('x');

    running.resolve({ document: documentOf([ENTRY]), message: null });
    await load;

    expect(registry.loadedEntries()).toEqual([SESSION_ENTRY]);
  });

  it('load_UnknownId_Rejects', async () => {
    const { registry } = setUp();

    await expect(registry.load('session:x')).rejects.toThrow(
      'No docs index source session:x',
    );
  });

  it('load_NoDocument_ClearsEntries', async () => {
    const { registry } = setUp();
    let next = loaded([ENTRY]);
    registry.add(fixed('x', () => next()));
    await registry.load('x');

    next = () => Promise.resolve({ document: null, message: 'gone' });
    await registry.load('x');

    expect(registry.loadedEntries()).toEqual([]);
  });

  it('load_OlderRunResolvesAfterNewer_KeepsNewerEntries', async () => {
    const { registry } = setUp();
    const older = Promise.withResolvers<IndexLoad>();
    let next = () => older.promise;
    registry.add(fixed('x', () => next()));
    const olderLoad = registry.load('x');
    next = loaded([SESSION_ENTRY]);
    await registry.load('x');

    older.resolve({ document: documentOf([ENTRY]), message: null });
    const olderRead = await olderLoad;

    expect(olderRead.document?.entries).toEqual([ENTRY]);
    expect(registry.loadedEntries()).toEqual([SESSION_ENTRY]);
  });

  it('load_OlderRunRejectsAfterNewer_KeepsNewerEntries', async () => {
    const { registry } = setUp();
    const older = Promise.withResolvers<IndexLoad>();
    let next = () => older.promise;
    registry.add(fixed('x', () => next()));
    const olderLoad = registry.load('x');
    next = loaded([SESSION_ENTRY]);
    await registry.load('x');

    older.reject(new Error('older run failed'));

    await expect(olderLoad).rejects.toThrow('older run failed');
    expect(registry.loadedEntries()).toEqual([SESSION_ENTRY]);
  });

  it('load_Throws_ClearsEntriesAndRejects', async () => {
    const { registry } = setUp();
    let next = loaded([ENTRY]);
    registry.add(fixed('x', () => next()));
    await registry.load('x');

    next = () => Promise.reject(new Error('unreadable'));

    await expect(registry.load('x')).rejects.toThrow('unreadable');
    expect(registry.loadedEntries()).toEqual([]);
  });
});
