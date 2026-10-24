import { describe, expect, it } from 'vitest';
import { createPendingRuns, PageNavigatedError } from './driven-window';

describe('createPendingRuns', () => {
  it('track_StartSettles_SettlesAlike', async () => {
    const pending = createPendingRuns();
    const failure = new Error('script threw');

    await expect(pending.track(async () => 7)).resolves.toBe(7);
    await expect(
      pending.track(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('rejectAll_TwoCallsPending_RejectsBothWithPageNavigatedError', async () => {
    const pending = createPendingRuns();
    const first = pending.track(() => new Promise<number>(() => {}));
    const second = pending.track(() => new Promise<string>(() => {}));

    pending.rejectAll();

    await expect(first).rejects.toBeInstanceOf(PageNavigatedError);
    await expect(second).rejects.toBeInstanceOf(PageNavigatedError);
  });

  it('track_StartCallsRejectAll_RejectsItsOwnCall', async () => {
    const pending = createPendingRuns();

    const call = pending.track(() => {
      pending.rejectAll();
      return new Promise<number>(() => {});
    });

    await expect(call).rejects.toBeInstanceOf(PageNavigatedError);
  });

  it('rejectAll_CallsSettledBeforeOrTrackedAfter_LeavesThem', async () => {
    const pending = createPendingRuns();
    const settled = pending.track(async () => 'done');
    await settled;

    pending.rejectAll();
    let resolveLater: (value: string) => void = () => {};
    const later = pending.track(
      () =>
        new Promise<string>((resolve) => {
          resolveLater = resolve;
        }),
    );
    resolveLater('later');

    await expect(settled).resolves.toBe('done');
    await expect(later).resolves.toBe('later');
  });
});
