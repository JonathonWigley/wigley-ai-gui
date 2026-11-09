import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageAgentEvent } from '../../../contracts/agent';
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
import { createRegistrations } from '../../../shared/registrations';
import { type ChatPageExports, chatPageKey } from '../../chat/contract';
import {
  sessionsActiveSlot,
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import {
  type UsagePageExports,
  type UsageSnapshot,
  usageSnapshotSlot,
} from '../contract';
import { usagePagePart } from './start';

const USAGE: UsageAgentEvent = {
  type: 'usage',
  agentId: 'main',
  at: 0,
  contextTokens: 180_000,
  contextWindow: 1_000_000,
  autocompact: { configured: 300_000, reported: null },
  cacheExpiresAt: 2_520_000,
  spendUsd: 1.234,
};

const SNAPSHOT: UsageSnapshot = {
  plans: [],
  sessions: [
    { sessionId: 's1', profileDir: null, usage: USAGE, compaction: null },
  ],
};

const EMPTY_SNAPSHOT: UsageSnapshot = { plans: [], sessions: [] };

const PLAN_SNAPSHOT: UsageSnapshot = {
  plans: [
    {
      name: 'work',
      profileDir: null,
      isDefault: true,
      usage: null,
      lastGoodAt: null,
      error: null,
      stale: false,
    },
  ],
  sessions: [],
};

// The part on the harness, over fakes that file each handle with
// `consumer.track`, as the real views do.
function startOnHarness() {
  const harness = startPagePart(usagePagePart, {
    dependencies: [
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
            addComposerPart: () => consumer.track({ dispose() {} }),
            addStatusPart: () => consumer.track({ dispose() {} }),
          }) as unknown as ChatPageExports,
      ),
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addRowPart: () => consumer.track({ dispose() {} }),
          }) as unknown as SessionsPageExports,
      ),
    ],
  });
  harness.state.publish(sessionsActiveSlot).set('s1');
  return harness;
}

describe('usagePagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    harness.advance(60_000);
    expect(harness.counts().registrations).toBeGreaterThan(0);
    expect(harness.counts().timers).toBe(1);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stop_RemovesTheDrawnLineAndDetails', async () => {
    const harness = startOnHarness();
    harness.started().commands.toggleDetails({ arg: undefined });
    harness.ready();
    harness.state.publish(usageSnapshotSlot).set(SNAPSHOT);
    const remove = vi.spyOn(FakeElement.prototype, 'remove');

    await harness.stop();

    const removed = remove.mock.contexts as FakeElement[];
    expect(removed.map((node) => node.className)).toEqual([
      'usage-status-line',
      'usage-details',
    ]);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness();
    harness.ready();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it('exports_ConsumerDisposed_StopsRedrawingItsLine', () => {
    const harness = startOnHarness();
    const exportsFor = harness.started().exports as (
      consumer: ReturnType<typeof createRegistrations>,
    ) => UsagePageExports;
    const consumerA = createRegistrations();
    const consumerB = createRegistrations();
    const loggedByA: string[] = [];
    const loggedByB: string[] = [];
    const wrapper = () => asHtml(new FakeElement('div'));
    exportsFor(consumerA)
      .sessionLinePart('a.line', (line) => loggedByA.push(line))
      .build(wrapper(), 's1');
    exportsFor(consumerB)
      .sessionLinePart('b.line', (line) => loggedByB.push(line))
      .build(wrapper(), 's1');

    consumerA.dispose();
    harness.ready();
    harness.state.publish(usageSnapshotSlot).set(SNAPSHOT);

    expect(loggedByA).toEqual([]);
    expect(loggedByB).toHaveLength(1);
  });

  // `drawn` counts the status lines drawn by the load, a live restart drawing
  // once for the ready before it and once for its own.
  it.each<{
    name: string;
    written: UsageSnapshot | null;
    restarts: boolean;
    drawn: number;
  }>([
    { name: 'no snapshot', written: null, restarts: false, drawn: 0 },
    {
      name: 'the empty snapshot',
      written: EMPTY_SNAPSHOT,
      restarts: false,
      drawn: 1,
    },
    {
      name: 'the empty snapshot, on a live restart',
      written: EMPTY_SNAPSHOT,
      restarts: true,
      drawn: 2,
    },
  ])(
    'ready_DrawsTheZeroLineAndHearsTheNext: $name',
    async ({ written, restarts, drawn }) => {
      const harness = startOnHarness();
      const snapshots = harness.state.publish(usageSnapshotSlot);
      if (written !== null) {
        snapshots.set(written);
      }
      const statusLines = () =>
        harness.logs.filter(({ message }) => message.startsWith('status line'));
      expect(statusLines()).toEqual([]);

      harness.ready();
      if (restarts) {
        await harness.restart();
      }
      const drawnAtLoad = statusLines().length;
      snapshots.set(PLAN_SNAPSHOT);

      expect([drawnAtLoad, statusLines().length]).toEqual([drawn, drawn + 1]);
    },
  );
});
