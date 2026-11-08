import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { agentsRostersSlot, type Roster } from '../../agents/contract';
import {
  type SessionPart,
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import { agentLinesPagePart } from './start';

const SESSION = 's1';

const RUNNING: Roster = {
  agents: [],
  tasks: [
    {
      taskId: 't1',
      agentId: 'main',
      ownerName: 'Main',
      description: 'watch the tests',
      command: 'npm test',
      startedAt: 0,
    },
  ],
  skills: [],
};

// The part on the harness, over fakes that file each handle with
// `consumer.track`, as the real views do. Sessions' builds the row part for
// `SESSION` at once, and disposes it with its handle.
function startOnHarness() {
  return startPagePart(agentLinesPagePart, {
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addRowPart(part: SessionPart) {
              const built = part.build(asHtml(new FakeElement('div')), SESSION);
              return consumer.track({ dispose: () => built.dispose?.() });
            },
          }) as unknown as SessionsPageExports,
      ),
    ],
  });
}

describe('agentLinesPagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

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
    harness.ready();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it('ready_RosterWrittenBefore_DrawsItAndHearsTheNext', () => {
    const harness = startOnHarness();
    const rosters = harness.state.publish(agentsRostersSlot);
    rosters.set(SESSION, RUNNING);
    expect(harness.counts().timers).toBe(0);

    harness.ready();
    expect(harness.counts().timers).toBe(1);

    rosters.delete(SESSION);
    expect(harness.counts().timers).toBe(0);
  });
});
