import { describe, expect, it } from 'vitest';
import { FakeProcesses } from './fake-processes';

describe('FakeProcesses', () => {
  it('run_NothingScripted_Rejects', async () => {
    const processes = new FakeProcesses();

    await expect(processes.run('git', ['status'])).rejects.toThrow(
      'FakeProcesses: no result scripted for git status',
    );
  });

  it.each([
    { case: 'before the run', abortsFirst: true },
    { case: 'while a scripted promise holds it open', abortsFirst: false },
  ])('run_Aborted_RejectsStopped ($case)', async ({ abortsFirst }) => {
    const processes = new FakeProcesses();
    processes.script('python3', ['index.py'], new Promise(() => {}));
    const controller = new AbortController();
    if (abortsFirst) {
      controller.abort();
    }

    const run = processes.run('python3', ['index.py'], {
      signal: controller.signal,
    });
    controller.abort();

    await expect(run).rejects.toThrow('Stopped python3');
    expect(processes.runs.map((held) => held.command)).toEqual(['python3']);
  });
});
