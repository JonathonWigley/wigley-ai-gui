import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../contracts/ambient';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import { createBuildsPoller, FAST_POLL_MS, SLOW_POLL_MS } from './poller';

const flush = () => new Promise((settle) => setImmediate(settle));

// A poller over fake timers that `advance` runs in due order, and a `poll` whose promises the test settles in call
// order through `resolveNext` and `rejectNext`. `fast.value` is what `isFast` reads.
function setup(isFast = false) {
  let now = 0;
  let nextHandle = 1;
  const armed = new Map<number, { run: () => void; due: number }>();
  const timers: Timers = {
    set: (run, ms) => {
      const handle = nextHandle++;
      armed.set(handle, { run, due: now + ms });
      return handle;
    },
    clear: (handle) => {
      armed.delete(handle);
    },
  };
  const fast = { value: isFast };
  const calls: string[] = [];
  const pending: ReturnType<typeof deferred<void>>[] = [];
  const logs: string[] = [];
  const poller = createBuildsPoller({
    timers,
    poll: (id) => {
      calls.push(id);
      const next = deferred<void>();
      pending.push(next);
      return next.promise;
    },
    isFast: () => fast.value,
    log: (message) => logs.push(message),
  });
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...armed.entries()]
        .filter(([, timer]) => timer.due <= end)
        .sort(([, a], [, b]) => a.due - b.due)[0];
      if (due === undefined) {
        break;
      }
      armed.delete(due[0]);
      now = due[1].due;
      due[1].run();
      await flush();
    }
    now = end;
  };
  const resolveNext = async () => {
    pending.shift()?.resolve();
    await flush();
  };
  const rejectNext = async (error: Error) => {
    pending.shift()?.reject(error);
    await flush();
  };
  return { poller, fast, calls, logs, advance, resolveNext, rejectNext };
}

describe('createBuildsPoller', () => {
  it.each([
    {
      case: 'a fast backend',
      isFast: true,
      rejects: false,
      ms: FAST_POLL_MS,
      logs: [],
    },
    {
      case: 'a slow backend',
      isFast: false,
      rejects: false,
      ms: SLOW_POLL_MS,
      logs: [],
    },
    {
      case: 'a rejected poll',
      isFast: false,
      rejects: true,
      ms: SLOW_POLL_MS,
      logs: ['poll handling failed: boom'],
    },
  ])('$case arms $ms', async ({ isFast, rejects, ms, logs }) => {
    const run = setup(isFast);
    run.poller.setBackends(['b1'], []);
    if (rejects) {
      await run.rejectNext(new Error('boom'));
    } else {
      await run.resolveNext();
    }

    await run.advance(ms - 1);
    expect(run.calls).toEqual(['b1']);
    await run.advance(1);

    expect(run.calls).toEqual(['b1', 'b1']);
    expect(run.logs).toEqual(logs);
  });

  it('runs one more poll after the running one for any number of pollNow calls', async () => {
    const run = setup();
    run.poller.setBackends(['b1'], []);

    run.poller.pollNow('b1');
    run.poller.pollNow('b1');
    run.poller.pollNow('b1');
    expect(run.calls).toEqual(['b1']);
    await run.resolveNext();

    expect(run.calls).toEqual(['b1', 'b1']);
  });

  it('polls at once when a slow wait turns fast', async () => {
    const run = setup(false);
    run.poller.setBackends(['b1'], []);
    await run.resolveNext();

    run.fast.value = true;
    run.poller.reschedule();

    expect(run.calls).toEqual(['b1', 'b1']);
  });

  it('arms nothing for a backend dropped while its poll runs', async () => {
    const run = setup();
    run.poller.setBackends(['b1'], []);

    run.poller.setBackends([], []);
    await run.resolveNext();
    await run.advance(SLOW_POLL_MS);

    expect(run.calls).toEqual(['b1']);
  });

  it.each([
    {
      case: 'unchanged id keeps its timer',
      ids: ['b1'],
      replaced: [],
      atOnce: [],
      afterSlowWait: ['b1'],
    },
    {
      case: 'replaced id polls at once',
      ids: ['b1'],
      replaced: ['b1'],
      atOnce: ['b1'],
      afterSlowWait: null,
    },
    {
      case: 'new id polls at once',
      ids: ['b1', 'b2'],
      replaced: [],
      atOnce: ['b2'],
      afterSlowWait: null,
    },
  ])('setBackends $case', async ({ ids, replaced, atOnce, afterSlowWait }) => {
    const run = setup();
    run.poller.setBackends(['b1'], []);
    await run.resolveNext();

    run.poller.setBackends(ids, replaced);
    expect(run.calls.slice(1)).toEqual(atOnce);

    if (afterSlowWait !== null) {
      await run.advance(SLOW_POLL_MS);
      expect(run.calls.slice(1)).toEqual(afterSlowWait);
    }
  });

  it('polls a replaced id at once while its poll runs, and only the new poll arms', async () => {
    const run = setup();
    run.poller.setBackends(['b1'], []);

    run.poller.setBackends(['b1'], ['b1']);
    expect(run.calls).toEqual(['b1', 'b1']);
    await run.resolveNext();
    await run.advance(SLOW_POLL_MS);
    expect(run.calls).toEqual(['b1', 'b1']);
    await run.resolveNext();
    await run.advance(SLOW_POLL_MS);

    expect(run.calls).toEqual(['b1', 'b1', 'b1']);
  });

  it('pollNow on a waiting id clears its timer and polls at once', async () => {
    const run = setup();
    run.poller.setBackends(['b1'], []);
    await run.resolveNext();
    await run.advance(1000);

    run.poller.pollNow('b1');
    expect(run.calls).toEqual(['b1', 'b1']);
    await run.resolveNext();
    await run.advance(SLOW_POLL_MS - 1);

    expect(run.calls).toEqual(['b1', 'b1']);
  });

  it('pollNow on an unlisted id does nothing', () => {
    const run = setup();
    run.poller.setBackends(['b1'], []);

    run.poller.pollNow('b9');

    expect(run.calls).not.toContain('b9');
  });
});
