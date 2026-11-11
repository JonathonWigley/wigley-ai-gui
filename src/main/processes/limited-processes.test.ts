import { describe, expect, it } from 'vitest';
import type {
  ProcessResult,
  ProcessRunner,
  ProcessRunOptions,
} from '../../contracts/processes';
import { limitRuns } from './limited-processes';

const DONE: ProcessResult = {
  code: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
};

// A runner whose `a`, `b` and `c` runs each wait until the test releases it;
// any other command rejects at once. `started` lists each run's command.
function setUp() {
  const started: string[] = [];
  const release: Record<string, () => void> = {};
  const held = new Map<string, Promise<ProcessResult>>();
  for (const name of ['a', 'b', 'c']) {
    held.set(
      name,
      new Promise((resolve) => {
        release[name] = () => resolve(DONE);
      }),
    );
  }
  const inner: ProcessRunner = {
    run: (command: string, _args: string[], _options?: ProcessRunOptions) => {
      started.push(command);
      return held.get(command) ?? Promise.reject(new Error(`No ${command}`));
    },
    startDetached: async (command: string) => {
      started.push(`detached ${command}`);
    },
  };
  return { started, release, limited: limitRuns(inner, 2) };
}

describe('limitRuns', () => {
  it('startDetached_AtTheLimit_StartsAtOnce', async () => {
    const { started, limited } = setUp();
    limited.run('a', []);
    limited.run('b', []);

    await limited.startDetached('c', [], { logPath: '/tmp/c.log' });

    expect(started).toEqual(['a', 'b', 'detached c']);
  });

  it('run_PastTheLimit_WaitsForARunToEnd', async () => {
    const { started, release, limited } = setUp();

    const runs = ['a', 'b', 'c'].map((name) => limited.run(name, []));
    expect(started).toEqual(['a', 'b']);
    release.a();
    await runs[0];

    expect(started).toEqual(['a', 'b', 'c']);
    release.b();
    release.c();
    await expect(Promise.all(runs)).resolves.toEqual([DONE, DONE, DONE]);
  });

  it('run_SeveralWaiting_StartInCallOrder', async () => {
    const { started, release } = setUp();
    const inner: ProcessRunner = {
      run: (command: string) => {
        started.push(command);
        return command === 'a'
          ? new Promise((resolve) => {
              release.a = () => resolve(DONE);
            })
          : Promise.resolve(DONE);
      },
      startDetached: () => Promise.reject(new Error('unused')),
    };
    const limited = limitRuns(inner, 1);

    const runs = ['a', 'c', 'b'].map((name) => limited.run(name, []));
    release.a();
    await Promise.all(runs);

    expect(started).toEqual(['a', 'c', 'b']);
  });

  it('run_AbortedWhileWaiting_RejectsStoppedWithoutStarting', async () => {
    const { started, release, limited } = setUp();
    const controller = new AbortController();

    const runs = [
      limited.run('a', []),
      limited.run('b', []),
      limited.run('c', [], { signal: controller.signal }),
    ];
    controller.abort();
    await expect(runs[2]).rejects.toThrow('Stopped c');
    release.a();
    release.b();
    await Promise.all(runs.slice(0, 2));

    expect(started).toEqual(['a', 'b']);
  });

  it('run_FailedRun_FreesItsTurn', async () => {
    const { started, release, limited } = setUp();

    const missing = limited.run('missing', []);
    const runs = [limited.run('a', []), limited.run('b', [])];
    await expect(missing).rejects.toThrow('No missing');
    await Promise.resolve();

    expect(started).toEqual(['missing', 'a', 'b']);
    release.a();
    release.b();
    await Promise.all(runs);
  });
});
