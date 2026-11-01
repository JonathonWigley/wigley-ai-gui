import { describe, expect, it } from 'vitest';
import type {
  AgentHarness,
  PlanUsage,
  UsageAgentEvent,
} from '../../../contracts/agent';
import type { ChatMainExports, ChatProfile } from '../../chat/contract';
import type { UsageSnapshot } from '../contract';
import { usageMainPart } from './start';

const PERSONAL: ChatProfile = {
  name: 'personal',
  configDir: '~/.claude-personal',
};

const POLLED: PlanUsage = {
  rows: [
    {
      kind: 'session',
      group: 'session',
      label: '5h',
      percent: 35,
      resetsAt: 7_200_000,
      severity: 'normal',
      isActive: false,
    },
  ],
  extraUsage: null,
  at: 1_000,
};

function usageEvent(agentId: string): UsageAgentEvent {
  return {
    type: 'usage',
    agentId,
    at: 2_000,
    contextTokens: 42_000,
    contextWindow: 1_000_000,
    autocompact: { configured: 300_000, reported: 967_000 },
    cacheExpiresAt: 3_602_000,
    spendUsd: 0.25,
  };
}

// Usage's main part started over a fake `MainApi` holding `PERSONAL` as
// chat's one profile and `harnesses`; `emit` calls the listeners of a
// qualified event, `sent` records every `changed`, `armed` every timer set.
function startUsagePart(harnesses: Partial<AgentHarness>[]) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const sent: UsageSnapshot[] = [];
  const logs: string[] = [];
  const armed: number[] = [];
  const chat: Pick<ChatMainExports, 'profiles'> = {
    profiles: () => [PERSONAL],
  };
  const api = {
    channel: {
      handle: (name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
      send: (name: string, data: UsageSnapshot) => {
        if (name === 'changed') {
          sent.push(data);
        }
      },
    },
    events: {
      emit: () => undefined,
      on: (event: string, listener: (data: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    settings: () => ({ pollIntervalSeconds: 300, layout: 'default' }),
    onSettingsChanged: () => ({ dispose: () => undefined }),
    services: {
      log: (_plugin: string, line: string) => logs.push(line),
      clock: { now: () => 0 },
      timers: {
        set: (_run: () => void, ms: number) => armed.push(ms),
        clear: () => undefined,
      },
      agentHarnesses: harnesses,
    },
    dependency: (pluginId: string) => (pluginId === 'chat' ? chat : {}),
  } as unknown as Parameters<typeof usageMainPart.start>[0];
  usageMainPart.start(api);
  const emit = (event: string, data: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(data);
    }
  };
  const snapshot = () => handlers.get('snapshot')?.() as UsageSnapshot;
  return { sent, logs, armed, emit, snapshot };
}

const settled = () => new Promise((settle) => setImmediate(settle));

const pollingHarness: Partial<AgentHarness> = {
  id: 'claude',
  planUsage: () => Promise.resolve(POLLED),
};

describe('usageMainPart', () => {
  it('usageMainPart_EventsAndPolls_SendSnapshots', async () => {
    const usage = startUsagePart([pollingHarness]);
    await settled();

    usage.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      event: usageEvent('main'),
    });
    usage.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      event: usageEvent('agent-7'),
    });
    usage.emit('sessions.ended', { sessionId: 's1' });

    const seededPlan = {
      name: 'personal',
      profileDir: '~/.claude-personal',
      isDefault: true,
      usage: null,
      lastGoodAt: null,
      error: null,
      stale: false,
    };
    const polledPlan = { ...seededPlan, usage: POLLED, lastGoodAt: 1_000 };
    expect(usage.sent).toEqual([
      { plans: [seededPlan], sessions: [] },
      { plans: [polledPlan], sessions: [] },
      {
        plans: [polledPlan],
        sessions: [
          {
            sessionId: 's1',
            profileDir: '~/.claude-personal',
            usage: usageEvent('main'),
          },
        ],
      },
      { plans: [polledPlan], sessions: [] },
    ]);
    expect(usage.snapshot()).toBe(usage.sent[3]);
  });

  it('usageMainPart_SessionOpened_RecordsProfileBeforeTheFirstTurn', async () => {
    const usage = startUsagePart([pollingHarness]);
    await settled();
    usage.sent.length = 0;

    usage.emit('chat.sessionOpened', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
    });
    expect(usage.sent.map((snapshot) => snapshot.sessions)).toEqual([
      [{ sessionId: 's1', profileDir: '~/.claude-personal', usage: null }],
    ]);
    usage.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      event: usageEvent('main'),
    });

    expect(usage.snapshot().sessions).toEqual([
      {
        sessionId: 's1',
        profileDir: '~/.claude-personal',
        usage: usageEvent('main'),
      },
    ]);
  });

  it('usageMainPart_NoHarness_SeedsPlansWithoutPolling', () => {
    const usage = startUsagePart([]);

    usage.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      event: usageEvent('main'),
    });

    expect(usage.logs).toEqual([
      'no agent harness "claude": plan usage is not read',
    ]);
    expect(usage.armed).toEqual([]);
    expect(usage.snapshot()).toEqual({
      plans: [
        {
          name: 'personal',
          profileDir: '~/.claude-personal',
          isDefault: true,
          usage: null,
          lastGoodAt: null,
          error: null,
          stale: false,
        },
      ],
      sessions: [
        {
          sessionId: 's1',
          profileDir: '~/.claude-personal',
          usage: usageEvent('main'),
        },
      ],
    });
  });
});
