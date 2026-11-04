import { describe, expect, it, vi } from 'vitest';
import type {
  AgentHarness,
  PlanUsage,
  UsageAgentEvent,
} from '../../../contracts/agent';
import type { QualifiedEvents } from '../../../contracts/plugin';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type ChatMainEvents,
  type ChatMainExports,
  chatMainKey,
  type ChatProfile,
} from '../../chat/contract';
import {
  type SessionsMainEvents,
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import type { UsageSnapshot } from '../contract';
import type { UsageSelfTestDeps } from './selftest-script';
import { usageMainPart } from './start';
import { usageFixture } from './usage-fixture';

// The deps start last handed the self-test script.
const selfTest = vi.hoisted(() => ({
  deps: null as UsageSelfTestDeps | null,
}));

vi.mock('./selftest-script', async (importOriginal) => {
  const original = await importOriginal<typeof import('./selftest-script')>();
  return {
    ...original,
    usageSelfTestScript: (deps: UsageSelfTestDeps) => {
      selfTest.deps = deps;
      return original.usageSelfTestScript(deps);
    },
  };
});

const PERSONAL: ChatProfile = {
  name: 'personal',
  configDir: '~/.claude-personal',
};

const NOW = 5_000_000;
const SELECTED = 's-selected';

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

// The events usage's main part hears.
type UsageHeard = QualifiedEvents<'chat', ChatMainEvents> &
  QualifiedEvents<'sessions', SessionsMainEvents>;

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
// chat's one profile, `harnesses` and a drive host whose `run` runs an added
// action; `emit` calls the listeners of a qualified event, `sent` records
// every `changed`, `armed` every timer set and `pendingTimers` the ids set and
// not yet cleared. The clock reads `NOW` and sessions' selected session is
// `SELECTED`.
function startUsagePart(harnesses: Partial<AgentHarness>[]) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const sent: UsageSnapshot[] = [];
  const logs: string[] = [];
  const armed: number[] = [];
  const pendingTimers = new Set<number>();
  const drive = fakeDriveHost();
  const chat: Pick<ChatMainExports, 'profiles'> = {
    profiles: () => [PERSONAL],
  };
  const sessions: Pick<SessionsMainExports, 'selectedSessionId'> = {
    selectedSessionId: () => SELECTED,
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
      log: (line: string) => logs.push(line),
      clock: { now: () => NOW },
      timers: {
        set: (_run: () => void, ms: number) => {
          armed.push(ms);
          pendingTimers.add(armed.length);
          return armed.length;
        },
        clear: (id: number) => pendingTimers.delete(id),
      },
      agentHarnesses: harnesses,
      selfTest: { run: () => undefined },
    },
    drive: drive.host,
    dependency: (key: { id: string }) =>
      ({ chat, sessions })[key.id as 'chat' | 'sessions'] ?? {},
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof usageMainPart.start>[0];
  usageMainPart.start(api);
  const emit = <Name extends keyof UsageHeard & string>(
    event: Name,
    data: UsageHeard[Name],
  ) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(data);
    }
  };
  const snapshot = () => handlers.get('snapshot')?.() as UsageSnapshot;
  return { sent, logs, armed, pendingTimers, drive, emit, snapshot };
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
      hostSessionId: 'h1',
      event: usageEvent('main'),
    });
    usage.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      hostSessionId: 'h1',
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
      hostSessionId: 'h1',
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
      hostSessionId: 'h1',
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

  it('usageMainPart_Seed_StopsThePollerAndSendsTheFixture', async () => {
    const usage = startUsagePart([pollingHarness]);
    await settled();
    usage.sent.length = 0;

    await usage.drive.run('seed');

    expect(usage.sent).toEqual([usageFixture('fresh', NOW, SELECTED)]);
    expect([...usage.pendingTimers]).toEqual([]);
    await expect(usage.drive.run('pollNow')).rejects.toThrow(
      'usage.seed stopped the poller for this run',
    );
  });
});

// The deps the last start handed the script; throws when none was handed.
function scriptDeps(): UsageSelfTestDeps {
  if (selfTest.deps === null) {
    throw new Error('usage start handed the self-test no script');
  }
  return selfTest.deps;
}

// One heard event, emitted for session `sessionId`.
type Heard =
  | { kind: 'opened'; sessionId: string }
  | { kind: 'usage'; sessionId: string };

describe('sessionUsage', () => {
  it.each<{ case: string; before: Heard[]; after: Heard[]; resolved: boolean }>(
    [
      {
        case: 'EntryWithNullUsage_Waits',
        before: [{ kind: 'opened', sessionId: 's1' }],
        after: [],
        resolved: false,
      },
      {
        case: 'UsageEventAfterNullEntry_Resolves',
        before: [{ kind: 'opened', sessionId: 's1' }],
        after: [{ kind: 'usage', sessionId: 's1' }],
        resolved: true,
      },
      {
        case: 'EntryAlreadyHoldsUsage_ResolvesAtOnce',
        before: [{ kind: 'usage', sessionId: 's1' }],
        after: [],
        resolved: true,
      },
      {
        case: 'OtherSessionsUsage_Waits',
        before: [{ kind: 'opened', sessionId: 's1' }],
        after: [{ kind: 'usage', sessionId: 's2' }],
        resolved: false,
      },
    ],
  )('sessionUsage_$case', async ({ before, after, resolved }) => {
    const usage = startUsagePart([]);
    const hear = (heard: Heard) =>
      heard.kind === 'opened'
        ? usage.emit('chat.sessionOpened', {
            sessionId: heard.sessionId,
            profileDir: '~/.claude-personal',
          })
        : usage.emit('chat.agentEvent', {
            sessionId: heard.sessionId,
            profileDir: '~/.claude-personal',
            hostSessionId: 'h1',
            event: usageEvent('main'),
          });
    before.forEach(hear);
    let isResolved = false;

    void scriptDeps()
      .sessionUsage('s1')
      .then(() => {
        isResolved = true;
      });
    after.forEach(hear);
    await settled();

    expect(isResolved).toBe(resolved);
  });
});

// Usage's main part on the harness in a drive run, its one harness's `planUsage`
// answering with `read`.
function startOnHarness(read: () => Promise<PlanUsage>) {
  return startMainPart(usageMainPart, {
    drive: true,
    dependencies: [
      fakeDependency(
        chatMainKey,
        () => ({ profiles: () => [PERSONAL] }) as unknown as ChatMainExports,
      ),
      fakeDependency(
        sessionsMainKey,
        () =>
          ({
            selectedSessionId: () => SELECTED,
          }) as unknown as SessionsMainExports,
      ),
    ],
    services: {
      agentHarnesses: [
        { id: 'claude', planUsage: read } as unknown as AgentHarness,
      ],
    },
  });
}

describe('usageMainPart lifecycle', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness(() => Promise.resolve(POLLED));
    expect(harness.counts().registrations).toBeGreaterThan(0);
    expect(harness.counts().timers).toBe(1);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stop_PollInFlight_ReportsNothing', async () => {
    let answer: (usage: PlanUsage) => void = () => undefined;
    const harness = startOnHarness(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await settled();
    const sentBefore = harness.sent.length;

    await harness.stop();
    answer(POLLED);
    await settled();

    expect(harness.sent).toHaveLength(sentBefore);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness(() => Promise.resolve(POLLED));
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });
});
