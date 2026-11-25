import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import {
  FAKE_PERMISSION_TEXT,
  type FakeAgentHarness,
} from '../../../shared/fake-agent-harness';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every log line.
const SELFTEST_PROJECT_NAME = 'permission-review-selftest';

export interface PermissionReviewSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
  // The fake harness the session runs on; null when it runs on another.
  fakeOf(sessionId: string): FakeAgentHarness | null;
}

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

const GROUPS: SelfTestGroup[] = [
  {
    name: 'permission review',
    why: "Each permission card gets a second opinion from the harness's one-shot ask: a failed ask shows why it failed, and a reply shows its verdict.",
    steps: [
      {
        keys: sendKeys(FAKE_PERMISSION_TEXT),
        expect: `[permission-review] reviewed Bash in ${SELFTEST_PROJECT_NAME}: deny · medium`,
        alsoExpect: [/^\[permission-review\] verdict .+: Deny · medium risk$/],
        checksFit: true,
        screenshot: 'permission-review-verdict',
        why: "The fake turn's Bash permission is reviewed by the fake harness's default ask reply, and its card shows the verdict.",
      },
    ],
  },
];

// Each run closes an earlier run's rows and launches a new chat session in the
// project folder, then raises a Write permission on it whose review's ask is
// armed to fail: a step only types keys, so the failure is opened here. The
// request is left unanswered; the next run's close cancels it.
export function permissionReviewSelfTestScript(
  deps: PermissionReviewSelfTestDeps,
): SelfTestScript {
  const { homeDir, files, paths, chat, sessions, fakeOf } = deps;
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
    // A project group's name, and the activity dock's tool calls and its done
    // line, end in an ellipsis in their row, as the CSS says; the tab bar's
    // parts and the dock's one line clip in their own box.
    scrollsItself: [
      '.session-group-name',
      '.session-bar-parts',
      '.chat-working-action',
      '.chat-working-line',
      '.chat-working-done',
    ],
    open() {
      made ??= makeProject().catch((error: unknown) => {
        made = null;
        throw error;
      });
      const result = made.then(async (projectDir) => {
        await chat.closeSessionsIn(projectDir);
        const sessionId = await chat.launch({
          projectDir,
          profile: 'work',
          message: { text: 'permission-review self-test', images: [] },
        });
        sessions.activate(sessionId);
        const fake = fakeOf(sessionId);
        if (fake === null) {
          throw new Error('the self-test session runs on no fake harness');
        }
        fake.failNextAsk('fake ask failed');
        void fake.askPermission(sessionId, {
          toolName: 'Write',
          input: { file_path: 'notes.md', content: 'fixture' },
          toolUseId: 'permission-review-fixture',
        });
      });
      return {
        shownLine: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        alsoShown: [
          /^\[permission-review\] review unavailable for Write in permission-review-selftest: fake ask failed$/,
        ],
        result,
      };
    },
    groups: GROUPS,
    problems: () => [],
  };
}
