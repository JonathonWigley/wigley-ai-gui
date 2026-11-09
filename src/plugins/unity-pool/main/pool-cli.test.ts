import { describe, expect, it, vi } from 'vitest';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type { PoolAction, PoolActionResult } from '../contract';
import {
  type ClaimAnswer,
  claimCommandArgs,
  poolCommandArgs,
  readActionResult,
  readClaimAnswer,
  releaseCommandArgs,
  resolveScriptPath,
  runPoolClaim,
  runPoolCommand,
  runPoolRelease,
} from './pool-cli';

function exited(
  code: number,
  stdout: string,
  stderr = '',
  timedOut = false,
): ProcessResult {
  return { code, stdout, stderr, timedOut };
}

describe('poolCommandArgs', () => {
  it.each<PoolAction>(['hold', 'release'])(
    'poolCommandArgs_HoldAndRelease: %s',
    (action) => {
      expect(poolCommandArgs('/s/unity-pool', action, 'p', 3)).toEqual([
        '-X',
        'utf8',
        '/s/unity-pool',
        action,
        'p',
        '3',
        '--json',
      ]);
    },
  );
});

describe('readActionResult', () => {
  it.each<{ name: string; result: ProcessResult; expected: PoolActionResult }>([
    {
      name: 'ok JSON',
      result: exited(0, '{"ok": true, "pool": "p", "clone": 3}\n'),
      expected: { ok: true, pool: 'p', clone: 3 },
    },
    {
      name: 'the CLI refusing with exit code 1',
      result: exited(
        1,
        '{"ok": false, "error": "dirty", "message": "Unity 3 has changes"}\n',
      ),
      expected: { ok: false, error: 'dirty', message: 'Unity 3 has changes' },
    },
    {
      name: 'two lines on stdout, JSON last',
      result: exited(
        0,
        'fetching origin\n{"ok": true, "pool": "q", "clone": 5}\n\n',
      ),
      expected: { ok: true, pool: 'q', clone: 5 },
    },
    {
      name: 'a stack trace on stderr',
      result: exited(
        1,
        '',
        'Traceback (most recent call last):\n  File "x", line 1\nValueError: x\n',
      ),
      expected: { ok: false, error: 'cli-failed', message: 'ValueError: x' },
    },
    {
      name: 'nothing written',
      result: exited(2, ''),
      expected: {
        ok: false,
        error: 'cli-failed',
        message: 'unity-pool exited 2',
      },
    },
    {
      name: 'timed out',
      result: exited(-1, '', '', true),
      expected: {
        ok: false,
        error: 'cli-failed',
        message: 'unity-pool timed out',
      },
    },
  ])('readActionResult: $name', ({ result, expected }) => {
    expect(readActionResult(result)).toEqual(expected);
  });
});

describe('runPoolCommand', () => {
  // `stat` answers a file at each path in `present`, recording every path asked.
  function deps(
    present: string[],
    scriptPath: string,
    pythonCommand = 'python3',
  ) {
    const statted: string[] = [];
    const processes = new FakeProcesses();
    return {
      statted,
      processes,
      deps: {
        processes,
        files: {
          stat: async (path: string) => {
            statted.push(path);
            return present.includes(path)
              ? { isFolder: false, isLink: false }
              : null;
          },
        },
        paths: posixPaths,
        homeDir: '/h',
        scriptPath,
        pythonCommand,
      },
    };
  }

  it('runPoolCommand_ScriptMissing_RunsNothing', async () => {
    const run = deps([], '/s/unity-pool');

    const result = await runPoolCommand(run.deps, 'hold', 'p', 3);

    expect(result).toMatchObject({ ok: false, error: 'no-cli' });
    expect(run.processes.runs).toEqual([]);
  });

  it.each(['python3', 'py'])(
    'runPoolCommand_TildeScript_ExpandsAndRunsThePythonWithoutSessionIdentity: %s',
    async (pythonCommand) => {
      const run = deps(['/h/x'], '~/x', pythonCommand);
      const args = poolCommandArgs('/h/x', 'release', 'p', 4);
      run.processes.script(
        pythonCommand,
        args,
        exited(0, '{"ok": true, "pool": "p", "clone": 4}'),
      );

      const result = await runPoolCommand(run.deps, 'release', 'p', 4);

      expect(run.statted).toEqual(['/h/x']);
      expect(run.processes.runs).toEqual([
        {
          command: pythonCommand,
          args,
          cwd: undefined,
          timeoutMs: 30_000,
          unsetEnv: expect.arrayContaining([
            'CLAUDE_CODE_SESSION_ID',
            'WIGLEY_SESSION_ROW',
          ]),
        },
      ]);
      expect(result).toEqual({ ok: true, pool: 'p', clone: 4 });
    },
  );

  it('runPoolCommand_RunRejects_CliFailed', async () => {
    const run = deps(['/s/unity-pool'], '/s/unity-pool');
    run.processes.script(
      'python3',
      poolCommandArgs('/s/unity-pool', 'hold', 'p', 3),
      new Error('spawn failed'),
    );

    expect(await runPoolCommand(run.deps, 'hold', 'p', 3)).toEqual({
      ok: false,
      error: 'cli-failed',
      message: 'spawn failed',
    });
  });
});

describe('claimCommandArgs', () => {
  it('claimCommandArgs_ClaimWaitsAndAnswersJson', () => {
    expect(claimCommandArgs('/s/unity-pool', 'p', 'feature/x')).toEqual([
      '-X',
      'utf8',
      '/s/unity-pool',
      'claim',
      '--branch',
      'feature/x',
      '--pool',
      'p',
      '--wait',
      '--json',
    ]);
  });
});

describe('readClaimAnswer', () => {
  it.each<{ name: string; result: ProcessResult; expected: ClaimAnswer }>([
    {
      name: 'ok with path',
      result: exited(
        0,
        '{"ok": true, "pool": "p", "clone": 2, "path": "/c/2", "switched": true}\n',
      ),
      expected: { ok: true, path: '/c/2' },
    },
    {
      name: 'ok without path',
      result: exited(0, '{"ok": true, "pool": "p", "clone": 2}\n'),
      expected: {
        ok: false,
        error: 'cli-failed',
        message: 'unity-pool claim answered no path',
      },
    },
    {
      name: 'diverged',
      result: exited(
        1,
        '{"ok": false, "error": "diverged", "message": "main in /c/2 has diverged"}\n',
      ),
      expected: {
        ok: false,
        error: 'diverged',
        message: 'main in /c/2 has diverged',
      },
    },
    {
      name: 'progress line before the JSON',
      result: exited(0, 'fetching\n{"ok": true, "path": "/c/3"}\n\n'),
      expected: { ok: true, path: '/c/3' },
    },
    {
      name: 'stack trace',
      result: exited(1, '', 'Traceback …\nValueError: x\n'),
      expected: { ok: false, error: 'cli-failed', message: 'ValueError: x' },
    },
    {
      name: 'nothing written',
      result: exited(2, ''),
      expected: {
        ok: false,
        error: 'cli-failed',
        message: 'unity-pool exited 2',
      },
    },
  ])('readClaimAnswer: $name', ({ result, expected }) => {
    expect(readClaimAnswer(result)).toEqual(expected);
  });
});

describe('runPoolClaim and runPoolRelease', () => {
  const request = {
    pool: 'p',
    branch: 'main',
    hostSessionId: 'host-1',
    rowId: 'row-1',
  };
  const sessionIds = {
    CLAUDE_CODE_SESSION_ID: 'host-1',
    WIGLEY_SESSION_ROW: 'row-1',
  };

  // The script is present at `/h/x` only.
  function claimDeps() {
    const processes = new FakeProcesses();
    return {
      processes,
      deps: {
        processes,
        files: {
          stat: async (path: string) =>
            path === '/h/x' ? { isFolder: false, isLink: false } : null,
        },
        paths: posixPaths,
        homeDir: '/h',
        scriptPath: '~/x',
        pythonCommand: 'python3',
      },
    };
  }

  it('runPoolClaim_RunsUnderTheSessionIdsWithNoTimeout', async () => {
    const run = claimDeps();
    run.processes.script(
      'python3',
      claimCommandArgs('/h/x', 'p', 'main'),
      exited(0, '{"ok": true, "path": "/c/1"}\n'),
    );

    const answer = await runPoolClaim(
      run.deps,
      request,
      new AbortController().signal,
    );

    expect(answer).toEqual({ ok: true, path: '/c/1' });
    expect(run.processes.runs).toHaveLength(1);
    const [claim] = run.processes.runs;
    expect(claim.timeoutMs).toBeUndefined();
    expect(claim.setEnv).toEqual(sessionIds);
    expect(claim.unsetEnv).toContain('CLAUDECODE');
    expect(claim.unsetEnv).not.toContain('CLAUDE_CODE_SESSION_ID');
    expect(claim.unsetEnv).not.toContain('WIGLEY_SESSION_ROW');
  });

  it('runPoolClaim_Cancelled_AnswersCancelledAndRunsNothingMore', async () => {
    const run = claimDeps();
    const controller = new AbortController();
    run.processes.script(
      'python3',
      claimCommandArgs('/h/x', 'p', 'main'),
      deferred<ProcessResult>().promise,
    );

    const answer = runPoolClaim(run.deps, request, controller.signal);
    await vi.waitFor(() => expect(run.processes.runs).toHaveLength(1));
    controller.abort();

    expect(await answer).toEqual({
      ok: false,
      error: 'cancelled',
      message: 'claim cancelled',
    });
    expect(run.processes.runs).toHaveLength(1);
  });

  it.each<{
    name: string;
    release: ProcessResult | Error;
    expected: PoolActionResult;
  }>([
    {
      name: 'release answers ok',
      release: exited(0, '{"ok": true, "pool": "p", "clone": 2}\n'),
      expected: { ok: true, pool: 'p', clone: 2 },
    },
    {
      name: 'release rejects',
      release: new Error('spawn failed'),
      expected: { ok: false, error: 'cli-failed', message: 'spawn failed' },
    },
  ])(
    'runPoolRelease_RunsUnderTheClaimsIdsInTheHomeFolder: $name',
    async ({ release, expected }) => {
      const run = claimDeps();
      run.processes.script(
        'python3',
        claimCommandArgs('/h/x', 'p', 'main'),
        exited(0, '{"ok": true, "path": "/c/1"}\n'),
      );
      run.processes.script('python3', releaseCommandArgs('/h/x'), release);
      await runPoolClaim(run.deps, request, new AbortController().signal);

      expect(await runPoolRelease(run.deps, request)).toEqual(expected);
      expect(run.processes.runs[1]).toMatchObject({
        args: releaseCommandArgs('/h/x'),
        cwd: '/h',
        timeoutMs: 30_000,
        setEnv: sessionIds,
        unsetEnv: run.processes.runs[0].unsetEnv,
      });
    },
  );

  it('runPoolClaim_ScriptMissing_RunsNothing', async () => {
    const run = claimDeps();

    const answer = await runPoolClaim(
      { ...run.deps, scriptPath: '/s/missing' },
      request,
      new AbortController().signal,
    );

    expect(answer).toMatchObject({ ok: false, error: 'no-cli' });
    expect(run.processes.runs).toEqual([]);
  });

  it('runPoolClaim_RunRejects_CliFailed', async () => {
    const run = claimDeps();
    run.processes.script(
      'python3',
      claimCommandArgs('/h/x', 'p', 'main'),
      new Error('spawn failed'),
    );

    expect(
      await runPoolClaim(run.deps, request, new AbortController().signal),
    ).toEqual({ ok: false, error: 'cli-failed', message: 'spawn failed' });
    expect(run.processes.runs).toHaveLength(1);
  });
});

describe('resolveScriptPath', () => {
  it('resolveScriptPath_Empty_DiffersByPlatform', () => {
    const mac = resolveScriptPath('', false);
    const windows = resolveScriptPath('', true);

    expect(mac).not.toBe('');
    expect(windows).not.toBe('');
    expect(mac).not.toBe(windows);
  });

  it.each([false, true])(
    'resolveScriptPath_Set_KeepsIt: windows %s',
    (windows) => {
      expect(resolveScriptPath('~/tools/unity-pool', windows)).toBe(
        '~/tools/unity-pool',
      );
    },
  );
});
