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

// The part on the harness, over a chat that records what is registered and
// files each handle with `consumer.track`, as chat's view does. `setting` is the
// object the part reads its settings from.
function startPart() {
  const setting = { minTokens: 150000 };
  const gates = new Set<SendGate>();
  const readers = new Set<() => number | null>();
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
          }) as unknown as ChatMainExports,
      ),
    ],
  });
  return { setting, gates, readers, harness };
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
});
