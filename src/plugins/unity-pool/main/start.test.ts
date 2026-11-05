import { describe, expect, it, vi } from 'vitest';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import { unityPoolMainPart } from './start';

function startOnHarness() {
  return startMainPart(unityPoolMainPart, {
    dependencies: [
      fakeDependency(chatMainKey, () => ({}) as unknown as ChatMainExports),
      fakeDependency(
        sessionsMainKey,
        () => ({}) as unknown as SessionsMainExports,
      ),
    ],
  });
}

describe('unityPoolMainPart', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness();
    // The first scan finds no state folder and sets the minute's check.
    await vi.waitFor(() => expect(harness.counts().timers).toBe(1));
    const before = harness.counts();

    await harness.restart();
    await vi.waitFor(() => expect(harness.counts()).toEqual(before));
  });
});
