import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { agentsPageKey } from '../../agents/contract';
import { keysPageKey } from '../../keys/contract';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import { agentLinesPagePart } from './start';

// The part on the harness, over fakes that file each handle with
// `consumer.track`, as the real views do. Row parts are not built.
function startOnHarness() {
  return startPagePart(agentLinesPagePart, {
    dependencies: [
      fakeDependency(agentsPageKey, (consumer) => ({
        roster: () => ({ agents: [], tasks: [] }),
        onRosterChanged: () => consumer.track({ dispose() {} }),
      })),
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addRowPart: () => consumer.track({ dispose() {} }),
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(keysPageKey, (consumer) => ({
        keysFor: () => null,
        onChanged: () => consumer.track({ dispose() {} }),
        anchor: () => consumer.track({ dispose() {} }),
      })),
    ],
  });
}

describe('agentLinesPagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });
});
