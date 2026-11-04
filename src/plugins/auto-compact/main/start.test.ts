import { describe, expect, it, vi } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type {
  ChatAgentEvent,
  ChatMainExports,
  SendGate,
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

// The part started over a fake `MainApi` whose chat records what is registered.
function startPart() {
  const setting = { minTokens: 150000 };
  const listeners: ((data: ChatAgentEvent) => void)[] = [];
  const gates: SendGate[] = [];
  const readers: (() => number | null)[] = [];
  const removeGate = vi.fn();
  const removeReader = vi.fn();
  const chat: Pick<ChatMainExports, 'addSendGate' | 'addIdleCompactThreshold'> =
    {
      addSendGate: (gate) => {
        gates.push(gate);
        return removeGate;
      },
      addIdleCompactThreshold: (read) => {
        readers.push(read);
        return removeReader;
      },
    };
  const api = {
    settings: () => setting,
    events: {
      on: (name: string, listener: (data: ChatAgentEvent) => void) => {
        if (name === 'chat.agentEvent') {
          listeners.push(listener);
        }
        return { dispose: () => undefined };
      },
    },
    dependency: () => chat,
  } as unknown as Parameters<typeof autoCompactMainPart.start>[0];
  const started = autoCompactMainPart.start(api);
  if (started instanceof Promise) {
    throw new Error('auto-compact main part started asynchronously');
  }
  return {
    setting,
    gates,
    readers,
    removeGate,
    removeReader,
    started,
    emit: (data: ChatAgentEvent) => {
      for (const listener of listeners) {
        listener(data);
      }
    },
  };
}

describe('autoCompactMainPart', () => {
  it('autoCompactMainPart_RegistersGateReadsSettingPerAskAndRemovesOnDispose', () => {
    const part = startPart();
    part.emit(COLD_USAGE);

    expect(part.gates).toHaveLength(1);
    expect(part.readers).toHaveLength(1);
    expect(part.gates[0](ASK)).toEqual({
      action: 'compact',
      reason: 'auto · cache cold · 182k',
    });
    expect(part.readers[0]()).toBe(150000);

    part.setting.minTokens = 0;
    expect(part.gates[0](ASK)).toBeNull();
    expect(part.readers[0]()).toBeNull();

    void part.started.dispose?.();
    expect(part.removeGate).toHaveBeenCalledOnce();
    expect(part.removeReader).toHaveBeenCalledOnce();
  });
});
