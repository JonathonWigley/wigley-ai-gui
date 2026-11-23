import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { runTeamcity } from './teamcity-cli';

const COMMAND = '/opt/tc';
const RUN_ARGS = ['run', 'list', '--no-input'];

function result(overrides: Partial<ProcessResult>): ProcessResult {
  return { code: 0, stdout: '', stderr: '', timedOut: false, ...overrides };
}

describe('runTeamcity', () => {
  it('runs the command with --no-input appended and resolves stdout', async () => {
    const processes = new FakeProcesses();
    processes.script(COMMAND, RUN_ARGS, result({ stdout: 'out' }));

    const stdout = await runTeamcity(
      { processes, command: COMMAND },
      ['run', 'list'],
      30_000,
    );

    expect(stdout).toBe('out');
    expect(
      processes.runs.map(({ command, args, timeoutMs }) => ({
        command,
        args,
        timeoutMs,
      })),
    ).toEqual([{ command: COMMAND, args: RUN_ARGS, timeoutMs: 30_000 }]);
  });

  it.each([
    {
      name: 'a non-zero exit',
      answer: result({ code: 1, stderr: 'warn\nError: not authorized\n' }),
      message: 'teamcity run list exited 1: Error: not authorized',
    },
    {
      name: 'a non-zero exit, no stderr',
      answer: result({ code: 2 }),
      message: 'teamcity run list exited 2',
    },
    {
      name: 'a timeout',
      answer: result({ code: -1, timedOut: true }),
      message: 'teamcity run list timed out',
    },
    {
      name: 'a run that cannot start',
      answer: new Error('Could not run /opt/tc: ENOENT'),
      message: 'Could not run /opt/tc: ENOENT',
    },
  ])('rejects on $name', async ({ answer, message }) => {
    const processes = new FakeProcesses();
    processes.script(COMMAND, RUN_ARGS, answer);

    await expect(
      runTeamcity({ processes, command: COMMAND }, ['run', 'list'], 30_000),
    ).rejects.toThrow(message);
  });
});
