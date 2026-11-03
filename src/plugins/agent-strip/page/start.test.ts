import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { agentsPageKey, type Roster } from '../../agents/contract';
import { type ChatPageExports, chatPageKey } from '../../chat/contract';
import { keysPageKey } from '../../keys/contract';
import { agentStripPagePart } from './start';

const SESSION = 's1';

const RUNNING: Roster = {
  agents: [],
  tasks: [
    {
      taskId: 't1',
      agentId: 'main',
      description: 'watch the tests',
      command: 'npm test',
      startedAt: 0,
      outcome: 'running',
    },
  ],
};

// The part on the harness, over fakes that file each handle with
// `consumer.track` as the real views do; chat's builds the composer part into a
// wrapper at once, and disposes it with its handle.
function startOnHarness() {
  return startPagePart(agentStripPagePart, {
    dependencies: [
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
            addComposerPart(
              part: Parameters<ChatPageExports['addComposerPart']>[0],
            ) {
              const built = part.build(asHtml(new FakeElement('div')), SESSION);
              return consumer.track({ dispose: () => built.dispose?.() });
            },
          }) as unknown as ChatPageExports,
      ),
      fakeDependency(agentsPageKey, (consumer) => ({
        roster: () => RUNNING,
        onRosterChanged: () => consumer.track({ dispose() {} }),
      })),
      fakeDependency(keysPageKey, (consumer) => ({
        keysFor: () => null,
        onChanged: () => consumer.track({ dispose() {} }),
        anchor: () => consumer.track({ dispose() {} }),
      })),
    ],
  });
}

describe('agentStripPagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);
    expect(harness.counts().observers).toBe(1);
    expect(harness.counts().timers).toBe(1);

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
