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
import type { ContextBreakdownAgentEvent } from '../../../contracts/agent';
import {
  type ChatPageExports,
  chatPageKey,
  type ChatSidePart,
} from '../../chat/contract';
import { contextBreakdownsSlot } from '../contract';
import { contextSourcesPagePart } from './start';

const SESSION = 's1';

const BREAKDOWN: ContextBreakdownAgentEvent = {
  type: 'contextBreakdown',
  agentId: 'main',
  at: 0,
  totalTokens: 10_000,
  contextWindow: 100_000,
  autocompactAt: null,
  deferredTokens: 0,
  sources: [
    { id: 'system_prompt', label: 'System prompt', tokens: 10_000, items: [] },
  ],
};

// The part on the harness, over fakes that file each handle with
// `consumer.track` as the real views do; chat's builds the side part into a
// wrapper at once, and disposes it with its handle.
function startOnHarness() {
  const sectionSummaries: (string | null)[] = [];
  const harness = startPagePart(contextSourcesPagePart, {
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

describe('contextSourcesPagePart', () => {
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
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it('ready_BreakdownWrittenBefore_DrawsIt', () => {
    const { harness, sectionSummaries } = startOnHarness();
    harness.state.publish(contextBreakdownsSlot).set(SESSION, BREAKDOWN);
    expect(sectionSummaries).toEqual([null]);

    harness.ready();

    expect(sectionSummaries).toEqual([null, '10k · 10%']);
  });
});
