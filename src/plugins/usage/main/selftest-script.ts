import type { Clock } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import type { UsageSnapshot } from '../contract';
import { usageFixture } from './usage-fixture';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every session line.
const SELFTEST_PROJECT_NAME = 'usage-selftest';

// `sessionUsage` resolves once the store holds a `usage` event for the
// session, at once when it already does.
export interface UsageSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
  clock: Clock;
  snapshot(): UsageSnapshot;
  seed(snapshot: UsageSnapshot): void;
  sessionUsage(sessionId: string): Promise<void>;
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
// The fresh fixture's session line, as each surface logs it.
const FRESH_LINE = `session line in ${SELFTEST_PROJECT_NAME}: context 180k/300k, cache 42m, spend $1.23`;

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
    why: "In a narrow window the status line keeps every profile stacked, the Chat status line's usage part drops whole items from its end, and the right bar lies over the content at its least width.",
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
        checksFit: true,
      },
    ],
  },
];

// Each run closes the sessions an earlier run left in the project folder, so
// the new row's label stays the folder's name, launches a chat session there,
// activates its row so that a pane shows its Chat tab, whose status line draws
// the session line, whatever an earlier script left selected, waits for the
// fake turn's own usage event, and only then seeds the fresh fixture on it, so
// that event cannot overwrite the seed: the steps wait for exact lines, and the
// start poll's line is logged before the run begins. The plans the start poll
// left unread fail the run, so the poll over the harness is still proved. The
// steps end with the details closed, so `uiState` opens none for the next run.
export function usageSelfTestScript(deps: UsageSelfTestDeps): SelfTestScript {
  const { homeDir, files, paths, chat, sessions } = deps;
  let made: Promise<string> | null = null;

  async function makeProject(): Promise<string> {
    const projectDir = paths.join(
      await files.realPath(homeDir),
      SELFTEST_PROJECT_NAME,
    );
    await files.makeFolder(projectDir);
    return projectDir;
  }

  return {
    pageBinds: [],
    settings: {},
    // The tab bar's parts and the session line clip in their own box, and the
    // activity dock's tool calls and done line end in an ellipsis inside
    // theirs.
    scrollsItself: [
      '.session-bar-parts',
      '.usage-session-line',
      '.chat-working-action',
      '.chat-working-done',
    ],
    open() {
      made ??= makeProject().catch((error: unknown) => {
        made = null;
        throw error;
      });
      const result = made.then(
        async (projectDir): Promise<UsageSelfTestResult> => {
          await chat.closeSessionsIn(projectDir);
          const sessionId = await chat.launch({
            projectDir,
            profile: 'work',
            message: { text: 'usage self-test', images: [] },
          });
          sessions.activate(sessionId);
          await deps.sessionUsage(sessionId);
          const { plans } = deps.snapshot();
          const unreadPlans =
            plans.length === 0
              ? null
              : plans
                  .filter((plan) => plan.usage === null)
                  .map((plan) => plan.name);
          deps.seed(usageFixture('fresh', deps.clock.now(), sessionId));
          return { unreadPlans, snapshot: deps.snapshot(), sessionId };
        },
      );
      // usage-tab-line starts in the self-test, so the seed also draws the
      // line in the run's tab bar, logged under usage-tab-line's name.
      return {
        shownLine: `[usage] ${FRESH_LINE}`,
        alsoShown: [
          /^\[usage-tab-line\] session line in usage-selftest: context 180k\/300k, cache 42m, spend \$1\.23$/,
        ],
        result,
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
