import type { Clock } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { FAKE_COMPACT_TEXT } from '../../../shared/fake-agent-harness';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import type { UsageSnapshot } from '../contract';
import { usageFixture } from './usage-fixture';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every usage line.
const SELFTEST_PROJECT_NAME = 'usage-selftest';

// `sessionUsage` resolves once the store holds a `usage` event for the
// session, at once when it already does. Between `compactions.hold` and
// `compactions.release`, a fake session's compaction stays running.
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
  compactions: { hold(): void; release(): void };
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
// The fresh fixture's context line.
const FRESH_LINE = `context line in ${SELFTEST_PROJECT_NAME}: context 180k/300k, cache 42m`;
// The same line while the fake's own compaction runs.
const COMPACTING_LINE = `context line in ${SELFTEST_PROJECT_NAME}: compacting · autocompact, context 180k/300k, cache 42m`;
const SEND_FAKE_COMPACT = ['i', ...FAKE_COMPACT_TEXT, 'Escape', 'Enter'];
const COMPACTING_TAB_LINE =
  /^\[usage-tab-line\] session line in usage-selftest: compacting · autocompact, context 180k\/300k, cache 42m, spend \$1\.23$/;

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
    why: 'In a narrow window the status line keeps every profile stacked, and the right bar lies over the content at its least width.',
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
  {
    name: 'compacting',
    why: "A compaction draws the trigger's chip at the start of the context line and the tab bar's session line and drops it when the compaction ends, and the context line with its chip fits the window's least width; `compacting-narrow` is read by eye for the chip beside its meter there.",
    steps: [
      {
        width: 'start',
        keys: SEND_FAKE_COMPACT,
        expect: `[usage] ${COMPACTING_LINE}`,
        alsoExpect: [COMPACTING_TAB_LINE],
        screenshot: 'compacting',
        checksFit: true,
      },
      { keys: ['<C-c>'], expect: `[usage] ${FRESH_LINE}` },
      {
        width: 420,
        keys: SEND_FAKE_COMPACT,
        expect: `[usage] ${COMPACTING_LINE}`,
        alsoExpect: [COMPACTING_TAB_LINE],
        screenshot: 'compacting-narrow',
        checksFit: true,
      },
      { keys: ['<C-c>'], expect: `[usage] ${FRESH_LINE}` },
    ],
  },
];

// Each run closes the sessions an earlier run left in the project folder, so
// the new row's label stays the folder's name, launches a chat session there,
// activates its row so that a pane shows its Chat tab, whose composer draws the
// context line, whatever an earlier script left selected, waits for the
// fake turn's own usage event, and only then seeds the fresh fixture on it, so
// that event cannot overwrite the seed: the steps wait for exact lines, and the
// start poll's line is logged before the run begins. The plans the start poll
// left unread fail the run, so the poll over the harness is still proved. The
// steps end with the details closed, so `uiState` opens none for the next run.
// `open` holds compactions, so the `compacting` group's chip stays up until its
// interrupt; `problems` releases them. A run that skips the result step leaves
// the hold set for the rest of that self-test process, which is harmless, since
// no later script sends `FAKE_COMPACT_TEXT`.
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
    // activity dock's tool calls, one line and done line end in an ellipsis
    // inside theirs.
    scrollsItself: [
      '.session-bar-parts',
      '.usage-session-line',
      '.chat-working-action',
      '.chat-working-line',
      '.chat-working-done',
    ],
    open() {
      deps.compactions.hold();
      made ??= makeProject().catch((error: unknown) => {
        made = null;
        throw error;
      });
      const result = made
        .then(async (projectDir): Promise<UsageSelfTestResult> => {
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
        })
        .catch((error: unknown) => {
          deps.compactions.release();
          throw error;
        });
      // The seed also draws the spend, and usage-tab-line starts in the
      // self-test, so the whole line in the run's tab bar, logged under
      // usage-tab-line's name.
      return {
        shownLine: `[usage] ${FRESH_LINE}`,
        alsoShown: [
          /^\[usage\] spend in usage-selftest: \$1\.23$/,
          /^\[usage-tab-line\] session line in usage-selftest: context 180k\/300k, cache 42m, spend \$1\.23$/,
        ],
        result,
      };
    },
    groups: GROUPS,
    problems: (result) => {
      deps.compactions.release();
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
