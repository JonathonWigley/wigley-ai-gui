import { describe, expect, it, vi } from 'vitest';
import type { Git } from '../../../contracts/git';
import type { SlotWriter } from '../../../contracts/state';
import type { AppUpdateStatus } from '../contract';
import type { Installer } from './installer';
import { CHECK_EVERY_MS, createUpdater, FOCUS_CHECK_GAP_MS } from './updater';

const INSTALLED = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ORIGIN = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Timers run by `advance`, on a clock it moves.
function fakeTime() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  return {
    clock: { now: () => now },
    timers: {
      set(run: () => void, ms: number) {
        const handle = next++;
        pending.set(handle, { at: now + ms, run });
        return handle;
      },
      clear(handle: number) {
        pending.delete(handle);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of pending) {
        if (timer.at <= now) {
          pending.delete(handle);
          timer.run();
        }
      }
    },
  };
}

function memorySlot(): SlotWriter<AppUpdateStatus> {
  let value: AppUpdateStatus | undefined;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
    dispose() {},
  };
}

function setUp() {
  const time = fakeTime();
  const git = {
    fetch: vi.fn(async () => false),
    resolveCommit: vi.fn(async (): Promise<string | null> => ORIGIN),
    isAncestor: vi.fn(async () => true),
  } satisfies Pick<Git, 'fetch' | 'resolveCommit' | 'isAncestor'>;
  const installer: Installer = {
    start: vi.fn(async () => {}),
    result: vi.fn(async () => null),
    startedFrom: vi.fn(async () => null),
  };
  const status = memorySlot();
  const logs: string[] = [];
  const updater = createUpdater({
    installed: INSTALLED,
    cloneDir: '/clone',
    git,
    installer,
    status,
    timers: time.timers,
    clock: time.clock,
    log: (message) => logs.push(message),
  });
  return { time, git, installer, status, updater, logs };
}

describe('createUpdater', () => {
  it('check_CloneBroken_LogsTheFailureAndKeepsTheStatus', async () => {
    const test = setUp();
    await settle();
    test.git.resolveCommit.mockRejectedValueOnce(
      new Error('git rev-parse exited 128: fatal: not a git repository'),
    );

    await test.updater.check();

    expect(test.status.get()).toEqual({ kind: 'available', sha: '2222222' });
    expect(test.logs).toContain(
      'check failed: git rev-parse exited 128: fatal: not a git repository',
    );
  });

  it('start_ChecksAtOnceThenEveryInterval', async () => {
    const test = setUp();
    await settle();
    expect(test.git.fetch).toHaveBeenCalledTimes(1);

    test.time.advance(CHECK_EVERY_MS);
    await settle();

    expect(test.git.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { case: 'within the gap', afterMs: FOCUS_CHECK_GAP_MS - 1, fetches: 1 },
    { case: 'past the gap', afterMs: FOCUS_CHECK_GAP_MS, fetches: 2 },
  ])('a focus fetches $fetches times ($case)', async ({ afterMs, fetches }) => {
    const test = setUp();
    await settle();

    test.time.advance(afterMs);
    test.updater.focused();
    await settle();

    expect(test.git.fetch).toHaveBeenCalledTimes(fetches);
  });

  it('check_InstallStartedWhileItRan_KeepsInstalling', async () => {
    const test = setUp();
    await settle();
    let resolveOrigin: (sha: string | null) => void = () => {};
    test.git.resolveCommit.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOrigin = resolve)),
    );
    const check = test.updater.check();
    await settle();

    await test.updater.install();
    resolveOrigin(INSTALLED);
    await check;

    expect(test.status.get()).toEqual({ kind: 'installing' });
  });

  it('check_FetchFails_StillReadsTheLastFetchedOrigin', async () => {
    const test = setUp();
    test.git.fetch.mockResolvedValue(true);

    await test.updater.check();

    expect(test.status.get()).toEqual({ kind: 'available', sha: '2222222' });
  });

  it('dispose_StopsTheTimers', async () => {
    const test = setUp();
    await settle();

    test.updater.dispose();
    test.time.advance(CHECK_EVERY_MS);
    await settle();

    expect(test.git.fetch).toHaveBeenCalledTimes(1);
  });
});
