import { describe, expect, it } from 'vitest';
import type {
  PlanRow,
  PlanRowPatch,
  PlanUsage,
  UsageAgentEvent,
} from '../../../contracts/agent';
import type { ChatProfile } from '../../chat/contract';
import type { ProfilePlan, SessionUsage } from '../contract';
import {
  EMPTY_USAGE_STATE,
  type HeldPatch,
  type PollResult,
  type UsageState,
  withLiveRows,
  withoutSession,
  withPollResult,
  withProfiles,
  withSessionUsage,
} from './usage-store';

const PERSONAL: ChatProfile = {
  name: 'personal',
  configDir: '~/.claude-personal',
};
const WORK: ChatProfile = { name: 'work', configDir: '~/.claude-work' };

function row(kind: string, percent: number, label = kind): PlanRow {
  return {
    kind,
    group: `${kind}-group`,
    label,
    percent,
    resetsAt: 9_000,
    severity: 'normal',
    isActive: kind === 'weekly_all',
  };
}

function patch(kind: string, percent: number): PlanRowPatch {
  return { kind, percent, resetsAt: 8_000, severity: 'warning' };
}

function usage(at: number, rows: readonly PlanRow[]): PlanUsage {
  return { rows, extraUsage: null, at };
}

function ok(planUsage: PlanUsage): PollResult {
  return { ok: true, usage: planUsage };
}

function failed(error: string): PollResult {
  return { ok: false, error };
}

function seeded(): UsageState {
  return withProfiles(EMPTY_USAGE_STATE, [PERSONAL, WORK]);
}

function planOf(state: UsageState, profile: ChatProfile): ProfilePlan {
  const plan = state.snapshot.plans.find(
    (held) => held.profileDir === profile.configDir,
  );
  if (plan === undefined) {
    throw new Error(`no plan for ${profile.configDir}`);
  }
  return plan;
}

function usageEvent(contextTokens: number): UsageAgentEvent {
  return {
    type: 'usage',
    agentId: 'main',
    at: 500,
    contextTokens,
    contextWindow: 1_000_000,
    autocompact: { configured: 300_000, reported: 967_000 },
    cacheExpiresAt: 3_600_500,
    spendUsd: 0.5,
  };
}

const POLL_1000 = usage(1_000, [row('session', 35), row('weekly_all', 61)]);
const POLL_2000 = usage(2_000, [row('session', 12), row('weekly_all', 64)]);

describe('withPollResult', () => {
  const personalOnly = [{ name: 'personal', isDefault: true }];

  it.each<{
    case: string;
    profiles?: ChatProfile[];
    results: PollResult[];
    onDir?: Pick<ProfilePlan, 'name' | 'isDefault'>[];
    expected: Partial<ProfilePlan>;
  }>([
    {
      case: 'SuccessOnNewPlan',
      results: [ok(POLL_1000)],
      expected: {
        usage: POLL_1000,
        lastGoodAt: 1_000,
        error: null,
        stale: false,
      },
    },
    {
      case: 'FailureAfterSuccess',
      results: [ok(POLL_1000), failed('exit 1')],
      expected: {
        usage: POLL_1000,
        lastGoodAt: 1_000,
        error: 'exit 1',
        stale: true,
      },
    },
    {
      case: 'FailureBeforeAnySuccess',
      results: [failed('exit 1')],
      expected: { usage: null, lastGoodAt: null, error: 'exit 1', stale: true },
    },
    {
      case: 'SuccessAfterFailure',
      results: [ok(POLL_1000), failed('exit 1'), ok(POLL_2000)],
      expected: {
        usage: POLL_2000,
        lastGoodAt: 2_000,
        error: null,
        stale: false,
      },
    },
    {
      case: 'TwoProfilesOnOneDirShareUsageKeepingTheirNames',
      profiles: [
        PERSONAL,
        { name: 'home', configDir: PERSONAL.configDir },
        WORK,
      ],
      results: [ok(POLL_1000), failed('exit 1')],
      onDir: [
        { name: 'personal', isDefault: true },
        { name: 'home', isDefault: false },
      ],
      expected: {
        usage: POLL_1000,
        lastGoodAt: 1_000,
        error: 'exit 1',
        stale: true,
      },
    },
  ])(
    'withPollResult_$case',
    ({
      profiles = [PERSONAL, WORK],
      results,
      onDir = personalOnly,
      expected,
    }) => {
      const state = results.reduce(
        (current, result) =>
          withPollResult(current, PERSONAL.configDir, result),
        withProfiles(EMPTY_USAGE_STATE, profiles),
      );

      expect(
        state.snapshot.plans.filter(
          (plan) => plan.profileDir === PERSONAL.configDir,
        ),
      ).toEqual(
        onDir.map((named) => ({
          ...named,
          profileDir: '~/.claude-personal',
          ...expected,
        })),
      );
    },
  );

  it('withPollResult_UnknownProfileDir_ReturnsSameState', () => {
    const state = seeded();

    expect(withPollResult(state, '~/.claude-gone', ok(POLL_1000))).toBe(state);
  });
});

describe('withPollResult held patches', () => {
  // A poll at 1000 with no `session` row, then live rows at 2000: the
  // `weekly_all` row folds and the `session` row is held.
  function heldSession(): UsageState {
    const polled = withPollResult(
      seeded(),
      PERSONAL.configDir,
      ok(usage(1_000, [row('weekly_all', 61)])),
    );
    return withLiveRows(polled, PERSONAL.configDir, {
      rows: [patch('session', 40), patch('weekly_all', 70)],
      at: 2_000,
    });
  }

  it.each<{
    case: string;
    given: () => UsageState;
    poll: PlanUsage;
    expectedSession: number | null;
    expectedHeld: HeldPatch[];
  }>([
    {
      case: 'LaterHeldPatchFolds',
      given: heldSession,
      poll: usage(1_500, [row('session', 35), row('weekly_all', 61)]),
      expectedSession: 40,
      expectedHeld: [],
    },
    {
      case: 'EqualAtHeldPatchDropped',
      given: heldSession,
      poll: usage(2_000, [row('session', 35), row('weekly_all', 61)]),
      expectedSession: 35,
      expectedHeld: [],
    },
    {
      case: 'EarlierHeldPatchDropped',
      given: heldSession,
      poll: usage(2_500, [row('session', 35), row('weekly_all', 61)]),
      expectedSession: 35,
      expectedHeld: [],
    },
    {
      case: 'KindStillLackingStaysHeld',
      given: heldSession,
      poll: usage(2_500, [row('weekly_all', 61)]),
      expectedSession: null,
      expectedHeld: [
        {
          profileDir: '~/.claude-personal',
          patch: patch('session', 40),
          at: 2_000,
        },
      ],
    },
    {
      case: 'FoldedLivePatchRefoldsOverAPollStartedBeforeIt',
      given: () =>
        withLiveRows(
          withPollResult(seeded(), PERSONAL.configDir, ok(POLL_1000)),
          PERSONAL.configDir,
          { rows: [patch('session', 40)], at: 2_000 },
        ),
      poll: usage(1_500, [row('session', 30), row('weekly_all', 61)]),
      expectedSession: 40,
      expectedHeld: [],
    },
    {
      case: 'OtherProfilesPatchUntouched',
      given: () =>
        withLiveRows(seeded(), WORK.configDir, {
          rows: [patch('session', 40)],
          at: 2_000,
        }),
      poll: usage(1_500, [row('session', 35), row('weekly_all', 61)]),
      expectedSession: 35,
      expectedHeld: [
        {
          profileDir: '~/.claude-work',
          patch: patch('session', 40),
          at: 2_000,
        },
      ],
    },
  ])(
    'withPollResult_HeldPatches_$case',
    ({ given, poll, expectedSession, expectedHeld }) => {
      const state = withPollResult(given(), PERSONAL.configDir, ok(poll));

      const sessionRow = planOf(state, PERSONAL).usage?.rows.find(
        (held) => held.kind === 'session',
      );
      expect(sessionRow?.percent ?? null).toBe(expectedSession);
      expect(state.held).toEqual(expectedHeld);
    },
  );
});

describe('withLiveRows', () => {
  function polled(rows: readonly PlanRow[]): UsageState {
    return withPollResult(seeded(), PERSONAL.configDir, ok(usage(1_000, rows)));
  }

  it.each<{
    case: string;
    given: () => UsageState;
    patches: PlanRowPatch[];
    expectedUsage: PlanUsage | null;
    expectedHeld: HeldPatch[];
    snapshotKept: boolean;
  }>([
    {
      case: 'ReportedKindPatchedAndHeldWithItsAt',
      given: () => polled([row('session', 35), row('weekly_all', 61)]),
      patches: [patch('weekly_all', 70)],
      expectedUsage: usage(1_000, [
        row('session', 35),
        {
          kind: 'weekly_all',
          group: 'weekly_all-group',
          label: 'weekly_all',
          percent: 70,
          resetsAt: 8_000,
          severity: 'warning',
          isActive: true,
        },
      ]),
      expectedHeld: [
        {
          profileDir: '~/.claude-personal',
          patch: patch('weekly_all', 70),
          at: 2_000,
        },
      ],
      snapshotKept: false,
    },
    {
      case: 'TwoRowsOfOneKindBothPatched',
      given: () =>
        polled([
          row('weekly_scoped', 10, 'Fable'),
          row('weekly_scoped', 20, 'Sonnet'),
        ]),
      patches: [patch('weekly_scoped', 30)],
      expectedUsage: usage(1_000, [
        {
          ...row('weekly_scoped', 30, 'Fable'),
          resetsAt: 8_000,
          severity: 'warning',
        },
        {
          ...row('weekly_scoped', 30, 'Sonnet'),
          resetsAt: 8_000,
          severity: 'warning',
        },
      ]),
      expectedHeld: [
        {
          profileDir: '~/.claude-personal',
          patch: patch('weekly_scoped', 30),
          at: 2_000,
        },
      ],
      snapshotKept: false,
    },
    {
      case: 'LackingKindHeldAndSnapshotKept',
      given: () => polled([row('weekly_all', 61)]),
      patches: [patch('session', 40)],
      expectedUsage: usage(1_000, [row('weekly_all', 61)]),
      expectedHeld: [
        {
          profileDir: '~/.claude-personal',
          patch: patch('session', 40),
          at: 2_000,
        },
      ],
      snapshotKept: true,
    },
    {
      case: 'EveryPatchHeldWhileUsageNull',
      given: seeded,
      patches: [patch('session', 40), patch('weekly_all', 70)],
      expectedUsage: null,
      expectedHeld: [
        {
          profileDir: '~/.claude-personal',
          patch: patch('session', 40),
          at: 2_000,
        },
        {
          profileDir: '~/.claude-personal',
          patch: patch('weekly_all', 70),
          at: 2_000,
        },
      ],
      snapshotKept: true,
    },
    {
      case: 'SecondHeldPatchOfAKindReplacesTheFirst',
      given: () =>
        withLiveRows(seeded(), PERSONAL.configDir, {
          rows: [patch('session', 20)],
          at: 1_500,
        }),
      patches: [patch('session', 40)],
      expectedUsage: null,
      expectedHeld: [
        {
          profileDir: '~/.claude-personal',
          patch: patch('session', 40),
          at: 2_000,
        },
      ],
      snapshotKept: true,
    },
  ])(
    'withLiveRows_$case',
    ({ given, patches, expectedUsage, expectedHeld, snapshotKept }) => {
      const before = given();

      const after = withLiveRows(before, PERSONAL.configDir, {
        rows: patches,
        at: 2_000,
      });

      expect(planOf(after, PERSONAL).usage).toEqual(expectedUsage);
      expect(after.held).toEqual(expectedHeld);
      expect(after.snapshot === before.snapshot).toBe(snapshotKept);
    },
  );

  it('withLiveRows_UnknownProfile_ReturnsSameState', () => {
    const state = seeded();

    expect(
      withLiveRows(state, '~/.claude-gone', {
        rows: [patch('session', 40)],
        at: 2_000,
      }),
    ).toBe(state);
  });
});

describe('withProfiles', () => {
  // `personal` polled at 1000, `work` holding a `session` patch.
  function given(): UsageState {
    const polled = withPollResult(seeded(), PERSONAL.configDir, ok(POLL_1000));
    return withLiveRows(polled, WORK.configDir, {
      rows: [patch('session', 40)],
      at: 2_000,
    });
  }

  const personalPlan = (isDefault: boolean, name = 'personal') => ({
    name,
    profileDir: '~/.claude-personal',
    isDefault,
    usage: POLL_1000,
    lastGoodAt: 1_000,
    error: null,
    stale: false,
  });
  const emptyPlan = (name: string, profileDir: string, isDefault: boolean) => ({
    name,
    profileDir,
    isDefault,
    usage: null,
    lastGoodAt: null,
    error: null,
    stale: false,
  });
  const workHeld: HeldPatch = {
    profileDir: '~/.claude-work',
    patch: patch('session', 40),
    at: 2_000,
  };

  it.each<{
    case: string;
    profiles: ChatProfile[];
    expectedPlans: ProfilePlan[];
    expectedHeld: HeldPatch[];
  }>([
    {
      case: 'NewProfileAppendedWithNullUsage',
      profiles: [
        PERSONAL,
        WORK,
        { name: 'spare', configDir: '~/.claude-spare' },
      ],
      expectedPlans: [
        personalPlan(true),
        emptyPlan('work', '~/.claude-work', false),
        emptyPlan('spare', '~/.claude-spare', false),
      ],
      expectedHeld: [workHeld],
    },
    {
      case: 'RemovedProfileDroppedWithItsHeldPatches',
      profiles: [PERSONAL],
      expectedPlans: [personalPlan(true)],
      expectedHeld: [],
    },
    {
      case: 'ReorderedProfilesKeepStateAndMoveTheDefault',
      profiles: [WORK, PERSONAL],
      expectedPlans: [
        emptyPlan('work', '~/.claude-work', true),
        personalPlan(false),
      ],
      expectedHeld: [workHeld],
    },
    {
      case: 'RenamedProfileKeepsItsState',
      profiles: [{ name: 'home', configDir: '~/.claude-personal' }, WORK],
      expectedPlans: [
        personalPlan(true, 'home'),
        emptyPlan('work', '~/.claude-work', false),
      ],
      expectedHeld: [workHeld],
    },
  ])('withProfiles_$case', ({ profiles, expectedPlans, expectedHeld }) => {
    const state = withProfiles(given(), profiles);

    expect(state.snapshot.plans).toEqual(expectedPlans);
    expect(state.held).toEqual(expectedHeld);
  });

  it('withProfiles_SameNamesDirsAndOrder_ReturnsSameState', () => {
    const state = given();

    expect(
      withProfiles(state, [
        { name: 'personal', configDir: '~/.claude-personal' },
        { name: 'work', configDir: '~/.claude-work' },
      ]),
    ).toBe(state);
  });
});

describe('session usage', () => {
  const FIRST = usageEvent(42_000);
  const SECOND = usageEvent(84_000);
  type Step = (state: UsageState) => UsageState;
  const event =
    (sessionId: string, profileDir: string, event: UsageAgentEvent): Step =>
    (state) =>
      withSessionUsage(state, sessionId, profileDir, event);
  const opened =
    (sessionId: string, profileDir: string): Step =>
    (state) =>
      withSessionUsage(state, sessionId, profileDir, null);
  const ended =
    (sessionId: string): Step =>
    (state) =>
      withoutSession(state, sessionId);

  it.each<{ case: string; steps: Step[]; expected: SessionUsage[] }>([
    {
      case: 'NewSessionAppended',
      steps: [
        event('s1', '~/.claude-work', FIRST),
        event('s2', '~/.claude-personal', SECOND),
      ],
      expected: [
        { sessionId: 's1', profileDir: '~/.claude-work', usage: FIRST },
        { sessionId: 's2', profileDir: '~/.claude-personal', usage: SECOND },
      ],
    },
    {
      case: 'OpenThenEventFillsUsageInPlace',
      steps: [
        opened('s1', '~/.claude-personal'),
        opened('s2', '~/.claude-work'),
        event('s1', '~/.claude-personal', FIRST),
      ],
      expected: [
        { sessionId: 's1', profileDir: '~/.claude-personal', usage: FIRST },
        { sessionId: 's2', profileDir: '~/.claude-work', usage: null },
      ],
    },
    {
      case: 'EventForAnUnopenedIdAppends',
      steps: [
        opened('s1', '~/.claude-personal'),
        event('s2', '~/.claude-work', FIRST),
      ],
      expected: [
        { sessionId: 's1', profileDir: '~/.claude-personal', usage: null },
        { sessionId: 's2', profileDir: '~/.claude-work', usage: FIRST },
      ],
    },
    {
      case: 'KnownSessionReplacedInPlace',
      steps: [
        event('s1', '~/.claude-work', FIRST),
        event('s2', '~/.claude-personal', FIRST),
        event('s1', '~/.claude-work', SECOND),
      ],
      expected: [
        { sessionId: 's1', profileDir: '~/.claude-work', usage: SECOND },
        { sessionId: 's2', profileDir: '~/.claude-personal', usage: FIRST },
      ],
    },
    {
      case: 'OpenAfterEventKeepsUsageAndTakesTheProfile',
      steps: [
        event('s1', '~/.claude-work', FIRST),
        opened('s1', '~/.claude-personal'),
      ],
      expected: [
        { sessionId: 's1', profileDir: '~/.claude-personal', usage: FIRST },
      ],
    },
    {
      case: 'WithoutSessionRemovesIt',
      steps: [
        event('s1', '~/.claude-work', FIRST),
        event('s2', '~/.claude-personal', SECOND),
        ended('s1'),
      ],
      expected: [
        { sessionId: 's2', profileDir: '~/.claude-personal', usage: SECOND },
      ],
    },
  ])('sessionUsage_$case', ({ steps, expected }) => {
    const state = steps.reduce(
      (current, step) => step(current),
      EMPTY_USAGE_STATE,
    );

    expect(state.snapshot.sessions).toEqual(expected);
  });

  it('sessionUsage_UnknownIdEnded_ReturnsSameState', () => {
    const state = event('s1', '~/.claude-work', FIRST)(EMPTY_USAGE_STATE);

    expect(withoutSession(state, 's9')).toBe(state);
  });
});
