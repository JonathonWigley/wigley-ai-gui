import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { PoolAction, PoolActionResult } from '../contract';
import {
  poolCommandArgs,
  readActionResult,
  resolveScriptPath,
  runPoolCommand,
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
  it.each<PoolAction>(['hold', 'release', 'open'])(
    'poolCommandArgs_EachAction: %s',
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
      expected: { ok: true, pool: 'p', clone: 3, editorOpening: null },
    },
    {
      name: 'open starting the editor',
      result: exited(
        0,
        '{"ok": true, "pool": "p", "clone": 3, "held": true, "editorFocused": false, "editorOpening": true}\n',
      ),
      expected: { ok: true, pool: 'p', clone: 3, editorOpening: true },
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
      expected: { ok: true, pool: 'q', clone: 5, editorOpening: null },
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

  it('answers cli-failed and runs nothing when the stat of the script rejects', async () => {
    const run = deps(['/s/unity-pool'], '/s/unity-pool');
    run.deps.files.stat = async () => {
      throw new Error('permission denied');
    };

    const result = await runPoolCommand(run.deps, 'hold', 'p', 3);

    expect(result).toEqual({
      ok: false,
      error: 'cli-failed',
      message:
        'unity-pool could not be checked at /s/unity-pool: permission denied',
    });
    expect(run.processes.runs).toEqual([]);
  });

  it.each([
    { command: 'python3', args: [] },
    { command: 'py', args: ['-3'] },
  ])(
    'runPoolCommand_TildeScript_ExpandsAndRunsThePythonWithoutSessionIdentity: $command $args',
    async (python) => {
      const run = deps(['/h/x'], '~/x');
      run.processes.scriptProgram('python', python);
      const args = [
        ...python.args,
        ...poolCommandArgs('/h/x', 'release', 'p', 4),
      ];
      run.processes.script(
        python.command,
        args,
        exited(0, '{"ok": true, "pool": "p", "clone": 4}'),
      );

      const result = await runPoolCommand(run.deps, 'release', 'p', 4);

      expect(run.statted).toEqual(['/h/x']);
      expect(run.processes.runs).toEqual([
        {
          command: python.command,
          args,
          cwd: undefined,
          timeoutMs: 30_000,
          unsetEnv: expect.arrayContaining([
            'CLAUDE_CODE_SESSION_ID',
            'WIGLEY_SESSION_ROW',
          ]),
        },
      ]);
      expect(result).toEqual({
        ok: true,
        pool: 'p',
        clone: 4,
        editorOpening: null,
      });
    },
  );

  it('runPoolCommand_NoPython_NoPythonAndRunsNothing', async () => {
    const run = deps(['/s/unity-pool'], '/s/unity-pool');
    run.processes.scriptProgram('python', null);

    expect(await runPoolCommand(run.deps, 'hold', 'p', 3)).toEqual({
      ok: false,
      error: 'no-python',
      message: 'Python was not found on PATH; set programs.python',
    });
    expect(run.processes.runs).toEqual([]);
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
