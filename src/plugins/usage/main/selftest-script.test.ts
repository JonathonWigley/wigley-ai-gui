import { describe, expect, it } from 'vitest';
import type { ProfilePlan, UsageSnapshot } from '../contract';
import type { OwnedSession, SessionInfo } from '../../sessions/contract';
import { usageSelfTestScript } from './selftest-script';

const NOW = 7_000_000;

function plan(name: string, isRead: boolean): ProfilePlan {
  return {
    name,
    profileDir: `~/.${name}`,
    isDefault: name === 'work',
    usage: isRead ? { rows: [], extraUsage: null, at: NOW } : null,
    lastGoodAt: isRead ? NOW : null,
    error: null,
    stale: false,
  };
}

// The usage script over fake sessions whose `open` gives run n's session
// the id `s-<n>`, and a usage store holding `before` until a seed replaces
// it; `seedOverride` replaces what the store keeps on a seed.
function setUp(
  before: UsageSnapshot,
  seedOverride?: (snapshot: UsageSnapshot) => UsageSnapshot,
) {
  const opens: SessionInfo[] = [];
  const activated: string[] = [];
  const ended: string[] = [];
  const seeded: UsageSnapshot[] = [];
  let current = before;
  const script = usageSelfTestScript({
    sessions: {
      open(info) {
        opens.push(info);
        const id = `s-${opens.length}`;
        return {
          session: { id },
          end: () => ended.push(id),
        } as unknown as OwnedSession;
      },
      activate: (sessionId) => activated.push(sessionId),
    },
    clock: { now: () => NOW },
    snapshot: () => current,
    seed(snapshot) {
      current = seedOverride?.(snapshot) ?? snapshot;
      seeded.push(current);
    },
  });
  return { script, opens, activated, ended, seeded };
}

describe('usageSelfTestScript', () => {
  it('open_OpensActivatesAndSeedsTheRunSession', async () => {
    const before = { plans: [plan('work', true)], sessions: [] };
    const { script, opens, activated, ended, seeded } = setUp(before);

    script.open(1);
    const { result } = script.open(2);

    expect(opens.map((info) => info.sessionId)).toEqual([
      'usage-selftest-1',
      'usage-selftest-2',
    ]);
    expect(ended).toEqual(['s-1']);
    expect(activated).toEqual(['s-1', 's-2']);
    expect(seeded[1].sessions.map((session) => session.sessionId)).toEqual([
      's-2',
    ]);
    expect(await result).toMatchObject({ sessionId: 's-2' });
  });

  it.each([
    {
      name: 'EveryPlanReadAndSessionSeeded',
      plans: [plan('work', true), plan('personal', true)],
      dropSessions: false,
      expected: [],
    },
    {
      name: 'PlanUnread',
      plans: [plan('work', false), plan('personal', true)],
      dropSessions: false,
      expected: ['plan work was not read before the seed'],
    },
    {
      name: 'NoPlan',
      plans: [],
      dropSessions: false,
      expected: ['no plan was read before the seed'],
    },
    {
      name: 'SessionNotSeeded',
      plans: [plan('work', true)],
      dropSessions: true,
      expected: ['session s-1 has no usage'],
    },
  ])('problems_$name', async ({ plans, dropSessions, expected }) => {
    const { script } = setUp(
      { plans, sessions: [] },
      dropSessions ? (snapshot) => ({ ...snapshot, sessions: [] }) : undefined,
    );

    const { result } = script.open(1);

    expect(script.problems(await result)).toEqual(expected);
  });
});
