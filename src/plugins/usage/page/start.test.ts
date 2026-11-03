import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageAgentEvent } from '../../../contracts/agent';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { type ChatPageExports, chatPageKey } from '../../chat/contract';
import { keysPageKey } from '../../keys/contract';
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
  sessions: [{ sessionId: 's1', profileDir: null, usage: USAGE }],
};

// The part on the harness, over fakes that file each handle with
// `consumer.track`, as the real views do.
function startOnHarness() {
  return startPagePart(usagePagePart, {
    dependencies: [
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
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
      fakeDependency(keysPageKey, (consumer) => ({
        keysFor: () => null,
        onChanged: () => consumer.track({ dispose() {} }),
        anchor: () => consumer.track({ dispose() {} }),
      })),
    ],
  });
}

describe('usagePagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    harness.advance(60_000);
    expect(harness.counts().registrations).toBeGreaterThan(0);
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
