import { describe, expect, it, vi } from 'vitest';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { IndexDocument, IndexEntry } from '../contract';
import { createIndexSources } from './index-sources';

const HOME = '/Users/u';
const SCRIPT = '/s/docs_index.py';
const INDEX_FILE = '/Users/u/.agents/wigley-docs/index.json';
const BUILD = [SCRIPT, 'build'];

const ENTRY: IndexEntry = {
  id: '/Users/u/.claude/CLAUDE.md',
  kind: 'instructions',
  source: 'global',
  repo: null,
  root: null,
  plugin: null,
  path: '/Users/u/.claude/CLAUDE.md',
  line: null,
  title: 'Mine',
  meta: {},
};

function documentOf(entries: IndexEntry[]): IndexDocument {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-20T00:00:00Z',
    entries,
    contexts: [],
  };
}

function exited(code: number, stderr = '', stdout = ''): ProcessResult {
  return { code, stdout, stderr };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function setUp(scriptPath = SCRIPT) {
  const files = createMemoryFiles();
  const processes = new FakeProcesses();
  const logged: [string, string][] = [];
  const sources = createIndexSources({
    files,
    processes,
    homeDir: HOME,
    scriptPath,
    log: (source, message) => logged.push([source, message]),
  });
  return { files, processes, logged, sources };
}

describe('machine source', () => {
  it('machineIndex_NoFile_BuildingMessage', async () => {
    const test = setUp();

    expect(await test.sources.machineIndex()).toEqual({
      document: null,
      message: 'No docs index yet — building…',
    });
  });

  it('machineIndex_SchemaTwo_PinnedMessage', async () => {
    const test = setUp();
    await test.files.write(INDEX_FILE, '{"schemaVersion":2}');

    const load = await test.sources.machineIndex();

    expect(load.message).toBe(
      'Unsupported docs index schema 2; this app reads 1',
    );
    expect(test.sources.loadedEntries()).toEqual([]);
  });

  it('rebuild_ExitZero_ReadsTheNewFile', async () => {
    const test = setUp();
    test.processes.script('python3', BUILD, exited(0));
    const sources = createIndexSources({
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
      scriptPath: SCRIPT,
      log: () => undefined,
    });

    const load = await sources.rebuild();

    expect(load.document?.entries).toEqual([ENTRY]);
    expect(load.message).toBeNull();
    expect(sources.loadedEntries()).toEqual([ENTRY]);
  });

  it('rebuild_ExitNonZero_LastStderrLineAndLog', async () => {
    const test = setUp();
    await test.files.write(INDEX_FILE, JSON.stringify(documentOf([ENTRY])));
    const stderr =
      'warning: slow disk\nTraceback (most recent call last):\n' +
      '  File "docs_index.py", line 9\nValueError: bad root\n\n';
    test.processes.script('python3', BUILD, exited(1, stderr));

    const load = await test.sources.rebuild();

    expect(load.message).toBe('ValueError: bad root');
    expect(load.document?.entries).toEqual([ENTRY]);
    expect(test.logged).toEqual([
      ['docs', `docs_index.py build exited 1: ${stderr.trim()}`],
    ]);
  });

  it('rebuild_ExitNonZeroNoStderr_ExitCodeMessage', async () => {
    const test = setUp();
    test.processes.script('python3', BUILD, exited(3));

    const load = await test.sources.rebuild();

    expect(load.message).toBe('docs_index.py exited 3');
  });

  it('rebuild_RunRejects_RejectionText', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      BUILD,
      new Error('Could not run python3: spawn python3 ENOENT'),
    );

    const load = await test.sources.rebuild();

    expect(load.message).toBe('Could not run python3: spawn python3 ENOENT');
  });

  it('rebuild_NoScript_NotFoundMessage', async () => {
    const test = setUp('');

    const load = await test.sources.rebuild();

    expect(load.message).toBe('docs_index.py not found — set docs.scriptPath');
    expect(test.processes.runs).toEqual([]);
  });

  it('rebuild_CalledTwiceWhileRunning_OneMoreBuild', async () => {
    const test = setUp();
    const firstRun = deferred<ProcessResult>();
    test.processes.script('python3', BUILD, firstRun.promise);

    const first = test.sources.rebuild();
    const second = test.sources.rebuild();
    const third = test.sources.rebuild();
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
  it('sessionIndex_ClaudeSession_RunsSession', async () => {
    const test = setUp();
    const document = documentOf([ENTRY]);
    test.processes.script(
      'python3',
      [SCRIPT, 'session', 'abc'],
      exited(0, '', JSON.stringify(document)),
    );

    const load = await test.sources.sessionIndex({
      hostSessionId: 'abc',
      projectDir: '/p',
      harness: 'claude',
    });

    expect(test.processes.runs.map((run) => run.args)).toEqual([
      [SCRIPT, 'session', 'abc'],
    ]);
    expect(load).toEqual({ document, message: null });
  });

  it('sessionIndex_NullHarnessWithHostId_RunsSession', async () => {
    const test = setUp();
    test.processes.script('python3', [SCRIPT, 'session', 'abc'], exited(0));

    await test.sources.sessionIndex({
      hostSessionId: 'abc',
      projectDir: '/p',
      harness: null,
    });

    expect(test.processes.runs.map((run) => run.args)).toEqual([
      [SCRIPT, 'session', 'abc'],
    ]);
  });

  it('sessionIndex_CodexWithFolder_RunsContext', async () => {
    const test = setUp();
    test.processes.script('python3', [SCRIPT, 'context', '/p'], exited(0));

    await test.sources.sessionIndex({
      hostSessionId: null,
      projectDir: '/p',
      harness: 'codex',
    });

    expect(test.processes.runs.map((run) => run.args)).toEqual([
      [SCRIPT, 'context', '/p'],
    ]);
  });

  it('sessionIndex_NoFolder_Message', async () => {
    const test = setUp();

    const load = await test.sources.sessionIndex({
      hostSessionId: null,
      projectDir: null,
      harness: 'codex',
    });

    expect(load).toEqual({
      document: null,
      message: 'No project folder is known for this session',
    });
    expect(test.processes.runs).toEqual([]);
  });

  it('sessionIndex_ExitZeroWithStderr_Logged', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      [SCRIPT, 'session', 'abc'],
      exited(0, 'warn', JSON.stringify(documentOf([]))),
    );

    await test.sources.sessionIndex({
      hostSessionId: 'abc',
      projectDir: null,
      harness: 'claude',
    });

    expect(test.logged).toEqual([
      ['docs', 'docs_index.py session wrote to stderr: warn'],
    ]);
  });

  it('sessionIndex_SessionFails_FallsBackToContextAndLogs', async () => {
    const test = setUp();
    const document = documentOf([ENTRY]);
    test.processes.script(
      'python3',
      [SCRIPT, 'session', 'abc'],
      exited(1, 'LookupError: no transcript for abc'),
    );
    test.processes.script(
      'python3',
      [SCRIPT, 'context', '/p'],
      exited(0, '', JSON.stringify(document)),
    );

    const load = await test.sources.sessionIndex({
      hostSessionId: 'abc',
      projectDir: '/p',
      harness: 'claude',
    });

    expect(load).toEqual({ document, message: null });
    expect(test.processes.runs.map((run) => run.args)).toEqual([
      [SCRIPT, 'session', 'abc'],
      [SCRIPT, 'context', '/p'],
    ]);
    expect(test.logged).toContainEqual([
      'docs',
      'session abc not indexed (LookupError: no transcript for abc); indexing /p instead',
    ]);
  });

  it('sessionIndex_NoScript_NotFoundMessageWithoutFallback', async () => {
    const test = setUp('');

    const load = await test.sources.sessionIndex({
      hostSessionId: 'abc',
      projectDir: '/p',
      harness: 'claude',
    });

    expect(load).toEqual({
      document: null,
      message: 'docs_index.py not found — set docs.scriptPath',
    });
    expect(test.processes.runs).toEqual([]);
    expect(test.logged).toEqual([]);
  });

  it('sessionIndex_SessionFailsNoFolder_SessionMessage', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      [SCRIPT, 'session', 'abc'],
      exited(1, 'LookupError: no transcript for abc'),
    );

    const load = await test.sources.sessionIndex({
      hostSessionId: 'abc',
      projectDir: null,
      harness: 'claude',
    });

    expect(load).toEqual({
      document: null,
      message: 'LookupError: no transcript for abc',
    });
    expect(test.processes.runs).toHaveLength(1);
  });
});

describe('loadedEntries', () => {
  const SPEC = { hostSessionId: 'abc', projectDir: '/p', harness: 'claude' };
  const SESSION_ENTRY: IndexEntry = {
    ...ENTRY,
    id: '/p/AGENTS.md',
    path: '/p/AGENTS.md',
    source: 'repo',
    repo: 'p',
    root: '/p',
  };

  async function withSessionLoaded() {
    const test = setUp();
    await test.files.write(INDEX_FILE, JSON.stringify(documentOf([ENTRY])));
    await test.sources.machineIndex();
    test.processes.script(
      'python3',
      [SCRIPT, 'session', 'abc'],
      exited(0, '', JSON.stringify(documentOf([SESSION_ENTRY]))),
    );
    await test.sources.sessionIndex({ ...SPEC, harness: 'claude' });
    return test;
  }

  it('loadedEntries_MachineAndSession_Both', async () => {
    const test = await withSessionLoaded();

    expect(test.sources.loadedEntries()).toEqual([ENTRY, SESSION_ENTRY]);
  });

  it('loadedEntries_NoMachineIndex_SessionEntries', async () => {
    const test = setUp();
    test.processes.script(
      'python3',
      [SCRIPT, 'session', 'abc'],
      exited(0, '', JSON.stringify(documentOf([SESSION_ENTRY]))),
    );

    await test.sources.sessionIndex({ ...SPEC, harness: 'claude' });

    expect(test.sources.loadedEntries()).toEqual([SESSION_ENTRY]);
  });

  it('retainSessions_SessionKept_EntriesStay', async () => {
    const test = await withSessionLoaded();

    test.sources.retainSessions([{ ...SPEC, harness: 'claude' }]);

    expect(test.sources.loadedEntries()).toEqual([ENTRY, SESSION_ENTRY]);
  });

  it('retainSessions_SessionGone_EntriesDropped', async () => {
    const test = await withSessionLoaded();

    test.sources.retainSessions([]);

    expect(test.sources.loadedEntries()).toEqual([ENTRY]);
  });
});
