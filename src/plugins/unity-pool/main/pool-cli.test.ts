import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { PoolAction, PoolActionResult } from '../contract';
import { poolCommandArgs, readActionResult, runPoolCommand } from './pool-cli';

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
  function deps(present: string[], scriptPath: string) {
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
      },
    };
  }

  it('runPoolCommand_ScriptMissing_RunsNothing', async () => {
    const run = deps([], '/s/unity-pool');

    const result = await runPoolCommand(run.deps, 'hold', 'p', 3);

    expect(result).toMatchObject({ ok: false, error: 'no-cli' });
    expect(run.processes.runs).toEqual([]);
  });

  it('runPoolCommand_TildeScript_ExpandsAndRuns', async () => {
    const run = deps(['/h/x'], '~/x');
    const args = poolCommandArgs('/h/x', 'release', 'p', 4);
    run.processes.script(
      'python3',
      args,
      exited(0, '{"ok": true, "pool": "p", "clone": 4}'),
    );

    const result = await runPoolCommand(run.deps, 'release', 'p', 4);

    expect(run.statted).toEqual(['/h/x']);
    expect(run.processes.runs[0]).toEqual({
      command: 'python3',
      args,
      cwd: undefined,
      timeoutMs: 30_000,
    });
    expect(result).toEqual({ ok: true, pool: 'p', clone: 4 });
  });

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
