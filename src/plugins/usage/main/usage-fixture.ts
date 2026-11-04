import {
  MAIN_AGENT_ID,
  type PlanRow,
  type PlanUsage,
} from '../../../contracts/agent';
import type { ProfilePlan, SessionUsage, UsageSnapshot } from '../contract';

// `fresh` holds two read plans; `stale` is work's poll failing after a good
// one, `error` work's first poll failing.
export type UsageFixtureVariant = 'fresh' | 'stale' | 'error';

export const USAGE_FIXTURE_VARIANTS: readonly UsageFixtureVariant[] = [
  'fresh',
  'stale',
  'error',
];

const WORK_DIR = '~/.claude';
const FAILED_POLL = 'claude exited with code 1';

function row(
  kind: 'session' | 'weekly_all' | 'weekly_scoped',
  percent: number,
  resetsAt: number,
  severity: PlanRow['severity'],
): PlanRow {
  const shapes = {
    session: { group: 'session', label: '5h', isActive: true },
    weekly_all: { group: 'weekly', label: 'Week', isActive: true },
    weekly_scoped: { group: 'weekly', label: 'Fable', isActive: false },
  };
  return { kind, ...shapes[kind], percent, resetsAt, severity };
}

function workPlan(variant: UsageFixtureVariant, now: number): ProfilePlan {
  const readAt = variant === 'stale' ? now - 1_500_000 : now - 180_000;
  const usage: PlanUsage = {
    rows: [
      row('session', 42, now + 8_070_000, 'normal'),
      row('weekly_all', 61, now + 274_000_000, 'warning'),
      row('weekly_scoped', 88, now + 274_000_000, 'critical'),
    ],
    extraUsage: {
      enabled: true,
      usedMinor: 1234,
      limitMinor: 5000,
      currency: 'USD',
    },
    at: readAt,
  };
  const plan = { name: 'work', profileDir: WORK_DIR, isDefault: true };
  if (variant === 'error') {
    return {
      ...plan,
      usage: null,
      lastGoodAt: null,
      error: FAILED_POLL,
      stale: true,
    };
  }
  const isStale = variant === 'stale';
  return {
    ...plan,
    usage,
    lastGoodAt: readAt,
    error: isStale ? FAILED_POLL : null,
    stale: isStale,
  };
}

function personalPlan(now: number): ProfilePlan {
  const readAt = now - 180_000;
  return {
    name: 'personal',
    profileDir: '~/.claude-personal',
    isDefault: false,
    usage: {
      rows: [
        row('session', 7, now + 14_430_000, 'normal'),
        row('weekly_all', 12, now + 518_430_000, 'normal'),
      ],
      extraUsage: {
        enabled: false,
        usedMinor: null,
        limitMinor: null,
        currency: null,
      },
      at: readAt,
    },
    lastGoodAt: readAt,
    error: null,
    stale: false,
  };
}

function sessionUsage(sessionId: string, now: number): SessionUsage {
  return {
    sessionId,
    profileDir: WORK_DIR,
    usage: {
      type: 'usage',
      agentId: MAIN_AGENT_ID,
      at: now,
      contextTokens: 180_000,
      contextWindow: 1_000_000,
      autocompact: { configured: 300_000, reported: 967_000 },
      cacheExpiresAt: now + 2_579_000,
      spendUsd: 1.234,
    },
    compaction: null,
  };
}

// A fixed snapshot for the self-test and drive runs: plans `work` and
// `personal`, with one session on work when `sessionId` is not null. Every
// time is relative to `now`, so countdowns read the same on any run; the
// values differ from `fakePlanUsage`'s, so a line drawn from a fake poll never
// reads as the fixture's.
export function usageFixture(
  variant: UsageFixtureVariant,
  now: number,
  sessionId: string | null,
): UsageSnapshot {
  return {
    plans: [workPlan(variant, now), personalPlan(now)],
    sessions: sessionId === null ? [] : [sessionUsage(sessionId, now)],
  };
}
