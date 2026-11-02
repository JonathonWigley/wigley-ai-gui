import { describe, expect, it } from 'vitest';
import type { AgentHarness } from '../../../contracts/agent';
import { createFakeAgentHarness } from '../../../shared/fake-agent-harness';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import type { UsageSnapshot } from '../contract';
import { addDriveActions, type UsageDriveDeps } from './drive-actions';

const NOW = 9_000_000;

// The usage drive actions over a fixed clock, a recording `seed` and the
// given selected session and harnesses.
function setUp(
  overrides: Partial<UsageDriveDeps> & { selected?: string | null } = {},
) {
  const { selected = 's-selected', ...deps } = overrides;
  const seeded: UsageSnapshot[] = [];
  const drive = fakeDriveHost();
  addDriveActions(drive.host, {
    clock: { now: () => NOW },
    selectedSessionId: () => selected,
    snapshot: () => ({ plans: [], sessions: [] }),
    seed: (snapshot) => seeded.push(snapshot),
    pollNow: () => Promise.resolve(),
    harnesses: [],
    ...deps,
  });
  return { drive, seeded };
}

describe('usage drive actions', () => {
  it.each([
    {
      name: 'NoArgs_FreshOnTheSelectedSession',
      args: undefined,
      selected: 's-selected',
      work: { stale: false, hasUsage: true },
      sessionIds: ['s-selected'],
    },
    {
      name: 'SessionIdGiven_SeedsThatSession',
      args: { sessionId: 's-given' },
      selected: 's-selected',
      work: { stale: false, hasUsage: true },
      sessionIds: ['s-given'],
    },
    {
      name: 'NoneSelected_SeedsNoSession',
      args: {},
      selected: null,
      work: { stale: false, hasUsage: true },
      sessionIds: [],
    },
    {
      name: 'Stale_WorkStaleWithUsageKept',
      args: { variant: 'stale' },
      selected: 's-selected',
      work: { stale: true, hasUsage: true },
      sessionIds: ['s-selected'],
    },
    {
      name: 'Error_WorkHasNoUsage',
      args: { variant: 'error' },
      selected: 's-selected',
      work: { stale: true, hasUsage: false },
      sessionIds: ['s-selected'],
    },
  ])('seed_Args_$name', async ({ args, selected, work, sessionIds }) => {
    const { drive, seeded } = setUp({ selected });

    const returned = (await drive.run('seed', args)) as UsageSnapshot;

    expect(seeded).toEqual([returned]);
    const [workPlan, personalPlan] = returned.plans;
    expect({
      name: workPlan.name,
      stale: workPlan.stale,
      hasUsage: workPlan.usage !== null,
    }).toEqual({ name: 'work', ...work });
    expect(personalPlan.stale).toBe(false);
    expect(returned.sessions.map((session) => session.sessionId)).toEqual(
      sessionIds,
    );
  });

  it('seed_Args_OddVariantThrows', async () => {
    const { drive, seeded } = setUp();

    await expect(drive.run('seed', { variant: 'odd' })).rejects.toThrow(
      'variant "odd" is none of fresh, stale, error',
    );
    expect(seeded).toEqual([]);
  });

  it.each([
    { name: 'MessageGiven', args: { message: 'quota' }, expected: 'quota' },
    { name: 'NoMessage', args: {}, expected: 'fake poll failed' },
  ])('failNextPoll_$name_NextPlanUsageRejects', async ({ args, expected }) => {
    const realHarness = { id: 'other' } as AgentHarness;
    const fake = createFakeAgentHarness({ now: () => NOW });
    const { drive } = setUp({ harnesses: [realHarness, fake] });

    expect(await drive.run('failNextPoll', args)).toEqual({});

    await expect(fake.planUsage('~/.claude')).rejects.toThrow(expected);
    await expect(fake.planUsage('~/.claude')).resolves.toBeDefined();
  });

  it('failNextPoll_NoFakeHarness_Throws', async () => {
    const { drive } = setUp({ harnesses: [{ id: 'claude' } as AgentHarness] });

    await expect(drive.run('failNextPoll')).rejects.toThrow(
      'usage.failNextPoll needs the fake harness',
    );
  });

  it('pollNow_ReturnsTheSnapshotAfterThePollSettles', async () => {
    const before: UsageSnapshot = { plans: [], sessions: [] };
    const after: UsageSnapshot = { plans: [], sessions: [] };
    let current = before;
    const { drive } = setUp({
      snapshot: () => current,
      pollNow: async () => {
        await Promise.resolve();
        current = after;
      },
    });

    expect(await drive.run('pollNow')).toBe(after);
  });
});
