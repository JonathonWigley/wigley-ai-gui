import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Git } from '../../contracts/git';
import type { ProcessResult } from '../../contracts/processes';
import { FakeProcesses } from '../../shared/fake-processes';
import { createMemoryFiles } from '../../shared/memory-files';
import { osPlatform } from '../../shared/os-platform';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import { hostNodeProcesses } from '../processes/node-processes.test-support';
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

  it.each([
    {
      case: 'scp-style with .git',
      result: exited(
        0,
        'git@github-personal:JonathonWigley/wigley-ai-gui.git\n',
      ),
      name: 'wigley-ai-gui',
    },
    {
      case: 'https without .git',
      result: exited(0, 'https://github.com/acme/new-games-prototypes\n'),
      name: 'new-games-prototypes',
    },
    {
      case: 'https with .git',
      result: exited(0, 'https://github.com/acme/Spacebreaker.git\n'),
      name: 'Spacebreaker',
    },
    {
      case: 'local path with trailing slash',
      result: exited(0, '/Users/someone/repos/local-bare.git/\n'),
      name: 'local-bare',
    },
    {
      case: 'Windows path',
      result: exited(0, 'C:\\repos\\tool.git\n'),
      name: 'tool',
    },
    {
      case: 'exits non-zero',
      result: exited(2, '', 'error: No such remote'),
      name: null,
    },
    {
      case: 'empty result',
      result: exited(0, '/\n'),
      name: null,
    },
  ])('originRepoName_$case', async ({ result, name }) => {
    const test = setUp();
    test.processes.script('git', git('remote', 'get-url', 'origin'), result);

    expect(await test.git.originRepoName(ROOT)).toBe(name);
  });

  // Each of these answers null or false on a failed run, not on a git that
  // cannot start: nothing is scripted, so the run rejects.
  it.each([
    { method: 'topLevel', call: (adapter: Git) => adapter.topLevel(ROOT) },
    {
      method: 'originRepoName',
      call: (adapter: Git) => adapter.originRepoName(ROOT),
    },
    {
      method: 'currentBranch',
      call: (adapter: Git) => adapter.currentBranch(ROOT),
    },
    {
      method: 'hasUpstream',
      call: (adapter: Git) => adapter.hasUpstream(ROOT),
    },
  ])('gitCannotStart_Rejects_$method', async ({ call }) => {
    const test = setUp();

    await expect(call(test.git)).rejects.toThrow();
  });

  it.each([
    {
      case: 'on a branch',
      symbolicRef: exited(0, 'main\n'),
      revParse: null,
      branch: 'main',
    },
    {
      case: 'detached',
      symbolicRef: exited(1),
      revParse: exited(0, 'abc1234\n'),
      branch: 'abc1234',
    },
    {
      case: 'in no clone',
      symbolicRef: exited(128, '', 'fatal: not a git repository'),
      revParse: exited(128, '', 'fatal: not a git repository'),
      branch: null,
    },
  ])('currentBranch_$case', async ({ symbolicRef, revParse, branch }) => {
    const test = setUp();
    const shortCommit = git('rev-parse', '--short', 'HEAD');
    test.processes.script(
      'git',
      git('symbolic-ref', '--short', '-q', 'HEAD'),
      symbolicRef,
    );
    if (revParse !== null) {
      test.processes.script('git', shortCommit, revParse);
    }

    expect(await test.git.currentBranch(ROOT)).toBe(branch);
    const ranRevParse = test.processes.runs.some(
      (run) => JSON.stringify(run.args) === JSON.stringify(shortCommit),
    );
    expect(ranRevParse).toBe(revParse !== null);
  });

  it('isLinkedWorktree_GitDirIsNotCommonDir_True', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('rev-parse', '--git-dir', '--git-common-dir'),
      exited(0, '/Users/u/dev/main/.git/worktrees/m\n/Users/u/dev/main/.git\n'),
    );

    expect(await test.git.isLinkedWorktree(ROOT)).toBe(true);
  });

  it('isLinkedWorktree_RelativeAndAbsoluteSameFolder_False', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('rev-parse', '--git-dir', '--git-common-dir'),
      exited(0, `.git\n${ROOT}/.git/\n`),
    );

    expect(await test.git.isLinkedWorktree(ROOT)).toBe(false);
  });

  it('isLinkedWorktree_RelativeCommonDirOutsideGitDir_True', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('rev-parse', '--git-dir', '--git-common-dir'),
      exited(0, '/Users/u/dev/main/.git/worktrees/m\n../main/.git\n'),
    );

    expect(await test.git.isLinkedWorktree(ROOT)).toBe(true);
  });

  it.each([
    {
      name: 'main, a branch and a detached tree',
      output:
        `worktree /Users/u/dev/m\nHEAD ${SHA_A}\nbranch refs/heads/main\n\n` +
        `worktree /Users/u/dev/.worktrees/m-x/\nHEAD ${SHA_B}\nbranch refs/heads/feature/x\n\n` +
        `worktree /Users/u/dev/m-d\nHEAD ${SHA_A}\ndetached\n\n`,
      trees: [
        { path: '/Users/u/dev/m', branch: 'main', isMain: true },
        {
          path: '/Users/u/dev/.worktrees/m-x',
          branch: 'feature/x',
          isMain: false,
        },
        { path: '/Users/u/dev/m-d', branch: null, isMain: false },
      ],
    },
    {
      name: 'a bare main and a locked tree',
      output:
        'worktree /Users/u/dev/m.git\nbare\n\n' +
        `worktree /Users/u/dev/m-l\nHEAD ${SHA_A}\nbranch refs/heads/l\nlocked\n\n`,
      trees: [
        { path: '/Users/u/dev/m.git', branch: null, isMain: true },
        { path: '/Users/u/dev/m-l', branch: 'l', isMain: false },
      ],
    },
  ])(
    'worktrees_PorcelainOutput_MainFirstWithBranches ($name)',
    async ({ output, trees }) => {
      const test = setUp();
      test.processes.script(
        'git',
        git('worktree', 'list', '--porcelain'),
        exited(0, output),
      );

      expect(await test.git.worktrees(ROOT)).toEqual(trees);
    },
  );

  it('worktrees_ExitsNonZero_RejectsNamingTheRun', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('worktree', 'list', '--porcelain'),
      exited(128, '', 'fatal: not a git repository'),
    );

    await expect(test.git.worktrees(ROOT)).rejects.toThrow(
      'git worktree exited 128: fatal: not a git repository',
    );
  });

  it.each([
    { name: 'relative', printed: '.git\n' },
    { name: 'absolute', printed: '/Users/u/dev/m/.git\n' },
    { name: 'relative through a parent', printed: '../m/.git\n' },
  ])('commonDir_PrintedPath_FullPath ($name)', async ({ printed }) => {
    const test = setUp();
    test.processes.script(
      'git',
      git('rev-parse', '--git-common-dir'),
      exited(0, printed),
    );

    expect(await test.git.commonDir(ROOT)).toBe('/Users/u/dev/m/.git');
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
      /128.*fatal: bad/,
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

  it.each([
    { case: 'exits 0', result: exited(0), failed: false },
    { case: 'exits 1', result: exited(1), failed: true },
    {
      case: 'times out',
      result: { code: -1, stdout: '', stderr: '', timedOut: true },
      failed: true,
    },
    { case: 'cannot start', result: null, failed: true },
  ])(
    'fetch when git $case: failed $failed, capped at the timeout',
    async ({ result, failed }) => {
      const test = setUp();
      if (result !== null) {
        test.processes.script('git', git('fetch', '--quiet'), result);
      }

      expect(await test.git.fetch(ROOT, 15000)).toBe(failed);
      expect(test.processes.runs[0].timeoutMs).toBe(15000);
    },
  );

  it.each([
    { case: 'names a commit', result: exited(0, `${SHA_A}\n`), sha: SHA_A },
    { case: 'names none', result: exited(1), sha: null },
  ])('resolveCommit when the ref $case: $sha', async ({ result, sha }) => {
    const test = setUp();
    test.processes.script(
      'git',
      git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}'),
      result,
    );

    expect(await test.git.resolveCommit(ROOT, 'origin/main')).toBe(sha);
  });

  it('resolveCommit_ExitsAboveOne_RejectsNamingTheRun', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}'),
      exited(128, '', 'fatal: not a git repository'),
    );

    await expect(test.git.resolveCommit(ROOT, 'origin/main')).rejects.toThrow(
      'git rev-parse exited 128: fatal: not a git repository',
    );
  });

  it.each([
    { case: 'exits 0', code: 0, isAncestor: true },
    { case: 'exits 1', code: 1, isAncestor: false },
  ])('isAncestor when git $case: $isAncestor', async ({ code, isAncestor }) => {
    const test = setUp();
    test.processes.script(
      'git',
      git('merge-base', '--is-ancestor', SHA_A, SHA_B),
      exited(code),
    );

    expect(await test.git.isAncestor(ROOT, SHA_A, SHA_B)).toBe(isAncestor);
  });

  it('isAncestor_ExitsAboveOne_RejectsNamingTheRun', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      git('merge-base', '--is-ancestor', SHA_A, SHA_B),
      exited(128, '', 'fatal: Not a valid commit name'),
    );

    await expect(test.git.isAncestor(ROOT, SHA_A, SHA_B)).rejects.toThrow(
      'git merge-base exited 128: fatal: Not a valid commit name',
    );
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
      git(
        '--literal-pathspecs',
        'ls-tree',
        '-z',
        'HEAD',
        '--',
        'docs/followups.md',
      ),
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
      git(
        '--literal-pathspecs',
        'ls-tree',
        '-z',
        'HEAD',
        '--',
        'docs/followups.md',
      ),
      exited(0),
    );

    expect(await test.git.fileAtHead(ROOT, 'docs/followups.md')).toBeNull();
  });

  function logArgs(limit: number, ...paths: string[]): string[] {
    return git(
      '--literal-pathspecs',
      'log',
      '--no-show-signature',
      '--no-merges',
      `--max-count=${String(limit)}`,
      '--format=%x00%H%x00%cI%x00%s',
      '-z',
      '--name-only',
      '--',
      ...paths,
    );
  }

  it('log_ScriptedOutput_ParsesRecords', async () => {
    const test = setUp();
    const newer = '2026-11-05T10:00:00-06:00';
    const older = '2026-11-04T09:00:00Z';
    test.processes.script(
      'git',
      logArgs(5, 'x y.md', 'z.md'),
      exited(
        0,
        `\0${SHA_A}\0${newer}\0a | b\tc\0\nx y.md\0z.md\0` +
          `\0${SHA_B}\0${older}\0\0\nz.md\0`,
      ),
    );

    expect(await test.git.log(ROOT, ['x y.md', 'z.md'], 5)).toEqual([
      {
        sha: SHA_A,
        subject: 'a | b\tc',
        at: newer,
        paths: ['x y.md', 'z.md'],
      },
      { sha: SHA_B, subject: '', at: older, paths: ['z.md'] },
    ]);
  });

  it('log_ExitsZeroWithNoOutput_NoCommits', async () => {
    const test = setUp();
    test.processes.script('git', logArgs(5, 'a.md'), exited(0));

    expect(await test.git.log(ROOT, ['a.md'], 5)).toEqual([]);
  });

  it('log_NoPaths_RunsNothing', async () => {
    const test = setUp();

    expect(await test.git.log(ROOT, [], 5)).toEqual([]);
    expect(test.processes.runs).toEqual([]);
  });

  it('log_ExitsNonZero_Rejects', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      logArgs(5, 'a.md'),
      exited(128, '', 'fatal: bad\n'),
    );

    await expect(test.git.log(ROOT, ['a.md'], 5)).rejects.toThrow(
      'git log exited 128',
    );
  });

  function firstAddedArgs(filePath: string, text: string): string[] {
    return git(
      '--literal-pathspecs',
      'log',
      '--no-show-signature',
      '--no-merges',
      '--reverse',
      `-S${text}`,
      '--format=%x00%H%x00%cI%x00%s',
      '-z',
      '--name-only',
      '--',
      filePath,
    );
  }

  it('firstAdded_ScriptedOutput_OldestRecord', async () => {
    const test = setUp();
    const older = '2026-11-04T09:00:00Z';
    const newer = '2026-11-05T10:00:00-06:00';
    test.processes.script(
      'git',
      firstAddedArgs('docs/followups.md', '### Item'),
      exited(
        0,
        `\0${SHA_A}\0${older}\0add item\0\ndocs/followups.md\0` +
          `\0${SHA_B}\0${newer}\0re-add item\0\ndocs/followups.md\0`,
      ),
    );

    expect(
      await test.git.firstAdded(ROOT, 'docs/followups.md', '### Item'),
    ).toEqual({
      sha: SHA_A,
      subject: 'add item',
      at: older,
      paths: ['docs/followups.md'],
    });
  });

  it('firstAdded_ExitsZeroWithNoOutput_Null', async () => {
    const test = setUp();
    test.processes.script('git', firstAddedArgs('a.md', '### Item'), exited(0));

    expect(await test.git.firstAdded(ROOT, 'a.md', '### Item')).toBeNull();
  });

  it('firstAdded_EmptyText_RunsNothing', async () => {
    const test = setUp();

    expect(await test.git.firstAdded(ROOT, 'a.md', '')).toBeNull();
    expect(test.processes.runs).toEqual([]);
  });

  it('firstAdded_ExitsNonZero_Rejects', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      firstAddedArgs('a.md', '### Item'),
      exited(128, '', 'fatal: bad\n'),
    );

    await expect(test.git.firstAdded(ROOT, 'a.md', '### Item')).rejects.toThrow(
      'git log exited 128',
    );
  });

  it('firstAdded_TextStartingWithDash_AttachedToS', async () => {
    const test = setUp();
    const args = firstAddedArgs('a.md', '--x');
    const at = '2026-11-04T09:00:00Z';
    test.processes.script(
      'git',
      args,
      exited(0, `\0${SHA_A}\0${at}\0dash\0\na.md\0`),
    );

    expect((await test.git.firstAdded(ROOT, 'a.md', '--x'))?.sha).toBe(SHA_A);
  });

  function branchesArgs(): string[] {
    return git(
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)%00%(symref)%00%(committerdate:iso-strict)',
      'refs/heads',
      'refs/remotes',
    );
  }

  function matchingArgs(pattern: string, since: string | null): string[] {
    return git(
      'log',
      '--exclude=refs/stash',
      '--all',
      '--no-show-signature',
      '--regexp-ignore-case',
      '--extended-regexp',
      `--grep=${pattern}`,
      ...(since === null ? [] : [`--since=${since}`]),
      '--format=%x00%H%x00%cI%x00%s',
      '-z',
    );
  }

  it('branches_ForEachRefOutput_LocalAndRemoteWithoutSymbolicHead', async () => {
    const test = setUp();
    const newer = '2026-11-05T10:00:00-06:00';
    const older = '2026-11-04T09:00:00Z';
    test.processes.script(
      'git',
      branchesArgs(),
      exited(
        0,
        `refs/heads/main\0\0${newer}\n` +
          `refs/remotes/origin/PROJ-7-x\0\0${older}\n` +
          `refs/remotes/origin/HEAD\0refs/remotes/origin/main\0${older}\n`,
      ),
    );

    expect(await test.git.branches(ROOT)).toEqual([
      { name: 'main', at: newer, isRemote: false },
      { name: 'origin/PROJ-7-x', at: older, isRemote: true },
    ]);
  });

  it('branches_ExitsNonZero_RejectsNamingTheRun', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      branchesArgs(),
      exited(128, '', 'fatal: not a git repository'),
    );

    await expect(test.git.branches(ROOT)).rejects.toThrow(
      'git for-each-ref exited 128',
    );
  });

  it('commitsMatching_ScriptedOutput_ParsesRecordsWithNoPaths', async () => {
    const test = setUp();
    const since = '2026-11-01T00:00:00Z';
    const newer = '2026-11-05T10:00:00-06:00';
    const older = '2026-11-04T09:00:00Z';
    test.processes.script(
      'git',
      matchingArgs('PROJ-7', since),
      exited(
        0,
        `\0${SHA_A}\0${newer}\0Merge PROJ-7\0` + `\0${SHA_B}\0${older}\0fix\0`,
      ),
    );

    expect(await test.git.commitsMatching(ROOT, 'PROJ-7', since)).toEqual([
      { sha: SHA_A, subject: 'Merge PROJ-7', at: newer, paths: [] },
      { sha: SHA_B, subject: 'fix', at: older, paths: [] },
    ]);
  });

  it('commitsMatching_NullSince_NoSinceArg', async () => {
    const test = setUp();
    test.processes.script('git', matchingArgs('PROJ-7', null), exited(0));

    expect(await test.git.commitsMatching(ROOT, 'PROJ-7', null)).toEqual([]);
  });

  it('commitsMatching_EmptyPattern_RunsNothing', async () => {
    const test = setUp();

    expect(await test.git.commitsMatching(ROOT, '', null)).toEqual([]);
    expect(test.processes.runs).toEqual([]);
  });

  it('commitsMatching_ExitsNonZero_Rejects', async () => {
    const test = setUp();
    test.processes.script(
      'git',
      matchingArgs('PROJ-7', null),
      exited(128, '', 'fatal: bad\n'),
    );

    await expect(
      test.git.commitsMatching(ROOT, 'PROJ-7', null),
    ).rejects.toThrow('git log exited 128');
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
  const processes = hostNodeProcesses();
  // The real clone's paths are this machine's, so its OS's adapter reads them.
  const adapter = createProcessGit({
    processes,
    files: createMemoryFiles(),
    paths:
      osPlatform(process.platform) === 'windows' ? windowsPaths : posixPaths,
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
    'resolveCommitAndIsAncestor_TwoCommits_OlderIsAncestorOfNewer',
    async () => {
      isolateGitConfig();
      root = mkdtempSync(path.join(tmpdir(), 'process-git-'));
      await run('init', '--quiet', '--initial-branch=main');
      await run('commit', '--quiet', '--allow-empty', '-m', 'first');
      const first = (await run('rev-parse', 'HEAD')).trim();
      await run('commit', '--quiet', '--allow-empty', '-m', 'second');

      const second = await adapter.resolveCommit(root, 'main');

      expect(second).not.toBe(first);
      expect(second).toBe((await run('rev-parse', 'HEAD')).trim());
      expect(await adapter.resolveCommit(root, 'origin/main')).toBeNull();
      expect(await adapter.isAncestor(root, first, second ?? '')).toBe(true);
      expect(await adapter.isAncestor(root, second ?? '', first)).toBe(false);
    },
  );

  it.skipIf(!gitOnPath)(
    'currentBranch_RealClone_BranchThenShortCommitWhenDetached',
    async () => {
      isolateGitConfig();
      root = mkdtempSync(path.join(tmpdir(), 'process-git-'));
      await run('init', '--quiet', '--initial-branch=trunk');
      writeFileSync(path.join(root, 'a.md'), '');
      await run('add', '--', 'a.md');
      await run('commit', '--quiet', '-m', 'first');

      expect(await adapter.currentBranch(root)).toBe('trunk');

      await run('checkout', '--quiet', '--detach');
      const shortCommit = (await run('rev-parse', '--short', 'HEAD')).trim();
      expect(await adapter.currentBranch(root)).toBe(shortCommit);
    },
  );

  it.skipIf(!gitOnPath)(
    'isLinkedWorktree_MainCloneAndWorktreeAdded_OnlyTheWorktree',
    async () => {
      isolateGitConfig();
      root = mkdtempSync(path.join(tmpdir(), 'process-git-'));
      const linked = path.join(root, 'linked');
      const main = path.join(root, 'main');
      mkdirSync(main);
      await run('-C', main, 'init', '--quiet');
      writeFileSync(path.join(main, 'a.md'), '');
      await run('-C', main, 'add', '--', 'a.md');
      await run('-C', main, 'commit', '--quiet', '-m', 'first');
      await run('-C', main, 'worktree', 'add', '--quiet', linked);

      expect(await adapter.isLinkedWorktree(main)).toBe(false);
      expect(await adapter.isLinkedWorktree(linked)).toBe(true);
    },
  );

  it.skipIf(!gitOnPath)(
    'worktreesAndCommonDir_MainCloneAndWorktreeAdded_MainFirstAndOneCommonDir',
    async () => {
      isolateGitConfig();
      root = mkdtempSync(path.join(tmpdir(), 'process-git-'));
      const linked = path.join(root, 'linked');
      const main = path.join(root, 'main');
      mkdirSync(main);
      await run('-C', main, 'init', '--quiet');
      writeFileSync(path.join(main, 'a.md'), '');
      await run('-C', main, 'add', '--', 'a.md');
      await run('-C', main, 'commit', '--quiet', '-m', 'first');
      await run('-C', main, 'worktree', 'add', '--quiet', linked);

      expect(
        (await adapter.worktrees(main)).map((tree) => [
          realpathSync(tree.path),
          tree.isMain,
        ]),
      ).toEqual([
        [realpathSync(main), true],
        [realpathSync(linked), false],
      ]);
      const commonDir = realpathSync(path.join(main, '.git'));
      expect(realpathSync(await adapter.commonDir(main))).toBe(commonDir);
      expect(realpathSync(await adapter.commonDir(linked))).toBe(commonDir);
    },
  );

  it.skipIf(!gitOnPath)(
    'log_RealRepo_NewestFirstAndOnlyAskedPaths',
    async () => {
      isolateGitConfig();
      root = mkdtempSync(path.join(tmpdir(), 'process-git-'));
      const subject = 'sub | with\ttab';
      await run('init', '--quiet');
      writeFileSync(path.join(root, 'a b.md'), '');
      writeFileSync(path.join(root, 'c.md'), '');
      writeFileSync(path.join(root, 'other.md'), '');
      await run('add', '--', 'a b.md', 'c.md', 'other.md');
      await run('commit', '--quiet', '-m', 'first');
      writeFileSync(path.join(root, 'a b.md'), 'changed\n');
      writeFileSync(path.join(root, 'other.md'), 'changed\n');
      await run('add', '--', 'a b.md', 'other.md');
      await run('commit', '--quiet', '-m', subject);

      const commits = await adapter.log(root, ['a b.md', 'c.md'], 5);

      expect(commits.map((commit) => commit.subject)).toEqual([
        subject,
        'first',
      ]);
      expect(commits.map((commit) => commit.paths)).toEqual([
        ['a b.md'],
        ['a b.md', 'c.md'],
      ]);
      for (const commit of commits) {
        expect(Date.parse(commit.at)).not.toBeNaN();
      }
      expect(await adapter.log(root, ['a b.md', 'c.md'], 1)).toHaveLength(1);
    },
  );

  it.skipIf(!gitOnPath)(
    'firstAdded_RealRepo_FirstCommitAddingTheText',
    async () => {
      isolateGitConfig();
      root = mkdtempSync(path.join(tmpdir(), 'process-git-'));
      const commitFiles = async (
        subject: string,
        texts: Record<string, string>,
      ) => {
        for (const [file, text] of Object.entries(texts)) {
          writeFileSync(path.join(root, file), text);
        }
        await run('add', '--', ...Object.keys(texts));
        await run('commit', '--quiet', '-m', subject);
      };
      await run('init', '--quiet');
      await commitFiles('first', { 'a.md': '', 'b.md': 'x\n', 'c.md': '' });
      await commitFiles('item in other file', { 'b.md': 'x\n### Item\n' });
      await commitFiles('add item', { 'a.md': '### Item\n' });
      await commitFiles('edit other', { 'b.md': 'y\n### Item\n' });
      await commitFiles('remove item', { 'a.md': '' });
      await commitFiles('re-add item', { 'a.md': '### Item\n' });
      await commitFiles('longer title', { 'c.md': '### Item two\n' });
      await commitFiles('short title', { 'c.md': '### Item two\n### Item\n' });

      const added = await adapter.firstAdded(root, 'a.md', '### Item');

      expect(added?.subject).toBe('add item');
      expect(added?.paths).toEqual(['a.md']);
      expect(await adapter.firstAdded(root, 'a.md', '### Never')).toBeNull();
      expect(
        (await adapter.firstAdded(root, 'c.md', '### Item'))?.subject,
      ).toBe('longer title');
      expect(
        (await adapter.firstAdded(root, 'c.md', '### Item\n'))?.subject,
      ).toBe('short title');
    },
  );

  // `main` with `first` and `main work`, and `side` with `side work`, not
  // yet merged.
  async function initMainAndSide() {
    root = mkdtempSync(path.join(tmpdir(), 'process-git-'));
    await run('init', '--quiet', '--initial-branch=main');
    await run('commit', '--quiet', '--allow-empty', '-m', 'first');
    await run('checkout', '--quiet', '-b', 'side');
    await run('commit', '--quiet', '--allow-empty', '-m', 'side work');
    await run('checkout', '--quiet', 'main');
    await run('commit', '--quiet', '--allow-empty', '-m', 'main work');
  }

  it.skipIf(!gitOnPath)(
    'commitsMatching_RealClone_MergeBodyMatchesCaseInsensitively',
    async () => {
      isolateGitConfig();
      await initMainAndSide();
      await run(
        'merge',
        '--quiet',
        '--no-ff',
        'side',
        '-m',
        'Merge side',
        '-m',
        'Closes proj-7',
      );
      const merge = (await run('rev-parse', 'HEAD')).trim();

      const commits = await adapter.commitsMatching(root, 'PROJ-7', null);

      expect(commits).toHaveLength(1);
      expect(commits[0]).toMatchObject({
        sha: merge,
        subject: 'Merge side',
        paths: [],
      });
      const dayAhead = new Date(Date.now() + 86_400_000).toISOString();
      expect(await adapter.commitsMatching(root, 'PROJ-7', dayAhead)).toEqual(
        [],
      );
    },
  );

  it.skipIf(!gitOnPath)('commitsMatching_RealClone_StashLeftOut', async () => {
    isolateGitConfig();
    root = mkdtempSync(path.join(tmpdir(), 'process-git-'));
    await run('init', '--quiet', '--initial-branch=main');
    writeFileSync(path.join(root, 'a.txt'), 'first\n');
    await run('add', '--', 'a.txt');
    await run('commit', '--quiet', '-m', 'first');
    await run('checkout', '--quiet', '-b', 'proj-7-x');
    writeFileSync(path.join(root, 'a.txt'), 'changed\n');
    await run('stash', 'push', '--quiet');

    expect(await adapter.commitsMatching(root, 'PROJ-7', null)).toEqual([]);
  });

  it.skipIf(!gitOnPath)(
    'branches_RealClone_LocalAndRemoteWithDates',
    async () => {
      isolateGitConfig();
      await initMainAndSide();
      await run('update-ref', 'refs/remotes/origin/side', 'side');
      await run(
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/side',
      );

      const branches = await adapter.branches(root);

      const named = branches.map(
        (branch) => `${branch.name} ${String(branch.isRemote)}`,
      );
      expect(new Set(named)).toEqual(
        new Set(['main false', 'side false', 'origin/side true']),
      );
      expect(branches).toHaveLength(3);
      for (const branch of branches) {
        expect(Date.parse(branch.at)).not.toBeNaN();
      }
    },
  );
});
