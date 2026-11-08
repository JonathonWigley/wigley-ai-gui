import { describe, expect, it } from 'vitest';
import {
  createPageRestores,
  type PageRestoresHost,
  RESTORES_CAP_MS,
} from './page-restores';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Restores over timers the test runs by hand: `passCap` runs every timer due
// by `RESTORES_CAP_MS`, and `logged` holds each line logged.
function startRestores() {
  const due = new Map<number, { run: () => void; ms: number }>();
  let nextHandle = 1;
  const logged: string[] = [];
  const restores = createPageRestores({
    timers: {
      set(run, ms) {
        const handle = nextHandle++;
        due.set(handle, { run, ms });
        return handle;
      },
      clear: (handle) => void due.delete(handle),
    },
    log: (message) => logged.push(message),
  });
  const passCap = () => {
    for (const [handle, { run, ms }] of due) {
      if (ms <= RESTORES_CAP_MS) {
        due.delete(handle);
        run();
      }
    }
  };
  return { restores, passCap, logged };
}

// Whether `restores` has settled, read through a listener added now.
function settledNow(restores: PageRestoresHost): boolean {
  let isSettled = false;
  restores
    .onSettled(() => {
      isSettled = true;
    })
    .dispose();
  return isSettled;
}

describe('page restores', () => {
  it.each([
    {
      name: 'nothing tracked',
      tracked: 0,
      finished: 0,
      pageReady: true,
      capPassed: false,
      settled: true,
      logged: [],
    },
    {
      name: 'one of two pending',
      tracked: 2,
      finished: 1,
      pageReady: true,
      capPassed: false,
      settled: false,
      logged: [],
    },
    {
      name: 'one of two pending past the cap',
      tracked: 2,
      finished: 1,
      pageReady: true,
      capPassed: true,
      settled: true,
      logged: [
        `restores settled at the ${RESTORES_CAP_MS} ms cap, 1 still pending`,
      ],
    },
    {
      name: 'both settled, one rejected, then the cap passes',
      tracked: 2,
      finished: 2,
      pageReady: true,
      capPassed: true,
      settled: true,
      logged: [],
    },
    {
      name: 'both settled, before page ready',
      tracked: 2,
      finished: 2,
      pageReady: false,
      capPassed: false,
      settled: false,
      logged: [],
    },
  ])(
    'onSettled_FiresOncePageReadyAndNoTrackedRestorePendingOrAtTheCap: $name',
    async ({ tracked, finished, pageReady, capPassed, settled, logged }) => {
      const setup = startRestores();
      const { restores } = setup;
      const first = Promise.withResolvers<void>();
      const second = Promise.withResolvers<void>();
      for (const restore of [first, second].slice(0, tracked)) {
        restores.track(restore.promise);
      }
      const heard: string[] = [];
      restores.onSettled(() => heard.push('settled'));

      if (finished >= 1) {
        first.resolve();
      }
      if (finished >= 2) {
        second.reject(new Error('read failed'));
      }
      if (pageReady) {
        restores.pageReady();
      }
      await settle();
      if (capPassed) {
        setup.passCap();
      }

      expect([heard, setup.logged]).toEqual([
        settled ? ['settled'] : [],
        logged,
      ]);
    },
  );

  it('track_InsideAPendingRestore_KeepsTheRestoresUnsettled', async () => {
    const { restores } = startRestores();
    const outer = Promise.withResolvers<void>();
    const inner = Promise.withResolvers<void>();
    restores.track(
      outer.promise.then(() => {
        restores.track(inner.promise);
      }),
    );
    restores.pageReady();

    outer.resolve();
    await settle();
    const settledBeforeInner = settledNow(restores);
    inner.resolve();
    await settle();

    expect([settledBeforeInner, settledNow(restores)]).toEqual([false, true]);
  });

  it('track_AfterSettled_IsNotWaitedOn', async () => {
    const { restores } = startRestores();
    restores.pageReady();

    restores.track(new Promise(() => undefined));

    expect(settledNow(restores)).toBe(true);
  });
});
