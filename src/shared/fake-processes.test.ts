import { describe, expect, it } from 'vitest';
import { FakeProcesses } from './fake-processes';

describe('FakeProcesses', () => {
  it('run_TimeoutMs_Recorded', async () => {
    const processes = new FakeProcesses();
    processes.script('git', ['fetch'], {
      code: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    });

    await processes.run('git', ['fetch'], { timeoutMs: 15000 });

    expect(processes.runs).toEqual([
      { command: 'git', args: ['fetch'], cwd: undefined, timeoutMs: 15000 },
    ]);
  });

  it('run_ScriptedTimedOut_ResolvesIt', async () => {
    const processes = new FakeProcesses();
    const timedOut = { code: -1, stdout: '', stderr: '', timedOut: true };
    processes.script('git', ['fetch'], timedOut);

    await expect(processes.run('git', ['fetch'])).resolves.toEqual(timedOut);
  });

  it('run_NothingScripted_Rejects', async () => {
    const processes = new FakeProcesses();

    await expect(processes.run('git', ['status'])).rejects.toThrow(
      'FakeProcesses: no result scripted for git status',
    );
  });
});
