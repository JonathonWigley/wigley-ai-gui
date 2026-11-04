import { describe, expect, it } from 'vitest';
import {
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { galleryMainPart } from './start';

describe('gallery main part', () => {
  it('stops with nothing live and starts again', async () => {
    const harness = startMainPart(galleryMainPart);

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    await harness.restart();
    expect(harness.counts().registrations).toBeGreaterThan(0);
    await harness.stop();
  });
});
