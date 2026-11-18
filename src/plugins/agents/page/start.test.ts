import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import { agentsPagePart } from './start';

// The part on the harness over a sessions page whose `activate` does nothing.
function startOnHarness() {
  return startPagePart(agentsPagePart, {
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        () => ({ activate: () => undefined }) as unknown as SessionsPageExports,
      ),
    ],
  });
}

describe('agentsPagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });
});
