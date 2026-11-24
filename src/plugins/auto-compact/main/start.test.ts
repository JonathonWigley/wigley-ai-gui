import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type ChatAgentEvent,
  type ChatMainExports,
  chatMainKey,
  type SendGate,
} from '../../chat/contract';
import { type SessionFlow, workflowFlowsSlot } from '../../workflow/contract';
import { autoCompactMainPart } from './start';

const ASK = {
  sessionId: 's1',
  hostSessionId: 'h1',
  text: 'hello',
  now: 1_000_000,
};

const COLD_USAGE: ChatAgentEvent = {
  sessionId: 's1',
  profileDir: '~/.claude-work',
  hostSessionId: 'h1',
  replayed: false,
  event: {
    type: 'usage',
    agentId: MAIN_AGENT_ID,
    at: 900_000,
    contextTokens: 182_400,
    contextWindow: 1_000_000,
    autocompact: { configured: null, reported: null },
    cacheExpiresAt: 999_000,
    spendUsd: null,
  },
};

// A Medium session waiting on one subagent, its main turn over.
const WAITING_FLOW: SessionFlow = {
  sessionId: 's1',
  projectDir: '/repo',
  workflow: 'medium',
  movedUpFrom: null,
  stage: 'build',
  checklist: null,
  checklistReported: false,
  plan: null,
  counters: {},
  enteredFrom: null,
  countdownEndsAt: null,
  unclaimedWork: false,
  turnRunning: false,
  runningSubagents: ['agent-1'],
};

// The part on the harness, over a chat that records what is registered and
// files each handle with `consumer.track`, as chat's view does, and records each
// `compact` call, answering `compactAnswer`. `setting` is the object the part
// reads its settings from.
function startPart() {
  const setting = { minTokens: 150000, agentWaitMinTokens: 200000 };
  const gates = new Set<SendGate>();
  const readers = new Set<() => number | null>();
  const compacts: [string, string][] = [];
  const answers = { compact: true };
  const harness = startMainPart(autoCompactMainPart, {
    settings: setting,
    dependencies: [
      fakeDependency(
        chatMainKey,
        (consumer) =>
          ({
            addSendGate(gate: SendGate) {
              gates.add(gate);
              return consumer.track({ dispose: () => gates.delete(gate) });
            },
            addIdleCompactThreshold(read: () => number | null) {
              readers.add(read);
              return consumer.track({ dispose: () => readers.delete(read) });
            },
            compact(sessionId: string, reason: string) {
              compacts.push([sessionId, reason]);
              return answers.compact;
            },
          }) as unknown as ChatMainExports,
      ),
    ],
  });
  const flows = harness.state.publish(workflowFlowsSlot);
  return { setting, gates, readers, compacts, answers, flows, harness };
}

function usageOf(contextTokens: number): ChatAgentEvent {
  return {
    ...COLD_USAGE,
    event: { ...COLD_USAGE.event, contextTokens } as ChatAgentEvent['event'],
  };
}

describe('autoCompactMainPart', () => {
  it('autoCompactMainPart_RegistersGateAndReadsSettingPerAsk', () => {
    const part = startPart();
    part.harness.emit('chat.agentEvent', COLD_USAGE);

    const [gate] = part.gates;
    const [reader] = part.readers;
    expect(part.gates.size).toBe(1);
    expect(part.readers.size).toBe(1);
    expect(gate(ASK)).toEqual({
      action: 'compact',
      reason: 'auto · cache cold · 182k',
    });
    expect(reader()).toBe(150000);

    part.setting.minTokens = 0;
    expect(gate(ASK)).toBeNull();
    expect(reader()).toBeNull();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const part = startPart();
    expect(part.harness.counts().registrations).toBeGreaterThan(0);

    await part.harness.stop();

    expect(part.harness.counts()).toEqual(noCounts);
    expect(part.gates.size).toBe(0);
    expect(part.readers.size).toBe(0);
  });

  it('stopThenStart_StartsAgain', async () => {
    const part = startPart();
    const before = part.harness.counts();

    await part.harness.restart();

    expect(part.harness.counts()).toEqual(before);
    expect(part.gates.size).toBe(1);
    expect(part.readers.size).toBe(1);
  });

  it('agentWait_FlowWaitsAboveThreshold_CompactsOncePerWait', () => {
    const part = startPart();
    part.harness.emit('chat.agentEvent', usageOf(214_000));

    part.flows.set('s1', WAITING_FLOW);
    part.harness.emit('chat.turnFinished', { sessionId: 's1', how: 'idle' });

    expect(part.compacts).toEqual([['s1', 'auto · agents running · 214k']]);
  });

  it('agentWait_RefusedThenIdle_CompactsAtTheIdle', () => {
    const part = startPart();
    part.harness.emit('chat.agentEvent', usageOf(214_000));
    part.answers.compact = false;
    part.flows.set('s1', WAITING_FLOW);
    part.answers.compact = true;

    part.harness.emit('chat.turnFinished', { sessionId: 's1', how: 'idle' });
    part.harness.emit('chat.turnFinished', { sessionId: 's1', how: 'idle' });

    expect(part.compacts).toHaveLength(2);
  });

  it('agentWait_CompactionEndsThenMainTurn_RearmsForTheNextWait', () => {
    const part = startPart();
    part.harness.emit('chat.agentEvent', usageOf(214_000));
    part.flows.set('s1', WAITING_FLOW);
    const event = (data: ChatAgentEvent['event']) =>
      part.harness.emit('chat.agentEvent', { ...COLD_USAGE, event: data });

    event({ type: 'turnStarted', at: 1 });
    event({
      type: 'compactionEnded',
      at: 2,
      trigger: 'app',
      outcome: 'failed',
      beforeTokens: null,
      durationMs: null,
    });
    part.flows.set('s1', WAITING_FLOW);
    expect(part.compacts).toHaveLength(1);

    event({ type: 'turnStarted', at: 3 });
    part.flows.set('s1', { ...WAITING_FLOW, turnRunning: true });
    part.flows.set('s1', WAITING_FLOW);

    expect(part.compacts).toHaveLength(2);
  });

  it('agentWait_OldHostsEndAfterAClear_ReadsTheNewHostsUsage', () => {
    const part = startPart();
    part.harness.emit('chat.agentEvent', usageOf(214_000));
    part.harness.emit('chat.agentEvent', {
      ...COLD_USAGE,
      hostSessionId: 'h2',
      event: { type: 'turnEnded', at: 950_000 },
    });
    part.harness.emit('chat.agentEvent', {
      ...COLD_USAGE,
      event: { type: 'sessionEnded', at: 960_000 },
    });

    part.flows.set('s1', WAITING_FLOW);

    expect(part.compacts).toEqual([]);
  });

  it('agentWait_SettingZero_CompactsNothing', () => {
    const part = startPart();
    part.setting.agentWaitMinTokens = 0;
    part.harness.emit('chat.agentEvent', usageOf(214_000));

    part.flows.set('s1', WAITING_FLOW);

    expect(part.compacts).toEqual([]);
  });
});
