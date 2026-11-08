import { describe, expect, it } from 'vitest';
import { createPageRestores, type PageRestoresHost } from './page-restores';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
      settled: true,
    },
    {
      name: 'one of two pending',
      tracked: 2,
      finished: 1,
      pageReady: true,
      settled: false,
    },
    {
      name: 'both settled, one rejected',
      tracked: 2,
      finished: 2,
      pageReady: true,
      settled: true,
    },
    {
      name: 'both settled, before page ready',
      tracked: 2,
      finished: 2,
      pageReady: false,
      settled: false,
    },
  ])(
    'onSettled_FiresOncePageReadyAndNoTrackedRestorePending: $name',
    async ({ tracked, finished, pageReady, settled }) => {
      const restores = createPageRestores();
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

      expect(heard).toEqual(settled ? ['settled'] : []);
    },
  );

  it('track_InsideAPendingRestore_KeepsTheRestoresUnsettled', async () => {
    const restores = createPageRestores();
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
    const restores = createPageRestores();
    restores.pageReady();

    restores.track(new Promise(() => undefined));

    expect(settledNow(restores)).toBe(true);
  });
});
