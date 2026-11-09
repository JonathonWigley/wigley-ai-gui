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
      partsReady: true,
      capPassed: false,
      settled: true,
      logged: ['restores settled'],
    },
    {
      name: 'one of two pending',
      tracked: 2,
      finished: 1,
      partsReady: true,
      capPassed: false,
      settled: false,
      logged: [],
    },
    {
      name: 'one of two pending past the cap',
      tracked: 2,
      finished: 1,
      partsReady: true,
      capPassed: true,
      settled: true,
      logged: [
        `restores settled at the ${RESTORES_CAP_MS} ms cap, 1 still pending`,
        'restores settled',
      ],
    },
    {
      name: 'both settled, one rejected, then the cap passes',
      tracked: 2,
      finished: 2,
      partsReady: true,
      capPassed: true,
      settled: true,
      logged: ['restores settled'],
    },
    {
      name: 'both settled, before parts ready',
      tracked: 2,
      finished: 2,
      partsReady: false,
      capPassed: false,
      settled: false,
      logged: [],
    },
  ])(
    'onSettled_FiresOncePartsReadyAndNoTrackedRestorePendingOrAtTheCap: $name',
    async ({ tracked, finished, partsReady, capPassed, settled, logged }) => {
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
      if (partsReady) {
        restores.partsReady();
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
    restores.partsReady();

    outer.resolve();
    await settle();
    const settledBeforeInner = settledNow(restores);
    inner.resolve();
    await settle();

    expect([settledBeforeInner, settledNow(restores)]).toEqual([false, true]);
  });

  // Each row settles the load window first, the `capped` row at the cap with
  // a restore still pending, then reopens; `beforeReopen` reopens before the
  // load window settled instead, with a listener added before the reopen.
  it.each([
    {
      name: 'nothing tracked',
      capped: false,
      beforeReopen: false,
      tracked: false,
      settled: true,
    },
    {
      name: 'one tracked, pending',
      capped: false,
      beforeReopen: false,
      tracked: true,
      settled: false,
    },
    {
      name: 'a restore left from the capped window settles',
      capped: true,
      beforeReopen: false,
      tracked: true,
      settled: false,
    },
    {
      name: 'reopen before the load window settled',
      capped: false,
      beforeReopen: true,
      tracked: false,
      settled: false,
    },
  ])(
    'reopen_OpensANewWindowThatSettlesOncePartsReadyAndItsRestoresSettle: $name',
    async ({ capped, beforeReopen, tracked, settled }) => {
      const setup = startRestores();
      const { restores } = setup;
      const loadRestore = Promise.withResolvers<void>();
      const liveRestore = Promise.withResolvers<void>();
      const heard: string[] = [];
      if (capped || beforeReopen) {
        restores.track(loadRestore.promise);
      }
      if (beforeReopen) {
        restores.onSettled(() => heard.push('before reopen'));
      } else {
        restores.partsReady();
        await settle();
        if (capped) {
          setup.passCap();
        }
      }
      setup.logged.length = 0;

      restores.reopen();
      restores.onSettled(() => heard.push('after reopen'));
      if (tracked) {
        restores.track(liveRestore.promise);
      }
      if (capped) {
        loadRestore.resolve();
      }
      restores.partsReady();
      await settle();

      expect([heard, setup.logged]).toEqual(
        settled ? [['after reopen'], ['restores settled']] : [[], []],
      );
    },
  );

  // `first`'s handle is disposed, as its part's stop does; `second` stays
  // pending in the second row.
  it.each([
    { name: 'released while pending', firstSettles: false, settled: true },
    {
      name: 'released after it settled, beside a pending restore',
      firstSettles: true,
      settled: false,
    },
  ])(
    'track_HandleDisposed_StopsWaitingOnThatRestoreOnce: $name',
    async ({ firstSettles, settled }) => {
      const { restores } = startRestores();
      const first = Promise.withResolvers<void>();
      const handle = restores.track(first.promise);
      if (firstSettles) {
        restores.track(new Promise(() => undefined));
        first.resolve();
        await settle();
      }

      handle.dispose();
      restores.partsReady();

      expect(settledNow(restores)).toBe(settled);
    },
  );

  it('track_AfterSettled_IsNotWaitedOn', async () => {
    const { restores } = startRestores();
    restores.partsReady();

    restores.track(new Promise(() => undefined));

    expect(settledNow(restores)).toBe(true);
  });
});
