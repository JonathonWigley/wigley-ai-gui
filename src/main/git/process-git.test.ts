import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessResult } from '../../contracts/processes';
import { FakeProcesses } from '../../shared/fake-processes';
import { createMemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import { createNodeProcesses } from '../processes/node-processes';
import { createProcessGit } from './process-git';

const ROOT = '/Users/u/dev/m';
const SHA_A = '78981922613b2afb6025042ff6bd878ac1994e85';
const SHA_B = 'bd0b5424fe275aa7a198b425a5621b5807b6da3a';

function git(...args: string[]): string[] {
  return ['-C', ROOT, ...args];
}

function exited(code: number, stdout = '', stderr = ''): ProcessResult {
  return { code, stdout, stderr, timedOut: false };
}

function setUp() {
  const clock = { time: 0, now: () => clock.time };
  const files = createMemoryFiles(clock);
  const processes = new FakeProcesses();
  const adapter = createProcessGit({ processes, files, paths: posixPaths });
  return { clock, files, processes, git: adapter };
}

describe('createProcessGit', () => {
  it('topLevel_InClone_NormalizedTopFolder', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      ['-C', `${ROOT}/docs`, 'rev-parse', '--show-toplevel'],
      exited(0, `${ROOT}/\n`),
    );

    expect(await test.git.topLevel(`${ROOT}/docs`)).toBe(ROOT);
  });

  it('topLevel_ExitsNonZero_Null', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      ['-C', '/tmp/x', 'rev-parse', '--show-toplevel'],
      exited(128, '', 'fatal: not a git repository'),
    );

    expect(await test.git.topLevel('/tmp/x')).toBeNull();
  });

  it('hasUpstream_ExitCode_TrueOnlyOnZero', async () => {
    const test = setUp();
    const upstream = git(
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{u}',
    );
    test.processes.script('git', upstream, exited(0, 'origin/main\n'));
    const withUpstream = await test.git.hasUpstream(ROOT);
    test.processes.script('git', upstream, exited(128, '', 'no upstream'));

    expect(withUpstream).toBe(true);
    expect(await test.git.hasUpstream(ROOT)).toBe(false);
  });

  it('changedPaths_RenameAndUntracked_EveryPathNamed', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git(
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--',
        'plugins/w',
      ),
      exited(
        0,
        'R  plugins/w/new.md\0plugins/w/old.md\0' +
          '?? plugins/w/untracked.md\0' +
          ' M plugins/w/modified.md\0',
      ),
    );

    expect(await test.git.changedPaths(ROOT, 'plugins/w')).toEqual([
      'plugins/w/new.md',
      'plugins/w/old.md',
      'plugins/w/untracked.md',
      'plugins/w/modified.md',
    ]);
  });

  it('changedPaths_WorktreeRename_NextRecordStillRead', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'),
      exited(0, ' R b.md\0hooks.json\0 M a.md\0'),
    );

    expect(await test.git.changedPaths(ROOT, '.')).toEqual([
      'b.md',
      'hooks.json',
      'a.md',
    ]);
  });

  it('changedPaths_ExitsNonZero_RejectsNamingTheRun', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'),
      exited(128, '', 'fatal: bad\n'),
    );

    await expect(test.git.changedPaths(ROOT, '.')).rejects.toThrow(
      'git status exited 128: fatal: bad',
    );
  });

  it('unpushedPaths_NameOnlyOutput_Paths', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('diff', '--name-only', '-z', '@{u}...HEAD', '--', 'plugins/w'),
      exited(0, 'plugins/w/a.md\0plugins/w/hooks/hooks.json\0'),
    );

    expect(await test.git.unpushedPaths(ROOT, 'plugins/w')).toEqual([
      'plugins/w/a.md',
      'plugins/w/hooks/hooks.json',
    ]);
  });

  it('upstreamBlobs_LsTreeOutput_BlobsOnly', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('ls-tree', '-r', '-z', '@{u}', '--', 'plugins/w'),
      exited(
        0,
        `100644 blob ${SHA_A}\tplugins/w/a.md\0` +
          `160000 commit ${SHA_B}\tplugins/w/sub\0` +
          `100755 blob ${SHA_B}\tplugins/w/run.sh\0`,
      ),
    );

    expect(await test.git.upstreamBlobs(ROOT, 'plugins/w')).toEqual(
      new Map([
        ['plugins/w/a.md', SHA_A],
        ['plugins/w/run.sh', SHA_B],
      ]),
    );
  });

  it('fetch_ExitsZero_NotFailedAndCapped', async () => {
    const test = setUp();
    test.processes.script('git', git('fetch', '--quiet'), exited(0));

    expect(await test.git.fetch(ROOT, 15000)).toBe(false);
    expect(test.processes.runs[0].timeoutMs).toBe(15000);
  });

  it('fetch_ExitsOne_Failed', async () => {
    const test = setUp();
    test.processes.script('git', git('fetch', '--quiet'), exited(1));

    expect(await test.git.fetch(ROOT, 15000)).toBe(true);
  });

  it('fetch_TimedOut_Failed', async () => {
    const test = setUp();
    test.processes.script('git', git('fetch', '--quiet'), {
      code: -1,
      stdout: '',
      stderr: '',
      timedOut: true,
    });

    expect(await test.git.fetch(ROOT, 15000)).toBe(true);
  });

  it('fetch_CannotStart_Failed', async () => {
    const test = setUp();

    expect(await test.git.fetch(ROOT, 15000)).toBe(true);
  });

  it('lastFetch_RelativeFetchHead_ModifiedIso', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('rev-parse', '--git-path', 'FETCH_HEAD'),
      exited(0, '.git/FETCH_HEAD\n'),
    );
    test.clock.time = Date.parse('2026-10-24T09:30:00.000Z');
    await test.files.write(`${ROOT}/.git/FETCH_HEAD`, '');

    expect(await test.git.lastFetch(ROOT)).toBe('2026-10-24T09:30:00.000Z');
  });

  it('lastFetch_NoFetchHead_Null', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('rev-parse', '--git-path', 'FETCH_HEAD'),
      exited(0, '.git/FETCH_HEAD\n'),
    );

    expect(await test.git.lastFetch(ROOT)).toBeNull();
  });

  it('lastFetch_RevParseFails_Null', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('rev-parse', '--git-path', 'FETCH_HEAD'),
      exited(128, '', 'fatal: not a git repository'),
    );
    await test.files.write(`${ROOT}/.git/FETCH_HEAD`, '');

    expect(await test.git.lastFetch(ROOT)).toBeNull();
  });

  it('fileAtHead_HeldAtHead_BlobText', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('ls-tree', '-z', 'HEAD', '--', 'docs/followups.md'),
      exited(0, `100644 blob ${SHA_A}\tdocs/followups.md\0`),
    );
    test.processes.script(
      'git',
      git('cat-file', 'blob', SHA_A),
      exited(0, '# Follow-ups\n'),
    );

    expect(await test.git.fileAtHead(ROOT, 'docs/followups.md')).toBe(
      '# Follow-ups\n',
    );
  });

  it('fileAtHead_MissingAtHead_Null', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('ls-tree', '-z', 'HEAD', '--', 'docs/followups.md'),
      exited(0),
    );

    expect(await test.git.fileAtHead(ROOT, 'docs/followups.md')).toBeNull();
  });

  it('commitPaths_Paths_AddThenCommitOnly', async () => {
    const test = setUp();
    const add = git('add', '--', 'a.md', 'b.md');
    const commit = git('commit', '--only', '-m', 'm', '--', 'a.md', 'b.md');
    test.processes.script('git', add, exited(0));
    test.processes.script('git', commit, exited(0));

    await test.git.commitPaths(ROOT, ['a.md', 'b.md'], 'm');

    expect(test.processes.runs.map((run) => run.args)).toEqual([add, commit]);
  });

  it('commitPaths_NoPaths_RejectsWithoutRunning', async () => {
    const test = setUp();

    await expect(test.git.commitPaths(ROOT, [], 'm')).rejects.toThrow(
      'no paths to commit',
    );
    expect(test.processes.runs).toEqual([]);
  });
});

// The real-clone test runs the machine's git, which a machine without git on
// the PATH cannot.
const gitOnPath = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('createProcessGit over a real clone', () => {
  const processes = createNodeProcesses();
  const adapter = createProcessGit({
    processes,
    files: createMemoryFiles(),
    paths: posixPaths,
  });
  let root = '';

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<string> {
    const result = await processes.run('git', ['-C', root, ...args]);
    expect(result.code).toBe(0);
    return result.stdout;
  }

  // A clone whose git reads no user or system config, so no signing or hook
  // the user set runs.
  function isolateGitConfig() {
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_AUTHOR_NAME', 'Test');
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.com');
    vi.stubEnv('GIT_COMMITTER_NAME', 'Test');
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.com');
  }

  it.skipIf(!gitOnPath)(
    'commitPaths_UnrelatedFileStaged_CommitsOnlyPathsAndKeepsItStaged',
    async () => {
      isolateGitConfig();
      root = mkdtempSync(path.join(tmpdir(), 'process-git-'));
      const followups = 'docs/features/followups.md';
      await run('init', '--quiet');
      mkdirSync(path.join(root, 'docs/features'), { recursive: true });
      writeFileSync(path.join(root, followups), '');
      writeFileSync(path.join(root, 'other.txt'), '');
      await run('add', '--', followups, 'other.txt');
      await run('commit', '--quiet', '-m', 'first');
      writeFileSync(path.join(root, followups), 'changed\n');
      writeFileSync(path.join(root, 'other.txt'), 'staged\n');
      await run('add', '--', 'other.txt');

      await adapter.commitPaths(root, [followups], 'Edit follow-ups');

      expect(await run('show', '--name-only', '--format=%s', 'HEAD')).toBe(
        `Edit follow-ups\n\n${followups}\n`,
      );
      expect(await run('diff', '--cached', '--name-only')).toBe('other.txt\n');
    },
  );
});
