import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { FAKE_CONTEXT_TEXT } from '../../../shared/fake-agent-harness';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every page line.
const SELFTEST_PROJECT_NAME = 'context-sources-selftest';

export interface ContextSourcesSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
}

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

const GROUPS: SelfTestGroup[] = [
  {
    name: 'breakdown',
    why: "A turn whose harness reports where the context comes from fills the session hub's Context section, its summary the total and its share of the window.",
    steps: [
      {
        width: 1200,
        keys: sendKeys(FAKE_CONTEXT_TEXT),
        expect: `[context-sources] context in ${SELFTEST_PROJECT_NAME}: 128k · 13%`,
        checksFit: 'held',
        screenshot: 'breakdown',
        why: 'The hub shows only in a Chat tab at least 640px wide, so the fit check and the screenshot hold a window wide enough for that tab: at the minimum width the section is hidden and neither sees it.',
      },
    ],
  },
];

// Each run closes an earlier run's rows and launches a new chat session in the
// project folder with a plain first message, whose turn reports no breakdown,
// so the breakdown's line logs after the step began waiting.
export function contextSourcesSelfTestScript(
  deps: ContextSourcesSelfTestDeps,
): SelfTestScript {
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
    // A source's and an item's name end in an ellipsis in their row, as the
    // CSS says. So do a project group's name, and the activity dock's
    // tool calls and its done line; the tab bar's parts and the dock's one line clip
    // in their own box.
    scrollsItself: [
      '.context-sources-name',
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
          message: { text: 'context-sources self-test', images: [] },
        });
        sessions.activate(sessionId);
      });
      return {
        shownLine: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        result,
      };
    },
    groups: GROUPS,
    problems: () => [],
  };
}
