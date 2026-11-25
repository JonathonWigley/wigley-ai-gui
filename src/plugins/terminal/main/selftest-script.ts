import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every page line.
const SELFTEST_PROJECT_NAME = 'terminal-selftest';

export interface TerminalSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
}

const GROUPS: SelfTestGroup[] = [
  {
    name: 'drawer',
    why: "The chord opens the session's terminal, a typed line reaches its shell, Esc returns to the session, and the leader chord closes the drawer.",
    steps: [
      {
        keys: ['<C-`>'],
        expect: `[terminal] drawer opened in ${SELFTEST_PROJECT_NAME}`,
        checksFit: true,
        screenshot: 'drawer',
        why: 'The open drawer shows its header over the screen, and both fit the window.',
      },
      {
        keys: [...'echo hi', 'Enter'],
        expect: `[terminal] line sent in ${SELFTEST_PROJECT_NAME}`,
      },
      {
        keys: ['Escape'],
        expect: `[terminal] back to the session in ${SELFTEST_PROJECT_NAME}`,
      },
      {
        keys: [' ', 'b', 't'],
        expect: `[terminal] drawer closed in ${SELFTEST_PROJECT_NAME}`,
      },
    ],
  },
];

// Each run closes an earlier run's rows and launches a new chat session in the
// project folder, shown, so the first step's chord acts on it.
export function terminalSelfTestScript(
  deps: TerminalSelfTestDeps,
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
    // The drawer header's folder ends in an ellipsis, as its CSS says, and the
    // terminal screen holds its own scrolling grid.
    scrollsItself: ['.terminal-header-folder', '.terminal-drawer-screen'],
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
          message: { text: 'terminal self-test', images: [] },
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
