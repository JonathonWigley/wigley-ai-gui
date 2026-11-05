import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { agentsPagePart } from './start';

describe('agentsPagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startPagePart(agentsPagePart);
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startPagePart(agentsPagePart);
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });
});
