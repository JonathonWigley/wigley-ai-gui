import { describe, expect, it } from 'vitest';
import type { ContextBreakdownAgentEvent } from '../../../contracts/agent';
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
import { contextBreakdownsSlot } from '../contract';
import { contextSourcesMainPart } from './start';

const SESSION = 's1';

const BREAKDOWN: ContextBreakdownAgentEvent = {
  type: 'contextBreakdown',
  agentId: 'main',
  at: 0,
  totalTokens: 10,
  contextWindow: 100,
  autocompactAt: null,
  deferredTokens: 0,
  sources: [
    { id: 'system_prompt', label: 'System prompt', tokens: 10, items: [] },
  ],
};

function startOnHarness() {
  return startMainPart(contextSourcesMainPart, {
    dependencies: [
      fakeDependency(chatMainKey, () => ({}) as ChatMainExports),
      fakeDependency(sessionsMainKey, () => ({}) as SessionsMainExports),
    ],
  });
}

const agentEvent = (event: ContextBreakdownAgentEvent) => ({
  sessionId: SESSION,
  profileDir: null,
  hostSessionId: 'h1',
  event,
  replayed: false,
});

describe('contextSourcesMainPart', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it.each([
    ['the main agent', BREAKDOWN, BREAKDOWN],
    ['a subagent', { ...BREAKDOWN, agentId: 'agent-1' }, undefined],
  ])('breakdownOf_%s_SlotHolds', (_case, event, held) => {
    const harness = startOnHarness();

    harness.emit('chat.agentEvent', agentEvent(event));

    expect(
      harness.state.read(contextBreakdownsSlot, 'test').get(SESSION),
    ).toEqual(held);
  });

  it('sessionEnded_DeletesItsBreakdown', () => {
    const harness = startOnHarness();
    harness.emit('chat.agentEvent', agentEvent(BREAKDOWN));

    harness.emit('sessions.ended', { sessionId: SESSION });

    expect(
      harness.state.read(contextBreakdownsSlot, 'test').get(SESSION),
    ).toBeUndefined();
  });
});
