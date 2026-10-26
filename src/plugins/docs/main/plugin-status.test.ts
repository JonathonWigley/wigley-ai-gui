import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { IndexEntry } from '../contract';
import { readPluginStatus } from './plugin-status';

const ROOT = '/Users/u/dev/m';
const PLUGIN = `${ROOT}/plugins/w`;
const CLAUDE_CACHE = '/Users/u/.claude/plugins/cache/m/w/1.0.0';
const CODEX_CACHE = '/Users/u/.codex/plugins/cache/m/w/0.1.0';
const HOOKS_JSON = `${PLUGIN}/hooks/hooks.json`;
const HOOKS_TEXT = '{"hooks":{}}\n';
// `git hash-object` of `a\n` and of HOOKS_TEXT.
const A_BLOB = '78981922613b2afb6025042ff6bd878ac1994e85';
const HOOKS_BLOB = 'bd0b5424fe275aa7a198b425a5621b5807b6da3a';

function entry(fields: Partial<IndexEntry> & { id: string }): IndexEntry {
  return {
    kind: 'skill',
    source: 'repo',
    owner: 'mine',
    repo: 'm',
    root: ROOT,
    plugin: 'w@m',
    path: fields.id,
    line: null,
    title: fields.id,
    meta: {},
    walked: [],
    lastLoaded: null,
    ...fields,
  };
}

function installed(claudePath: string, codexPath: string) {
  return {
    installed: [
      { harness: 'claude', version: '1.0.0', path: claudePath },
      { harness: 'codex', version: '0.1.0', path: codexPath },
    ],
  };
}

const A = entry({
  id: `${PLUGIN}/skills/a/SKILL.md`,
  meta: installed(
    `${CLAUDE_CACHE}/skills/a/SKILL.md`,
    `${CODEX_CACHE}/skills/a/SKILL.md`,
  ),
});
const B = entry({ id: `${PLUGIN}/skills/b/SKILL.md`, meta: { installed: [] } });
const H0 = entry({
  id: `${HOOKS_JSON}#hook:PreToolUse:0`,
  kind: 'hook',
  path: HOOKS_JSON,
  meta: installed(
    `${CLAUDE_CACHE}/hooks/hooks.json`,
    `${CODEX_CACHE}/hooks/hooks.json`,
  ),
});
const H1 = { ...H0, id: `${HOOKS_JSON}#hook:PreToolUse:1` };
const CLAUDE_PLUGIN = entry({
  id: `${CLAUDE_CACHE}/.claude-plugin/plugin.json`,
  kind: 'plugin',
  source: 'plugin',
  repo: null,
  root: CLAUDE_CACHE,
  meta: { harness: 'claude' },
});
const CODEX_PLUGIN = entry({
  id: `${CODEX_CACHE}/.codex-plugin/plugin.json`,
  kind: 'plugin',
  source: 'plugin',
  repo: null,
  root: CODEX_CACHE,
  meta: { harness: 'codex' },
});
const AGENTS = entry({
  id: `${ROOT}/AGENTS.md`,
  kind: 'instructions',
  plugin: null,
});

const EVERY_ENTRY = [A, B, H0, H1, CLAUDE_PLUGIN, CODEX_PLUGIN, AGENTS];

function git(...args: string[]): string[] {
  return ['-C', ROOT, ...args];
}

const FETCH = git('fetch', '--quiet');
const UPSTREAM = git(
  'rev-parse',
  '--abbrev-ref',
  '--symbolic-full-name',
  '@{u}',
);
const STATUS = git(
  'status',
  '--porcelain=v1',
  '-z',
  '--untracked-files=all',
  '--',
  'plugins/w',
);
const DIFF = git('diff', '--name-only', '-z', '@{u}...HEAD', '--', 'plugins/w');
const LS_TREE = git('ls-tree', '-r', '-z', '@{u}', '--', 'plugins/w');
const FETCH_HEAD = git('rev-parse', '--git-path', 'FETCH_HEAD');

function exited(code: number, stdout = '', stderr = ''): ProcessResult {
  return { code, stdout, stderr, timedOut: false };
}

function treeRecord(sha: string, path: string): string {
  return `100644 blob ${sha}\t${path}\0`;
}

const CLEAN_TREE =
  treeRecord(A_BLOB, 'plugins/w/skills/a/SKILL.md') +
  treeRecord(HOOKS_BLOB, 'plugins/w/hooks/hooks.json');

// A clean clone at ROOT with an upstream: every copy matches the upstream
// blob, and `FETCH_HEAD` is `.git/FETCH_HEAD`, absent until a test writes it.
async function setUp() {
  const clock = { time: 0, now: () => clock.time };
  const files = createMemoryFiles(clock);
  await files.write(`${CLAUDE_CACHE}/skills/a/SKILL.md`, 'a\n');
  await files.write(`${CODEX_CACHE}/skills/a/SKILL.md`, 'a\n');
  await files.write(`${CLAUDE_CACHE}/hooks/hooks.json`, HOOKS_TEXT);
  await files.write(`${CODEX_CACHE}/hooks/hooks.json`, HOOKS_TEXT);
  const processes = new FakeProcesses();
  processes.script('git', UPSTREAM, exited(0, 'origin/main\n'));
  processes.script('git', STATUS, exited(0));
  processes.script('git', DIFF, exited(0));
  processes.script('git', LS_TREE, exited(0, CLEAN_TREE));
  processes.script('git', FETCH_HEAD, exited(0, '.git/FETCH_HEAD\n'));
  const logged: [string, string][] = [];
  const deps = {
    processes,
    files,
    paths: posixPaths,
    log: (source: string, message: string) => logged.push([source, message]),
  };
  const read = (entries: readonly IndexEntry[], fetch = false) =>
    readPluginStatus(entries, deps, { fetch });
  return { clock, files, processes, logged, read };
}

async function filesOf(
  read: Awaited<ReturnType<typeof setUp>>['read'],
  entries: readonly IndexEntry[] = EVERY_ENTRY,
) {
  const status = await read(entries);
  return status.clones[0].files;
}

function ranWith(processes: FakeProcesses, arg: string): boolean {
  return processes.runs.some((run) => run.args.includes(arg));
}

describe('readPluginStatus', () => {
  it('readPluginStatus_NoCloneEntries_NoClones', async () => {
    const test = await setUp();

    expect(await test.read([AGENTS])).toEqual({ clones: [] });
    expect(test.processes.runs).toEqual([]);
  });

  it('readPluginStatus_CleanClone_NoFiles', async () => {
    const test = await setUp();

    const status = await test.read([A, H0, H1, CLAUDE_PLUGIN, CODEX_PLUGIN]);

    expect(status).toEqual({
      clones: [{ root: ROOT, fetchedAt: null, fetchFailed: false, files: {} }],
    });
  });

  it('readPluginStatus_Fetch_FirstRunCapped', async () => {
    const test = await setUp();
    test.processes.script('git', FETCH, exited(0));

    await test.read(EVERY_ENTRY, true);

    expect(test.processes.runs[0]).toEqual({
      command: 'git',
      args: FETCH,
      cwd: undefined,
      timeoutMs: 15000,
    });
  });

  it('readPluginStatus_NoFetch_NoFetchRun', async () => {
    const test = await setUp();

    await test.read(EVERY_ENTRY, false);

    expect(ranWith(test.processes, 'fetch')).toBe(false);
  });

  it('readPluginStatus_FetchExitsOne_FetchFailed', async () => {
    const test = await setUp();
    test.processes.script('git', FETCH, exited(1, '', 'no route'));
    test.processes.script(
      'git',
      STATUS,
      exited(0, ' M plugins/w/skills/a/SKILL.md\0'),
    );

    const status = await test.read(EVERY_ENTRY, true);

    expect(status.clones[0].fetchFailed).toBe(true);
    expect(status.clones[0].files[A.id].uncommitted).toBe(true);
  });

  it('readPluginStatus_FetchTimedOut_FetchFailed', async () => {
    const test = await setUp();
    test.processes.script('git', FETCH, {
      code: -1,
      stdout: '',
      stderr: '',
      timedOut: true,
    });

    const status = await test.read(EVERY_ENTRY, true);

    expect(status.clones[0].fetchFailed).toBe(true);
  });

  it('readPluginStatus_TwoReadsFetchAtOnce_OneFetch', async () => {
    const test = await setUp();
    let finishFetch!: (result: ProcessResult) => void;
    test.processes.script(
      'git',
      FETCH,
      new Promise<ProcessResult>((resolve) => {
        finishFetch = resolve;
      }),
    );

    const first = test.read(EVERY_ENTRY, true);
    const second = test.read(EVERY_ENTRY, true);
    finishFetch(exited(1));
    const reads = await Promise.all([first, second]);

    const fetches = test.processes.runs.filter((run) =>
      run.args.includes('fetch'),
    );
    expect(fetches).toHaveLength(1);
    expect(reads.map((read) => read.clones[0].fetchFailed)).toEqual([
      true,
      true,
    ]);
  });

  it('readPluginStatus_StatusRecords_Uncommitted', async () => {
    const test = await setUp();
    test.processes.script(
      'git',
      STATUS,
      exited(
        0,
        ' M plugins/w/skills/a/SKILL.md\0?? plugins/w/skills/b/SKILL.md\0',
      ),
    );

    const files = await filesOf(test.read);

    expect(files[A.id].uncommitted).toBe(true);
    expect(files[B.id].uncommitted).toBe(true);
  });

  it('readPluginStatus_RenameRecord_BothPathsUncommitted', async () => {
    const test = await setUp();
    test.processes.script(
      'git',
      STATUS,
      exited(0, 'R  plugins/w/skills/a/SKILL.md\0plugins/w/hooks/hooks.json\0'),
    );

    const files = await filesOf(test.read);

    expect(files[A.id].uncommitted).toBe(true);
    expect(files[H0.id].uncommitted).toBe(true);
    expect(files[H1.id].uncommitted).toBe(true);
  });

  it('readPluginStatus_WorktreeRenameRecord_NextRecordStillRead', async () => {
    const test = await setUp();
    test.processes.script(
      'git',
      STATUS,
      exited(
        0,
        ' R plugins/w/skills/b/SKILL.md\0plugins/w/hooks/hooks.json\0' +
          ' M plugins/w/skills/a/SKILL.md\0',
      ),
    );

    const files = await filesOf(test.read);

    expect(files[B.id].uncommitted).toBe(true);
    expect(files[H0.id].uncommitted).toBe(true);
    expect(files[A.id].uncommitted).toBe(true);
  });

  it('readPluginStatus_HooksJsonInDiff_EveryHookUnpushed', async () => {
    const test = await setUp();
    test.processes.script(
      'git',
      DIFF,
      exited(0, 'plugins/w/hooks/hooks.json\0'),
    );

    const files = await filesOf(test.read);

    const unpushedOnly = {
      uncommitted: false,
      unpushed: true,
      notInstalled: [],
    };
    expect(files[H0.id]).toEqual(unpushedOnly);
    expect(files[H1.id]).toEqual(unpushedOnly);
  });

  it('readPluginStatus_CrlfCopy_Installed', async () => {
    const test = await setUp();
    await test.files.write(`${CLAUDE_CACHE}/skills/a/SKILL.md`, 'a\r\n');

    const files = await filesOf(test.read);

    expect(files[A.id]).toBeUndefined();
  });

  it('readPluginStatus_CodexCopyDiffers_NotInstalledCodex', async () => {
    const test = await setUp();
    await test.files.write(`${CODEX_CACHE}/skills/a/SKILL.md`, 'old\n');

    const files = await filesOf(test.read);

    expect(files[A.id].notInstalled).toEqual(['codex']);
  });

  it('readPluginStatus_NoCopies_NotInstalledEveryHarness', async () => {
    const test = await setUp();
    test.processes.script(
      'git',
      LS_TREE,
      exited(0, CLEAN_TREE + treeRecord(A_BLOB, 'plugins/w/skills/b/SKILL.md')),
    );

    const files = await filesOf(test.read);

    expect(files[B.id].notInstalled).toEqual(['claude', 'codex']);
  });

  it('readPluginStatus_AbsentUpstream_NotInstalled', async () => {
    const test = await setUp();
    test.processes.script(
      'git',
      LS_TREE,
      exited(0, treeRecord(HOOKS_BLOB, 'plugins/w/hooks/hooks.json')),
    );

    const files = await filesOf(test.read);

    expect(files[A.id].notInstalled).toEqual(['claude', 'codex']);
  });

  it('readPluginStatus_OnlyClaudePlugin_CodexNotChecked', async () => {
    const test = await setUp();
    test.processes.script(
      'git',
      LS_TREE,
      exited(0, CLEAN_TREE + treeRecord(A_BLOB, 'plugins/w/skills/b/SKILL.md')),
    );

    const files = await filesOf(
      test.read,
      EVERY_ENTRY.filter((item) => item !== CODEX_PLUGIN),
    );

    expect(files[B.id].notInstalled).toEqual(['claude']);
  });

  it('readPluginStatus_NoUpstream_OnlyUncommitted', async () => {
    const test = await setUp();
    test.processes.script('git', UPSTREAM, exited(128, '', 'no upstream'));
    test.processes.script(
      'git',
      STATUS,
      exited(0, ' M plugins/w/skills/a/SKILL.md\0'),
    );

    const files = await filesOf(test.read);

    expect(files).toEqual({
      [A.id]: { uncommitted: true, unpushed: false, notInstalled: [] },
    });
    expect(ranWith(test.processes, 'diff')).toBe(false);
    expect(ranWith(test.processes, 'ls-tree')).toBe(false);
  });

  it('readPluginStatus_FetchHead_FetchedAtIso', async () => {
    const test = await setUp();
    test.clock.time = Date.parse('2026-10-24T09:30:00.000Z');
    await test.files.write(`${ROOT}/.git/FETCH_HEAD`, '');

    const status = await test.read(EVERY_ENTRY);

    expect(status.clones[0].fetchedAt).toBe('2026-10-24T09:30:00.000Z');
  });

  it('readPluginStatus_NoFetchHead_FetchedAtNull', async () => {
    const test = await setUp();

    const status = await test.read(EVERY_ENTRY);

    expect(status.clones[0].fetchedAt).toBeNull();
  });

  it('readPluginStatus_GitCannotStart_CloneKept', async () => {
    const test = await setUp();
    const processes = new FakeProcesses();
    const status = await readPluginStatus(
      EVERY_ENTRY,
      { processes, files: test.files, paths: posixPaths, log: () => undefined },
      { fetch: true },
    );

    expect(status).toEqual({
      clones: [{ root: ROOT, fetchedAt: null, fetchFailed: true, files: {} }],
    });
  });

  it('readPluginStatus_DiffFails_KeepsUncommitted', async () => {
    const test = await setUp();
    test.processes.script(
      'git',
      STATUS,
      exited(0, ' M plugins/w/skills/a/SKILL.md\0'),
    );
    test.processes.script('git', DIFF, exited(128, '', 'bad revision'));

    const status = await test.read(EVERY_ENTRY);

    expect(status.clones[0].fetchFailed).toBe(false);
    expect(status.clones[0].files[A.id].uncommitted).toBe(true);
    expect(ranWith(test.processes, 'ls-tree')).toBe(false);
    expect(test.logged).toHaveLength(1);
    expect(test.logged[0][0]).toBe('docs');
    expect(test.logged[0][1]).toMatch(/^plugin status \/Users\/u\/dev\/m: /);
  });

  it('readPluginStatus_TwoClones_OrderOfFirstEntry', async () => {
    const test = await setUp();
    const other = entry({
      id: '/Users/u/dev/n/plugins/x/skills/c/SKILL.md',
      root: '/Users/u/dev/n',
      meta: { installed: [] },
    });

    const status = await test.read([A, other, B]);

    expect(status.clones.map((clone) => clone.root)).toEqual([
      ROOT,
      '/Users/u/dev/n',
    ]);
  });

  it('readPluginStatus_ScopeIsRoot_PathspecDot', async () => {
    const test = await setUp();
    const atRoot = entry({ id: `${ROOT}/a.md`, meta: { installed: [] } });
    const below = entry({ id: `${ROOT}/x/b.md`, meta: { installed: [] } });

    await test.read([atRoot, below]);

    const statusRun = test.processes.runs.find((run) =>
      run.args.includes('status'),
    );
    expect(statusRun?.args.at(-1)).toBe('.');
  });
});
