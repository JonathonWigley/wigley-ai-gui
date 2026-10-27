import { describe, expect, it } from 'vitest';
import { FakeProcesses } from './fake-processes';

describe('FakeProcesses', () => {
  it('run_NothingScripted_Rejects', async () => {
    const processes = new FakeProcesses();

    await expect(processes.run('git', ['status'])).rejects.toThrow(
      'FakeProcesses: no result scripted for git status',
    );
  });
});
