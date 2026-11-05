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
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import type { UsagePageExports, UsageSnapshot } from '../contract';
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

// The part on the harness, over fakes that file each handle with
// `consumer.track`, as the real views do. `invoke` answers the part's
// `channel.invoke`.
function startOnHarness(invoke?: (method: string) => Promise<unknown>) {
  return startPagePart(usagePagePart, {
    invoke,
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
            selectedSessionId: () => 's1',
            addRowPart: () => consumer.track({ dispose() {} }),
          }) as unknown as SessionsPageExports,
      ),
    ],
  });
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

  it('stop_LeavesNoLiveRegistration: snapshot reply after the stop', async () => {
    let replySnapshot = (_snapshot: UsageSnapshot) => {};
    const reply = new Promise<UsageSnapshot>((resolve) => {
      replySnapshot = resolve;
    });
    const harness = startOnHarness(() => reply);

    await harness.stop();
    replySnapshot(SNAPSHOT);
    await reply;
    await Promise.resolve();

    expect(harness.counts()).toEqual(noCounts);
    expect(harness.logs.map((line) => line.message)).not.toContainEqual(
      expect.stringContaining('status line'),
    );
  });

  it('stop_RemovesTheDrawnLineAndDetails', async () => {
    const harness = startOnHarness();
    harness.started().commands.toggleDetails({ arg: undefined });
    harness.send('changed', SNAPSHOT);
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
    harness.send('changed', SNAPSHOT);

    expect(loggedByA).toEqual([]);
    expect(loggedByB).toHaveLength(1);
  });
});
