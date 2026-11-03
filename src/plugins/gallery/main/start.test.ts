import { describe, expect, it } from 'vitest';
import { startMainPart } from '../../../shared/plugin-part-harness.test-support';
import { galleryMainPart } from './start';

describe('gallery main part', () => {
  it('stops with nothing live and starts again', async () => {
    const harness = startMainPart(galleryMainPart);

    await harness.stop();
    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });

    await harness.restart();
    expect(harness.counts().registrations).toBeGreaterThan(0);
    await harness.stop();
  });
});
