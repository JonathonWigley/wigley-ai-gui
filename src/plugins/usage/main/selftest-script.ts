import type { Clock } from '../../../contracts/ambient';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type {
  OwnedSession,
  SessionsMainExports,
} from '../../sessions/contract';
import type { UsageSnapshot } from '../contract';
import { usageFixture } from './usage-fixture';

export interface UsageSelfTestDeps {
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>;
  clock: Clock;
  snapshot(): UsageSnapshot;
  seed(snapshot: UsageSnapshot): void;
}

// What `open` saw and seeded: `unreadPlans` names the plans with no usage
// before the seed, null when the snapshot held no plan; `snapshot` is the
// store's snapshot read back after the seed; `sessionId` is the id `open`
// gave the run's session.
interface UsageSelfTestResult {
  unreadPlans: string[] | null;
  snapshot: UsageSnapshot;
  sessionId: string;
}

const TOGGLE = [' ', 'v', 'u'];
const FRESH_DETAILS = '[usage] details shown: work fresh, personal fresh';
const DETAILS_HIDDEN = '[usage] details hidden';

const GROUPS: SelfTestGroup[] = [
  {
    name: 'details',
    why: 'Space v u opens the usage details in the right bar and closes them again, and the status line and the bar each fit the minimum width, and the box of the session line stays inside it.',
    steps: [
      {
        keys: TOGGLE,
        expect: FRESH_DETAILS,
        screenshot: 'details',
        checksFit: true,
      },
      {
        keys: TOGGLE,
        expect: DETAILS_HIDDEN,
        screenshot: 'status-line',
        checksFit: true,
      },
    ],
  },
  {
    name: 'narrow',
    why: 'In a narrow window the status line wraps between its groups, the session line drops whole items from its end, and the right bar lies over the content at its least width.',
    steps: [
      {
        width: 520,
        keys: TOGGLE,
        expect: FRESH_DETAILS,
        screenshot: 'details-narrow',
      },
      {
        keys: TOGGLE,
        expect: DETAILS_HIDDEN,
        screenshot: 'status-line-narrow',
      },
    ],
  },
];

// Each run ends the session the run before opened, opens
// `usage-selftest-<run>` in the background, activates its row so that a pane
// shows the session and its tab bar draws the session line whatever an
// earlier script left selected, and seeds the fresh fixture on it:
// the steps wait for exact lines, and the start poll's line is logged before
// the run begins. The plans the start poll left unread fail the run, so the
// poll over the harness is still proved. The steps end with the details
// closed, so `uiState` opens none for the next run.
export function usageSelfTestScript(deps: UsageSelfTestDeps): SelfTestScript {
  let opened: OwnedSession | null = null;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: ['.session-bar-parts'],
    open(run) {
      opened?.end();
      const session = deps.sessions.open(
        {
          sessionId: `usage-selftest-${run}`,
          projectDir: 'usage-selftest',
          harness: 'claude',
          deadlineSeconds: null,
        },
        { select: false },
      );
      opened = session;
      const sessionId = session.session.id;
      deps.sessions.activate(sessionId);
      const { plans } = deps.snapshot();
      const unreadPlans =
        plans.length === 0
          ? null
          : plans
              .filter((plan) => plan.usage === null)
              .map((plan) => plan.name);
      deps.seed(usageFixture('fresh', deps.clock.now(), sessionId));
      const result: UsageSelfTestResult = {
        unreadPlans,
        snapshot: deps.snapshot(),
        sessionId,
      };
      return {
        shownLine: `[usage] session line ${sessionId}: context 180k/300k, cache 42m, spend $1.23`,
        result: Promise.resolve(result),
      };
    },
    groups: GROUPS,
    problems: (result) => {
      const { unreadPlans, snapshot, sessionId } =
        result as UsageSelfTestResult;
      const problems =
        unreadPlans === null
          ? ['no plan was read before the seed']
          : unreadPlans.map(
              (name) => `plan ${name} was not read before the seed`,
            );
      const sessionSeeded = snapshot.sessions.some(
        (session) => session.sessionId === sessionId && session.usage !== null,
      );
      if (!sessionSeeded) {
        problems.push(`session ${sessionId} has no usage`);
      }
      return problems;
    },
  };
}
