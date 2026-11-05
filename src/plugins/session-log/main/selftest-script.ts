import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every page line.
const SELFTEST_PROJECT_NAME = 'session-log-selftest';

export interface SessionLogSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
}

const GROUPS: SelfTestGroup[] = [
  {
    name: 'recently closed',
    why: 'A closed session lists at the top of the start prompt, and a pick reopens it.',
    steps: [
      {
        keys: ['<D-w>'],
        expect: `[chat] session closed: ${SELFTEST_PROJECT_NAME}`,
        why: '`open` waited for the idle line, so the turn has ended and Cmd+W does not ask.',
      },
      {
        keys: [' ', 'k', 'n'],
        expect: '[chat] picker shown: Folder',
        alsoExpect: [/^\[chat\] resume section Recently closed: \d+ rows$/],
        screenshot: 'folder-step',
        why: 'A whole run lists chat’s closed sessions too, so the row count is a pattern.',
      },
      {
        keys: ['k', 'Enter'],
        expect: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        why: 'This session closed last, so its row is next to the cursor.',
      },
    ],
  },
];

// Each run closes the sessions an earlier run left in the project folder, since
// `open` runs on each page load, launches a chat session there with a plain
// first message, and activates its row so that a pane shows its Chat tab. The
// fake ends that turn before the row activates, so the page logs its idle line
// around the shown line, before any step began waiting.
export function sessionLogSelfTestScript(
  deps: SessionLogSelfTestDeps,
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
    scrollsItself: [],
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
          message: { text: 'session-log self-test', images: [] },
        });
        sessions.activate(sessionId);
      });
      return {
        shownLine: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        alsoShown: [
          new RegExp(`^\\[chat\\] ${SELFTEST_PROJECT_NAME} is idle$`),
        ],
        result,
      };
    },
    groups: GROUPS,
    problems: () => [],
  };
}
