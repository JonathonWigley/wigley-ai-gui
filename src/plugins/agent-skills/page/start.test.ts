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
import { agentsRostersSlot } from '../../agents/contract';
import {
  type ChatPageExports,
  chatPageKey,
  type ChatSidePart,
} from '../../chat/contract';
import { agentSkillsPagePart } from './start';

const SESSION = 's1';

const ROSTER = {
  agents: [],
  tasks: [],
  skills: [{ skill: 'foo', agentId: 'main', ownerName: 'main', startedAt: 0 }],
};

// The part on the harness, over fakes that file each handle with
// `consumer.track` as the real views do; chat's builds the side part into a
// wrapper at once, and disposes it with its handle.
function startOnHarness() {
  const sectionSummaries: (string | null)[] = [];
  const harness = startPagePart(agentSkillsPagePart, {
    dependencies: [
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
            addSidePart(part: ChatSidePart) {
              const built = part.build(
                asHtml(new FakeElement('div')),
                SESSION,
                { setSummary: (text) => sectionSummaries.push(text) },
              );
              return consumer.track({ dispose: () => built.dispose?.() });
            },
          }) as unknown as ChatPageExports,
      ),
    ],
  });
  return { harness, sectionSummaries };
}

describe('agentSkillsPagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness, sectionSummaries } = startOnHarness();
    expect(sectionSummaries).toEqual([null]);
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startOnHarness();
    harness.ready();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it('ready_RosterWrittenBefore_DrawsIt', () => {
    const { harness, sectionSummaries } = startOnHarness();
    harness.state.publish(agentsRostersSlot).set(SESSION, ROSTER);
    expect(sectionSummaries).toEqual([null]);

    harness.ready();

    expect(sectionSummaries).toEqual([null, '1']);
  });
});
