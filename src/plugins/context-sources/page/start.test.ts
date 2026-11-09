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

type Harness = ReturnType<typeof startOnHarness>['harness'];

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
    harness.ready();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it.each<{ name: string; load: (harness: Harness) => Promise<void> }>([
    { name: 'page load', load: async (harness) => harness.ready() },
    {
      name: 'live restart',
      load: async (harness) => {
        harness.ready();
        await harness.restart();
      },
    },
  ])(
    'ready_BreakdownWrittenBefore_DrawsItAndHearsTheNext: $name',
    async ({ load }) => {
      const { harness, sectionSummaries } = startOnHarness();
      const breakdowns = harness.state.publish(contextBreakdownsSlot);
      breakdowns.set(SESSION, BREAKDOWN);
      expect(sectionSummaries).toEqual([null]);

      await load(harness);
      const drawnAtLoad = sectionSummaries.at(-1);
      breakdowns.set(SESSION, { ...BREAKDOWN, totalTokens: 20_000 });

      expect([drawnAtLoad, sectionSummaries.at(-1)]).toEqual([
        '10k · 10%',
        '20k · 20%',
      ]);
    },
  );
});
