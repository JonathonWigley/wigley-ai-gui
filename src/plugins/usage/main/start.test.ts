import { describe, expect, it, vi } from 'vitest';
import type {
  AgentHarness,
  HarnessProfile,
  PlanUsage,
  UsageAgentEvent,
} from '../../../contracts/agent';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type { QualifiedEvents } from '../../../contracts/plugin';
import {
  harnessInfo,
  harnessRegistryOf,
} from '../../../shared/agent-harness-registry.test-support';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import {
  createSlotStore,
  type SlotStore,
} from '../../../shared/state/slot-store';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type ChatMainEvents,
  type ChatMainExports,
  chatMainKey,
} from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsSelectionSlot,
} from '../../sessions/contract';
import { type UsageSnapshot, usageSnapshotSlot } from '../contract';
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

const PERSONAL: HarnessProfile = {
  name: 'personal',
  configDir: '~/.claude-personal',
};
const LAB: HarnessProfile = { name: 'lab', configDir: '/lab' };

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

// Usage's main part started over a fake `MainApi` whose `core.agentHarnesses`
// holds `PERSONAL` as the one profile of each of `harnesses` (a list without
// `claude` publishes none, so no poll runs), registered, a real store for its slots and a drive host
// whose `run` runs an added action; `emit` calls the listeners of a qualified
// event, `sent` records every write of the slot after the start, `snapshot` reads
// the slot, `armed` records every timer set and `pendingTimers` the ids set and
// not yet cleared. The clock reads `NOW` and sessions' selected session is
// `SELECTED`.
function startUsagePart(harnesses: Partial<AgentHarness>[]) {
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const sent: UsageSnapshot[] = [];
  const store = createSlotStore(() => undefined);
  const harnessEntries = store.publish(coreAgentHarnessesSlot);
  for (const { id } of harnesses) {
    if (id !== undefined) {
      harnessEntries.set(id, harnessInfo({ profiles: [PERSONAL] }));
    }
  }
  const reader = store.read(usageSnapshotSlot, 'test');
  const logs: string[] = [];
  const armed: number[] = [];
  const pendingTimers = new Set<number>();
  const drive = fakeDriveHost();
  const chat = {};
  const api = {
    events: {
      emit: () => undefined,
      on: (event: string, listener: (data: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    state: {
      publish: () => store.publish(usageSnapshotSlot),
      read: (key: { id: string }) =>
        key.id === coreAgentHarnessesSlot.id
          ? store.read(coreAgentHarnessesSlot, 'usage')
          : { get: () => SELECTED },
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
      agentHarnesses: harnessRegistryOf(harnesses as AgentHarness[]),
      selfTest: { run: () => undefined },
    },
    drive: drive.host,
    dependency: (key: { id: string }) => ({ chat })[key.id as 'chat'] ?? {},
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof usageMainPart.start>[0];
  usageMainPart.start(api);
  reader.on((snapshot) => {
    if (snapshot !== undefined) {
      sent.push(snapshot);
    }
  });
  const emit = <Name extends keyof UsageHeard & string>(
    event: Name,
    data: UsageHeard[Name],
  ) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(data);
    }
  };
  const snapshot = () => reader.get();
  return { sent, logs, armed, pendingTimers, drive, emit, snapshot };
}

const settled = () => new Promise((settle) => setImmediate(settle));

const pollingHarness: Partial<AgentHarness> = {
  id: 'claude',
  planUsage: () => Promise.resolve(POLLED),
};

describe('usageMainPart', () => {
  it('usageMainPart_EventsAndPolls_WriteSnapshots', async () => {
    const usage = startUsagePart([pollingHarness]);
    await settled();

    usage.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      hostSessionId: 'h1',
      event: usageEvent('main'),
      replayed: false,
    });
    usage.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      hostSessionId: 'h1',
      event: usageEvent('agent-7'),
      replayed: false,
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
      { plans: [polledPlan], sessions: [] },
      {
        plans: [polledPlan],
        sessions: [
          {
            sessionId: 's1',
            profileDir: '~/.claude-personal',
            usage: usageEvent('main'),
            compaction: null,
          },
        ],
      },
      { plans: [polledPlan], sessions: [] },
    ]);
    expect(usage.snapshot()).toBe(usage.sent.at(-1));
  });

  it('usageMainPart_SessionOpened_RecordsProfileBeforeTheFirstTurn', async () => {
    const usage = startUsagePart([pollingHarness]);
    await settled();
    usage.sent.length = 0;

    usage.emit('chat.sessionOpened', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      hostSessionId: 'h1',
      projectDir: '/p',
      profile: 'personal',
      origin: 'new',
    });
    expect(usage.sent.map((snapshot) => snapshot.sessions)).toEqual([
      [
        {
          sessionId: 's1',
          profileDir: '~/.claude-personal',
          usage: null,
          compaction: null,
        },
      ],
    ]);
    usage.emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      hostSessionId: 'h1',
      event: usageEvent('main'),
      replayed: false,
    });

    expect(usage.snapshot()?.sessions).toEqual([
      {
        sessionId: 's1',
        profileDir: '~/.claude-personal',
        usage: usageEvent('main'),
        compaction: null,
      },
    ]);
  });

  it('usageMainPart_CompactionEvents_FoldIntoTheSession', () => {
    const usage = startUsagePart([]);
    const heard = {
      sessionId: 's1',
      profileDir: '~/.claude-personal',
      hostSessionId: 'h1',
      replayed: false,
    };
    usage.emit('chat.agentEvent', { ...heard, event: usageEvent('main') });

    usage.emit('chat.agentEvent', {
      ...heard,
      event: { type: 'compactionStarted', at: 2_000, trigger: 'harness' },
    });
    expect(usage.sent.at(-1)?.sessions).toEqual([
      {
        sessionId: 's1',
        profileDir: '~/.claude-personal',
        usage: usageEvent('main'),
        compaction: { trigger: 'harness', startedAt: 2_000 },
      },
    ]);

    usage.emit('chat.agentEvent', {
      ...heard,
      event: {
        type: 'compactionEnded',
        at: 3_000,
        trigger: 'harness',
        outcome: 'done',
        beforeTokens: 42_000,
        durationMs: 1_000,
      },
    });
    expect(usage.sent.at(-1)?.sessions).toEqual([
      {
        sessionId: 's1',
        profileDir: '~/.claude-personal',
        usage: usageEvent('main'),
        compaction: null,
      },
    ]);
  });

  it('usageMainPart_NoHarness_NoPlansAndNoLog', async () => {
    const usage = startOverSlot(
      createSlotStore(() => undefined),
      [],
    );
    await settled();

    expect(usage.logs).toEqual([]);
    expect(planNames(usage)).toEqual([]);
  });

  it('usageMainPart_TwoHarnesses_PollsEachProfileThroughItsHarness', async () => {
    const state = createSlotStore(() => undefined);
    const harnesses = state.publish(coreAgentHarnessesSlot);
    harnesses.set('claude', harnessInfo({ profiles: [PERSONAL] }));
    harnesses.set('lab', harnessInfo({ profiles: [LAB] }));
    const heard: Record<string, (string | null)[]> = { claude: [], lab: [] };
    const recording = (id: string): Partial<AgentHarness> => ({
      id,
      planUsage: (profileDir) => {
        heard[id].push(profileDir);
        return Promise.resolve(POLLED);
      },
    });

    const usage = startOverSlot(state, [recording('claude'), recording('lab')]);
    await settled();

    expect(heard).toEqual({ claude: ['~/.claude-personal'], lab: ['/lab'] });
    expect(planNames(usage)).toEqual([
      { name: 'personal', isDefault: true },
      { name: 'lab', isDefault: false },
    ]);
  });

  it('usageMainPart_HarnessRegistersAfterStart_PollsItsProfiles', async () => {
    const state = createSlotStore(() => undefined);
    const harnesses = state.publish(coreAgentHarnessesSlot);
    const heard: (string | null)[] = [];
    startOverSlot(state, [
      {
        id: 'claude',
        planUsage: (profileDir) => {
          heard.push(profileDir);
          return Promise.resolve(POLLED);
        },
      },
    ]);

    harnesses.set('claude', harnessInfo({ profiles: [PERSONAL] }));
    await settled();

    expect(heard).toEqual(['~/.claude-personal']);
  });

  it('usageMainPart_HarnessSlotChange_PollsOnlyWhenProfilesDiffer', async () => {
    const state = createSlotStore(() => undefined);
    const harnesses = state.publish(coreAgentHarnessesSlot);
    harnesses.set('claude', harnessInfo({ profiles: [PERSONAL] }));
    const heard: (string | null)[] = [];
    startOverSlot(state, [
      {
        id: 'claude',
        planUsage: (profileDir) => {
          heard.push(profileDir);
          return Promise.resolve(POLLED);
        },
      },
    ]);
    await settled();
    heard.length = 0;

    harnesses.set('claude', harnessInfo({ profiles: [{ ...PERSONAL }] }));
    await settled();
    expect(heard).toEqual([]);

    harnesses.set('claude', harnessInfo({ profiles: [PERSONAL, LAB] }));
    await settled();
    expect(heard).toEqual(['~/.claude-personal', '/lab']);
  });

  it('usageMainPart_Seed_StopsThePollerAndWritesTheFixture', async () => {
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

  it('heldOnlyChange_WritesNothing', () => {
    const usage = startUsagePart([]);
    const before = usage.snapshot();
    usage.sent.length = 0;

    usage.emit('chat.planUsage', {
      profileDir: '~/.claude-personal',
      update: { rows: POLLED.rows, at: 2_000 },
    });

    expect(usage.sent).toEqual([]);
    expect(usage.snapshot()).toBe(before);
  });

  it('seed_ThenSnapshot_ReadsTheSeed', async () => {
    const usage = startUsagePart([]);

    await usage.drive.run('seed');

    expect(scriptDeps().snapshot()).toBe(usage.snapshot());
    expect(usage.snapshot()).toEqual(usageFixture('fresh', NOW, SELECTED));
  });

  it('start_WritesTheEmptySnapshot', () => {
    const harness = startMainPart(usageMainPart, {
      dependencies: [
        fakeDependency(chatMainKey, () => ({}) as unknown as ChatMainExports),
      ],
    });

    expect(harness.state.read(usageSnapshotSlot, 'test').get()).toEqual({
      plans: [],
      sessions: [],
    });
  });
});

// Usage's main part started over `state`, whose `core.agentHarnesses` the test
// seeds, with `harnesses` registered.
function startOverSlot(state: SlotStore, harnesses: Partial<AgentHarness>[]) {
  return startMainPart(usageMainPart, {
    state,
    dependencies: [
      fakeDependency(chatMainKey, () => ({}) as unknown as ChatMainExports),
    ],
    services: {
      agentHarnesses: harnessRegistryOf(harnesses as AgentHarness[]),
    },
  });
}

// The name and default flag of each plan in the snapshot `usage` wrote.
function planNames(usage: ReturnType<typeof startOverSlot>) {
  return (
    usage.state
      .read(usageSnapshotSlot, 'test')
      .get()
      ?.plans.map(({ name, isDefault }) => ({ name, isDefault })) ?? []
  );
}

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
            hostSessionId: 'h1',
            projectDir: '/p',
            profile: 'personal',
            origin: 'new',
          })
        : usage.emit('chat.agentEvent', {
            sessionId: heard.sessionId,
            profileDir: '~/.claude-personal',
            hostSessionId: 'h1',
            event: usageEvent('main'),
            replayed: false,
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
  const state = createSlotStore(() => undefined);
  state
    .publish(coreAgentHarnessesSlot)
    .set('claude', harnessInfo({ profiles: [PERSONAL] }));
  const harness = startMainPart(usageMainPart, {
    drive: true,
    state,
    dependencies: [
      fakeDependency(chatMainKey, () => ({}) as unknown as ChatMainExports),
    ],
    services: {
      agentHarnesses: harnessRegistryOf([
        { id: 'claude', planUsage: read } as unknown as AgentHarness,
      ]),
    },
  });
  harness.state.publish(sessionsSelectionSlot).set(SELECTED);
  return harness;
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
    const slot = harness.state.read(usageSnapshotSlot, 'test');
    const atStop = slot.get();

    await harness.stop();
    answer(POLLED);
    await settled();

    expect(slot.get()).toBe(atStop);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness(() => Promise.resolve(POLLED));
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });
});
