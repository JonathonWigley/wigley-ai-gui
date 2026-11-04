import { describe, expect, it } from 'vitest';
import type {
  ExtraUsage,
  PlanRow,
  UsageAgentEvent,
} from '../../../contracts/agent';
import type { ProfilePlan, SessionUsage, UsageSnapshot } from '../contract';
import type {
  DetailsInput,
  DetailsProfileInput,
  MeterInput,
  SessionLineInput,
  StatusLineInput,
} from '../layouts/layout';
import {
  contextLineInput,
  contextLineText,
  detailsInput,
  detailsStatesText,
  rowCacheInput,
  rowLineInput,
  sessionLineInput,
  sessionLineText,
  spendLineInput,
  spendLineText,
  statusLineInput,
  statusLineText,
} from './usage-view-model';

const NOW = 50_000_000;
const MINUTE = 60_000;
const WORK_DIR = '~/.claude';
const PERSONAL_DIR = '~/.claude-personal';

function planRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    kind: 'session',
    group: 'session',
    label: '5h',
    percent: 42,
    resetsAt: null,
    severity: 'normal',
    isActive: true,
    ...overrides,
  };
}

function plan(overrides: Partial<ProfilePlan> = {}): ProfilePlan {
  return {
    name: 'work',
    profileDir: WORK_DIR,
    isDefault: true,
    usage: { rows: [planRow()], extraUsage: null, at: NOW - 3 * MINUTE },
    lastGoodAt: NOW - 3 * MINUTE,
    error: null,
    stale: false,
    ...overrides,
  };
}

function usageEvent(overrides: Partial<UsageAgentEvent> = {}): UsageAgentEvent {
  return {
    type: 'usage',
    agentId: 'main',
    at: NOW,
    contextTokens: 180_000,
    contextWindow: 1_000_000,
    autocompact: { configured: 300_000, reported: 967_000 },
    cacheExpiresAt: null,
    spendUsd: null,
    ...overrides,
  };
}

function session(
  sessionId: string,
  profileDir: string | null,
  usage: UsageAgentEvent | null,
  compaction: SessionUsage['compaction'] = null,
): SessionUsage {
  return { sessionId, profileDir, usage, compaction };
}

// `work` (the default) and `personal`, each with one row of its own, and the
// sessions given.
function twoProfiles(sessions: readonly SessionUsage[]): UsageSnapshot {
  return {
    plans: [
      plan(),
      plan({
        name: 'personal',
        profileDir: PERSONAL_DIR,
        isDefault: false,
        usage: {
          rows: [planRow({ kind: 'weekly_all', label: 'Week', percent: 61 })],
          extraUsage: null,
          at: NOW,
        },
      }),
    ],
    sessions,
  };
}

// One session `s1` with `usage` on the work profile.
function withSession(usage: UsageAgentEvent): UsageSnapshot {
  return { plans: [plan()], sessions: [session('s1', WORK_DIR, usage)] };
}

// `s1` with usage, `s2` before its first turn, and no `s9`.
function snapshotWithoutUsage(): UsageSnapshot {
  return {
    plans: [plan()],
    sessions: [
      session('s1', WORK_DIR, usageEvent()),
      session('s2', WORK_DIR, null),
    ],
  };
}

function meter(
  text: string,
  percent: number,
  tone: MeterInput['tone'],
): MeterInput {
  return { label: 'Context', text, percent, tone };
}

function extra(overrides: Partial<ExtraUsage>): ExtraUsage {
  return {
    enabled: true,
    usedMinor: 1234,
    limitMinor: 5000,
    currency: 'USD',
    ...overrides,
  };
}

describe('statusLineInput', () => {
  it.each([
    {
      case: 'SessionWithUsageOnSecondProfile',
      shown: 's1',
      sessions: [session('s1', PERSONAL_DIR, usageEvent())],
      profileName: 'personal',
      rows: ['Week'],
    },
    {
      case: 'NoShownSession',
      shown: null,
      sessions: [session('s1', PERSONAL_DIR, usageEvent())],
      profileName: 'work',
      rows: ['5h'],
    },
    {
      case: 'ShownSessionWithNoUsage',
      shown: 's9',
      sessions: [session('s1', PERSONAL_DIR, usageEvent())],
      profileName: 'work',
      rows: ['5h'],
    },
    {
      case: 'ShownSessionBeforeItsFirstTurn',
      shown: 's1',
      sessions: [session('s1', PERSONAL_DIR, null)],
      profileName: 'personal',
      rows: ['Week'],
    },
    {
      case: 'SessionOnAProfileNoPlanHolds',
      shown: 's1',
      sessions: [session('s1', '~/.claude-gone', usageEvent())],
      profileName: 'work',
      rows: ['5h'],
    },
  ])(
    'statusLineInput_Profile_$case',
    ({ shown, sessions, profileName, rows }) => {
      const input = statusLineInput(twoProfiles(sessions), shown);

      expect(input.profileName).toBe(profileName);
      expect(input.plans.map((each) => each.label)).toEqual(rows);
    },
  );

  it('statusLineInput_Profiles_EveryProfileInOrder', () => {
    const [work, personal] = twoProfiles([]).plans;
    const snapshot: UsageSnapshot = {
      plans: [work, { ...personal, stale: true }],
      sessions: [],
    };

    const input = statusLineInput(snapshot, null);

    expect(input.profiles).toEqual([
      {
        name: 'work',
        plans: [{ label: '5h', text: '42%', percent: 42, tone: 'normal' }],
        extraUsage: null,
        note: null,
        stale: false,
      },
      {
        name: 'personal',
        plans: [{ label: 'Week', text: '61%', percent: 61, tone: 'normal' }],
        extraUsage: null,
        note: null,
        stale: true,
      },
    ]);
  });

  it('statusLineInput_ExtraUsage_EachProfileCarriesItsOwn', () => {
    const [work, personal] = twoProfiles([]).plans;
    const snapshot: UsageSnapshot = {
      plans: [
        { ...work, usage: { rows: [], extraUsage: extra({}), at: NOW } },
        personal,
      ],
      sessions: [],
    };

    const input = statusLineInput(snapshot, null);

    expect(input.profiles.map((each) => each.extraUsage)).toEqual([
      '$12.34 / $50.00',
      null,
    ]);
  });

  it.each([
    {
      case: 'PlanLoading',
      plans: [plan({ usage: null, lastGoodAt: null })],
      expected: { profileName: 'work', note: 'plan loading', plans: [] },
    },
    {
      case: 'PlanUnavailable',
      plans: [plan({ usage: null, lastGoodAt: null, error: 'no auth' })],
      expected: { note: 'plan unavailable', plans: [] },
    },
    {
      case: 'NoPlanRows',
      plans: [plan({ usage: { rows: [], extraUsage: null, at: NOW } })],
      expected: { note: 'no plan rows', plans: [] },
    },
    {
      case: 'NoProfiles',
      plans: [],
      expected: { profileName: null, note: 'no profiles', stale: false },
    },
    {
      case: 'Stale',
      plans: [plan({ stale: true, error: 'timed out' })],
      expected: { note: null, stale: true },
    },
    {
      case: 'StaleWithNoUsageIsNotStale',
      plans: [plan({ usage: null, stale: true, error: 'timed out' })],
      expected: { stale: false },
    },
  ])('statusLineInput_Notes_$case', ({ plans, expected }) => {
    const input = statusLineInput({ plans, sessions: [] }, null);

    expect(input).toMatchObject(expected);
  });
});

describe('sessionLineInput', () => {
  it.each([
    {
      case: 'ConfiguredWinsOverReported',
      usage: usageEvent(),
      expected: {
        context: meter('180k/300k', 60, 'normal'),
        cache: null,
        spend: null,
      },
    },
    {
      case: 'ReportedOnly',
      usage: usageEvent({
        autocompact: { configured: null, reported: 360_000 },
      }),
      expected: { context: meter('180k/360k', 50, 'normal') },
    },
    {
      case: 'NoLimit',
      usage: usageEvent({ autocompact: { configured: null, reported: null } }),
      expected: { context: meter('180k', 0, 'normal') },
    },
    {
      case: 'BelowSeventyIsNormal',
      usage: usageEvent({ contextTokens: 207_000 }),
      expected: { context: meter('207k/300k', 69, 'normal') },
    },
    {
      case: 'SeventyIsWarning',
      usage: usageEvent({ contextTokens: 210_000 }),
      expected: { context: meter('210k/300k', 70, 'warning') },
    },
    {
      case: 'BelowNinetyIsWarning',
      usage: usageEvent({ contextTokens: 267_000 }),
      expected: { context: meter('267k/300k', 89, 'warning') },
    },
    {
      case: 'NinetyIsCritical',
      usage: usageEvent({ contextTokens: 270_000 }),
      expected: { context: meter('270k/300k', 90, 'critical') },
    },
    {
      case: 'PastTheLimitFillsToAHundred',
      usage: usageEvent({ contextTokens: 330_000 }),
      expected: { context: meter('330k/300k', 100, 'critical') },
    },
    {
      case: 'CacheCold',
      usage: usageEvent({ cacheExpiresAt: NOW }),
      expected: { cache: 'cache cold' },
    },
    {
      case: 'CacheWarmAndSpend',
      usage: usageEvent({
        cacheExpiresAt: NOW + 42 * MINUTE,
        spendUsd: 1.234,
      }),
      expected: { cache: 'cache 42m', spend: '$1.23' },
    },
  ])('sessionLineInput_$case', ({ usage, expected }) => {
    const input = sessionLineInput(withSession(usage), 's1', NOW);

    expect(input).toMatchObject(expected);
  });

  it.each([
    { case: 'AbsentSession', sessionId: 's9' },
    { case: 'SessionBeforeItsFirstTurn', sessionId: 's2' },
  ])('sessionLineInput_NoUsage_ZeroLine_$case', ({ sessionId }) => {
    expect(sessionLineInput(snapshotWithoutUsage(), sessionId, NOW)).toEqual({
      context: { label: 'Context', text: '0k', percent: 0, tone: 'normal' },
      cache: null,
      spend: null,
      compacting: null,
      compactingElapsedMs: null,
    });
  });

  it('sessionLineInput_NoUsage_ZeroLine_Compacting', () => {
    const snapshot: UsageSnapshot = {
      plans: [plan()],
      sessions: [
        session('s1', WORK_DIR, null, { trigger: 'app', startedAt: NOW - 900 }),
      ],
    };

    expect(sessionLineInput(snapshot, 's1', NOW)).toEqual({
      context: { label: 'Context', text: '0k', percent: 0, tone: 'normal' },
      cache: null,
      spend: null,
      compacting: 'compacting · auto',
      compactingElapsedMs: 900,
    });
  });

  it.each<{
    case: string;
    compaction: SessionUsage['compaction'];
    expected: string | null;
    expectedElapsedMs: number | null;
  }>([
    {
      case: 'App',
      compaction: { trigger: 'app', startedAt: NOW - 7250 },
      expected: 'compacting · auto',
      expectedElapsedMs: 7250,
    },
    {
      case: 'Manual',
      compaction: { trigger: 'manual', startedAt: NOW },
      expected: 'compacting',
      expectedElapsedMs: 0,
    },
    {
      case: 'Harness',
      compaction: { trigger: 'harness', startedAt: NOW - 1 },
      expected: 'compacting · autocompact',
      expectedElapsedMs: 1,
    },
    {
      case: 'None',
      compaction: null,
      expected: null,
      expectedElapsedMs: null,
    },
  ])(
    'sessionLineInput_Compacting_$case',
    ({ compaction, expected, expectedElapsedMs }) => {
      const snapshot: UsageSnapshot = {
        plans: [plan()],
        sessions: [session('s1', WORK_DIR, usageEvent(), compaction)],
      };

      expect(sessionLineInput(snapshot, 's1', NOW)).toMatchObject({
        context: meter('180k/300k', 60, 'normal'),
        compacting: expected,
        compactingElapsedMs: expectedElapsedMs,
      });
    },
  );
});

describe('rowLineInput', () => {
  it.each([
    {
      case: 'SessionWithUsage',
      sessionId: 's1',
      expected: meter('180k', 60, 'normal'),
    },
    {
      case: 'AbsentSession',
      sessionId: 's9',
      expected: { label: 'Context', text: '0k', percent: 0, tone: 'normal' },
    },
    {
      case: 'SessionBeforeItsFirstTurn',
      sessionId: 's2',
      expected: { label: 'Context', text: '0k', percent: 0, tone: 'normal' },
    },
  ])('rowLineInput_$case', ({ sessionId, expected }) => {
    expect(rowLineInput(snapshotWithoutUsage(), sessionId)).toEqual({
      context: expected,
    });
  });
});

describe('rowCacheInput', () => {
  it.each([
    { case: 'NoExpiry', cacheExpiresAt: null, expected: null },
    {
      case: 'ExpiryAheadIsWarm',
      cacheExpiresAt: NOW + 120_000,
      expected: { isCold: false, tooltip: 'cache warm · 2m left' },
    },
    {
      case: 'ExpiryAtNowIsCold',
      cacheExpiresAt: NOW,
      expected: { isCold: true, tooltip: 'cache cold' },
    },
    {
      case: 'ExpiryPastIsCold',
      cacheExpiresAt: NOW - MINUTE,
      expected: { isCold: true, tooltip: 'cache cold' },
    },
  ])('rowCacheInput_$case', ({ cacheExpiresAt, expected }) => {
    const snapshot = withSession(usageEvent({ cacheExpiresAt }));

    expect(rowCacheInput(snapshot, 's1', NOW)).toEqual(expected);
  });
});

describe('rowCacheInput without usage', () => {
  it.each([
    { case: 'AbsentSession', sessionId: 's9', expected: null },
    {
      case: 'SessionBeforeItsFirstTurnIsCold',
      sessionId: 's2',
      expected: { isCold: true, tooltip: 'cache cold' },
    },
  ])('rowCacheInput_$case', ({ sessionId, expected }) => {
    expect(rowCacheInput(snapshotWithoutUsage(), sessionId, NOW)).toEqual(
      expected,
    );
  });
});

describe('detailsInput', () => {
  it.each([
    {
      case: 'Fresh',
      plan: plan(),
      expected: { state: 'fresh', freshness: 'updated 3m ago' },
    },
    {
      case: 'FreshJustNow',
      plan: plan({
        usage: { rows: [], extraUsage: null, at: NOW - 30_000 },
      }),
      expected: { state: 'fresh', freshness: 'updated just now' },
    },
    {
      case: 'Stale',
      plan: plan({
        stale: true,
        error: 'timed out',
        lastGoodAt: NOW - 25 * MINUTE,
        usage: { rows: [], extraUsage: null, at: NOW - 25 * MINUTE },
      }),
      expected: {
        state: 'stale',
        freshness: 'stale, last good 25m ago',
        error: 'timed out',
      },
    },
    {
      case: 'Error',
      plan: plan({ usage: null, lastGoodAt: null, error: 'no auth' }),
      expected: {
        state: 'error',
        freshness: 'no good read yet',
        rows: [],
        extraUsage: null,
      },
    },
    {
      case: 'Loading',
      plan: plan({ usage: null, lastGoodAt: null }),
      expected: { state: 'loading', freshness: 'loading', error: null },
    },
    {
      case: 'ExtraUsageNone',
      plan: plan(),
      expected: { extraUsage: null },
    },
    {
      case: 'ExtraUsageOff',
      plan: plan({
        usage: {
          rows: [],
          extraUsage: extra({ enabled: false }),
          at: NOW,
        },
      }),
      expected: { extraUsage: 'off' },
    },
    {
      case: 'ExtraUsageAgainstLimit',
      plan: plan({ usage: { rows: [], extraUsage: extra({}), at: NOW } }),
      expected: { extraUsage: '$12.34 / $50.00' },
    },
    {
      case: 'ExtraUsageNoLimit',
      plan: plan({
        usage: { rows: [], extraUsage: extra({ limitMinor: null }), at: NOW },
      }),
      expected: { extraUsage: '$12.34 / no limit' },
    },
    {
      case: 'Resets',
      plan: plan({
        usage: {
          rows: [
            planRow({ label: '5h', resetsAt: null }),
            planRow({ label: 'Week', resetsAt: NOW }),
            planRow({ label: 'Fable', resetsAt: NOW + 8_070_000 }),
          ],
          extraUsage: null,
          at: NOW,
        },
      }),
      expected: {
        rows: [
          { label: '5h', resets: null },
          { label: 'Week', resets: 'resets now' },
          { label: 'Fable', resets: 'resets in 2h 14m' },
        ],
      },
    },
  ])('detailsInput_Profiles_$case', ({ plan: shownPlan, expected }) => {
    const input = detailsInput({ plans: [shownPlan], sessions: [] }, null, NOW);

    expect(input.profiles[0]).toMatchObject(expected);
  });

  it.each([
    {
      case: 'LimitsDiffer',
      usage: usageEvent(),
      expected: {
        configuredLimit: '300k',
        reportedLimit: '967k',
        limitsDiffer: true,
        window: '1M',
      },
    },
    {
      case: 'LimitsEqual',
      usage: usageEvent({
        autocompact: { configured: 300_000, reported: 300_000 },
      }),
      expected: { limitsDiffer: false },
    },
    {
      case: 'OneLimitNull',
      usage: usageEvent({
        autocompact: { configured: null, reported: 967_000 },
      }),
      expected: { configuredLimit: 'none', limitsDiffer: false },
    },
    {
      case: 'RemainingLeft',
      usage: usageEvent(),
      expected: { remaining: '120k left' },
    },
    {
      case: 'RemainingPastTheLimit',
      usage: usageEvent({ contextTokens: 310_000 }),
      expected: { remaining: 'past the limit' },
    },
    {
      case: 'RemainingWithNoLimit',
      usage: usageEvent({ autocompact: { configured: null, reported: null } }),
      expected: { remaining: 'unknown', reportedLimit: 'unknown' },
    },
    {
      case: 'CacheUnknown',
      usage: usageEvent(),
      expected: { cache: 'unknown' },
    },
    {
      case: 'CacheCold',
      usage: usageEvent({ cacheExpiresAt: NOW - MINUTE }),
      expected: { cache: 'cold' },
    },
    {
      case: 'CacheExpiresIn',
      usage: usageEvent({ cacheExpiresAt: NOW + 42 * MINUTE }),
      expected: { cache: 'expires in 42m' },
    },
    {
      case: 'WindowAndSpendUnknown',
      usage: usageEvent({ contextWindow: null, spendUsd: null }),
      expected: { window: 'unknown', spend: 'unknown' },
    },
    {
      case: 'Spend',
      usage: usageEvent({ spendUsd: 1.234 }),
      expected: { spend: '$1.23' },
    },
  ])('detailsInput_Session_$case', ({ usage, expected }) => {
    const input = detailsInput(withSession(usage), 's1', NOW);

    expect(input.session).toMatchObject(expected);
  });

  it('detailsInput_Session_NullBeforeTheFirstTurn', () => {
    const snapshot: UsageSnapshot = {
      plans: [plan()],
      sessions: [session('s1', WORK_DIR, null)],
    };

    expect(detailsInput(snapshot, 's1', NOW).session).toBeNull();
  });
});

function lineInput(overrides: Partial<StatusLineInput>): StatusLineInput {
  return {
    profileName: 'work',
    plans: [{ label: '5h', text: '42%', percent: 42, tone: 'normal' }],
    extraUsage: null,
    note: null,
    stale: false,
    profiles: [],
    ...overrides,
  };
}

function profileInput(
  name: string,
  state: DetailsProfileInput['state'],
): DetailsProfileInput {
  return {
    name,
    isDefault: false,
    state,
    rows: [],
    extraUsage: null,
    freshness: 'loading',
    error: null,
  };
}

describe('log text', () => {
  it.each([
    {
      case: 'Plans',
      input: lineInput({
        plans: [
          { label: '5h', text: '42%', percent: 42, tone: 'normal' },
          { label: 'Week', text: '61%', percent: 61, tone: 'normal' },
          { label: 'Fable', text: '88%', percent: 88, tone: 'warning' },
        ],
      }),
      expected: 'work: 5h 42%, Week 61%, Fable 88%',
    },
    {
      case: 'NoteInPlaceOfRows',
      input: lineInput({ plans: [], note: 'plan loading' }),
      expected: 'work: plan loading',
    },
    {
      case: 'StaleSuffix',
      input: lineInput({ stale: true }),
      expected: 'work: 5h 42% (stale)',
    },
    {
      case: 'NoProfiles',
      input: lineInput({ profileName: null, plans: [], note: 'no profiles' }),
      expected: 'no profiles',
    },
  ])('logText_StatusLine$case', ({ input, expected }) => {
    expect(statusLineText(input)).toBe(expected);
  });

  it.each<{ case: string; input: SessionLineInput; expected: string }>([
    {
      case: 'Everything',
      input: {
        context: meter('180k/300k', 60, 'normal'),
        cache: 'cache 42m',
        spend: '$1.23',
        compacting: null,
        compactingElapsedMs: null,
      },
      expected: 'context 180k/300k, cache 42m, spend $1.23',
    },
    {
      case: 'Compacting',
      input: {
        context: meter('180k/300k', 60, 'normal'),
        cache: 'cache 42m',
        spend: '$1.23',
        compacting: 'compacting · auto',
        compactingElapsedMs: 900,
      },
      expected: 'compacting · auto, context 180k/300k, cache 42m, spend $1.23',
    },
    {
      case: 'NoCache',
      input: {
        context: meter('180k/300k', 60, 'normal'),
        cache: null,
        spend: '$1.23',
        compacting: null,
        compactingElapsedMs: null,
      },
      expected: 'context 180k/300k, spend $1.23',
    },
    {
      case: 'NoSpend',
      input: {
        context: meter('180k', 0, 'normal'),
        cache: 'cache cold',
        spend: null,
        compacting: null,
        compactingElapsedMs: null,
      },
      expected: 'context 180k, cache cold',
    },
  ])('logText_SessionLine$case', ({ input, expected }) => {
    expect(sessionLineText(input)).toBe(expected);
  });

  it.each<{
    case: string;
    usage: UsageAgentEvent | null;
    compaction?: SessionUsage['compaction'];
    context: string;
    spend: string;
  }>([
    {
      case: 'CacheAndSpend',
      usage: usageEvent({
        cacheExpiresAt: NOW + 42 * MINUTE,
        spendUsd: 1.234,
      }),
      context: 'context 180k/300k, cache 42m',
      spend: '$1.23',
    },
    {
      case: 'NullCache',
      usage: usageEvent({ spendUsd: 1.234 }),
      context: 'context 180k/300k',
      spend: '$1.23',
    },
    {
      case: 'NullSpend',
      usage: usageEvent({ cacheExpiresAt: NOW + 42 * MINUTE }),
      context: 'context 180k/300k, cache 42m',
      spend: 'none',
    },
    {
      case: 'Compacting',
      usage: usageEvent({
        cacheExpiresAt: NOW + 42 * MINUTE,
        spendUsd: 1.234,
      }),
      compaction: { trigger: 'harness', startedAt: NOW - MINUTE },
      context: 'compacting · autocompact, context 180k/300k, cache 42m',
      spend: '$1.23',
    },
    {
      case: 'NoUsage',
      usage: null,
      context: 'context 0k',
      spend: 'none',
    },
  ])(
    'logText_ContextAndSpendLines$case',
    ({ usage, compaction = null, context, spend }) => {
      const snapshot: UsageSnapshot = {
        plans: [],
        sessions: [{ sessionId: 's1', profileDir: null, usage, compaction }],
      };

      expect(contextLineText(contextLineInput(snapshot, 's1', NOW))).toBe(
        context,
      );
      expect(spendLineText(spendLineInput(snapshot, 's1', NOW))).toBe(spend);
    },
  );

  it.each([
    {
      case: 'TwoProfiles',
      input: {
        profiles: [
          profileInput('work', 'fresh'),
          profileInput('personal', 'stale'),
        ],
        session: null,
      },
      expected: 'work fresh, personal stale',
    },
    {
      case: 'NoProfiles',
      input: { profiles: [], session: null },
      expected: 'no profiles',
    },
  ])(
    'logText_DetailsStates$case',
    ({ input, expected }: { input: DetailsInput; expected: string }) => {
      expect(detailsStatesText(input)).toBe(expected);
    },
  );
});
