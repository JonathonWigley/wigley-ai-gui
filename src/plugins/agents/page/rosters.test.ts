import { describe, expect, it } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
import type { Roster, RosterAgent } from '../contract';
import { createPageRosters, type PageRosters } from './rosters';

function agent(agentId: string, startedAt: number): RosterAgent {
  return {
    agentId,
    agentType: 'Explore',
    name: agentId,
    description: `${agentId}'s work`,
    startedAt,
    model: null,
    effort: null,
    spendUsd: null,
    isBackground: false,
    contextTokens: null,
    contextWindow: null,
    tools: [],
  };
}

const EMPTY: Roster = { agents: [], tasks: [] };
// The `rosters` read's roster for s1, older than CHANGED.
const READ: Roster = { agents: [agent('a1', 1_200)], tasks: [] };
// A `rosterChanged` roster for s1.
const CHANGED: Roster = {
  agents: [agent('a1', 1_200), agent('a2', 3_400)],
  tasks: [],
};

// Page rosters with two listeners, `first` then `second`, each recording
// `<name> <sessionId>` in `heard`; `first` throws after recording when the
// row says so. `first` is the registration a row may dispose.
interface Harness {
  rosters: PageRosters;
  first: Disposable;
}

describe('createPageRosters', () => {
  it.each<{
    case: string;
    firstThrows?: boolean;
    act: (harness: Harness) => void;
    roster: Roster;
    heard: string[];
    logged?: string[];
  }>([
    {
      case: 'UnknownSession_EmptyRoster',
      act: () => undefined,
      roster: EMPTY,
      heard: [],
    },
    {
      case: 'Set_ListenersHearIt',
      act: ({ rosters }) => rosters.set('s1', CHANGED),
      roster: CHANGED,
      heard: ['first s1', 'second s1'],
    },
    {
      case: 'FillAfterSetWhileReading_KeepsTheSet',
      act: ({ rosters }) => {
        rosters.set('s1', CHANGED);
        rosters.fill({ s1: READ });
        rosters.settle();
      },
      roster: CHANGED,
      heard: ['first s1', 'second s1'],
    },
    {
      case: 'FillAfterSettle_StoresTheRead',
      act: ({ rosters }) => {
        rosters.set('s1', CHANGED);
        rosters.settle();
        rosters.fill({ s1: READ });
      },
      roster: READ,
      heard: ['first s1', 'second s1', 'first s1', 'second s1'],
    },
    {
      case: 'Forget_EmptyRosterNoListener',
      act: ({ rosters }) => {
        rosters.set('s1', CHANGED);
        rosters.forget('s1');
      },
      roster: EMPTY,
      heard: ['first s1', 'second s1'],
    },
    {
      case: 'DisposedListener_NotCalled',
      act: ({ rosters, first }) => {
        first.dispose();
        rosters.set('s1', CHANGED);
      },
      roster: CHANGED,
      heard: ['second s1'],
    },
    {
      case: 'ListenerThrows_NextStillCalledAndLogged',
      firstThrows: true,
      act: ({ rosters }) => rosters.set('s1', CHANGED),
      roster: CHANGED,
      heard: ['first s1', 'second s1'],
      logged: ['roster listener failed: first broke'],
    },
  ])(
    'createPageRosters_Steps_RosterAndCalls ($case)',
    ({ firstThrows = false, act, roster, heard, logged = [] }) => {
      const logs: string[] = [];
      const calls: string[] = [];
      const rosters = createPageRosters({ log: (line) => logs.push(line) });
      const first = rosters.onRosterChanged((sessionId) => {
        calls.push(`first ${sessionId}`);
        if (firstThrows) {
          throw new Error('first broke');
        }
      });
      rosters.onRosterChanged((sessionId) => calls.push(`second ${sessionId}`));

      act({ rosters, first });

      expect(rosters.roster('s1')).toEqual(roster);
      expect(calls).toEqual(heard);
      expect(logs).toEqual(logged);
    },
  );
});
