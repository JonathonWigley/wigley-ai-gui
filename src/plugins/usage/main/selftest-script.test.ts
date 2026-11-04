import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { LaunchRequest } from '../../chat/contract';
import type { ProfilePlan, UsageSnapshot } from '../contract';
import { usageSelfTestScript } from './selftest-script';

const NOW = 7_000_000;
const HOME = '/home/tester';
const PROJECT = '/home/tester/usage-selftest';

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

// The usage script over fake chat and sessions whose `launch` gives launch n
// the id `s-<n>`, and a usage store holding `before` until a seed replaces it;
// `seedOverride` replaces what the store keeps on a seed; `launch` rejects
// with `launchError` when set. `calls` records each dep call in order;
// `sessionUsage` waits until `releaseUsage` runs, or resolves at once while
// `usageHeld`.
function setUp(
  before: UsageSnapshot,
  options: {
    usageHeld?: boolean;
    seedOverride?: (snapshot: UsageSnapshot) => UsageSnapshot;
    launchError?: Error;
  } = {},
) {
  const calls: string[] = [];
  const launches: LaunchRequest[] = [];
  const seeded: UsageSnapshot[] = [];
  let releaseUsage: () => void = () => undefined;
  let current = before;
  const script = usageSelfTestScript({
    homeDir: HOME,
    files: {
      makeFolder: async (path) => {
        calls.push(`makeFolder ${path}`);
      },
      realPath: async (path) => path,
    },
    paths: posixPaths,
    chat: {
      closeSessionsIn: async (projectDir) => {
        calls.push(`closeSessionsIn ${projectDir}`);
      },
      launch: async (request) => {
        launches.push(request);
        calls.push(`launch ${request.projectDir}`);
        if (options.launchError !== undefined) {
          throw options.launchError;
        }
        return `s-${launches.length}`;
      },
    },
    sessions: { activate: (sessionId) => calls.push(`activate ${sessionId}`) },
    clock: { now: () => NOW },
    snapshot: () => current,
    seed(snapshot) {
      calls.push('seed');
      current = options.seedOverride?.(snapshot) ?? snapshot;
      seeded.push(current);
    },
    sessionUsage(sessionId) {
      calls.push(`sessionUsage ${sessionId}`);
      if (options.usageHeld ?? true) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        releaseUsage = resolve;
      });
    },
    compactions: {
      hold: () => calls.push('hold compactions'),
      release: () => calls.push('release compactions'),
    },
  });
  return {
    script,
    calls,
    launches,
    seeded,
    releaseUsage: () => releaseUsage(),
  };
}

const settled = () => new Promise((settle) => setImmediate(settle));

describe('usageSelfTestScript', () => {
  it('open_LaunchesActivatesAndSeedsAfterTheTurnsUsage', async () => {
    const before = { plans: [plan('work', true)], sessions: [] };
    const { script, calls, launches, seeded, releaseUsage } = setUp(before, {
      usageHeld: false,
    });

    const { shownLine, result } = script.open(1);
    await settled();
    const callsBeforeUsage = [...calls];
    releaseUsage();

    expect(shownLine).toBe(
      '[usage] session line in usage-selftest: context 180k/300k, cache 42m, spend $1.23',
    );
    expect(callsBeforeUsage).toEqual([
      'hold compactions',
      `makeFolder ${PROJECT}`,
      `closeSessionsIn ${PROJECT}`,
      `launch ${PROJECT}`,
      'activate s-1',
      'sessionUsage s-1',
    ]);
    expect(launches[0]).toMatchObject({ projectDir: PROJECT, profile: 'work' });
    expect(await result).toMatchObject({ sessionId: 's-1' });
    expect(calls.at(-1)).toBe('seed');
    expect(seeded[0].sessions.map((session) => session.sessionId)).toEqual([
      's-1',
    ]);
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
      dropSessions
        ? { seedOverride: (snapshot) => ({ ...snapshot, sessions: [] }) }
        : {},
    );

    const { result } = script.open(1);

    expect(script.problems(await result)).toEqual(expected);
  });

  it('problems_ReleasesTheCompactionHold', async () => {
    const before = { plans: [plan('work', true)], sessions: [] };
    const { script, calls } = setUp(before);
    const { result } = script.open(1);
    const opened = await result;
    expect(calls).not.toContain('release compactions');

    script.problems(opened);

    expect(calls).toContain('release compactions');
  });

  it('open_LaunchFails_ReleasesTheCompactionHold', async () => {
    const before = { plans: [plan('work', true)], sessions: [] };
    const launchError = new Error('no such profile');
    const { script, calls } = setUp(before, { launchError });

    await expect(script.open(1).result).rejects.toBe(launchError);

    expect(calls.at(-1)).toBe('release compactions');
  });
});
