import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in chat's page lines.
const SELFTEST_PROJECT_NAME = 'session-stash-selftest';
// The first message, and so the title the session is stashed under.
const SELFTEST_TITLE = 'stash self-test';
// The note the stash types; its first word is what the start prompt's filter
// finds the stashed row by.
const NOTE_WORD = 'stashnote';
const NOTE = `${NOTE_WORD} for lunch`;

const GROUPS: SelfTestGroup[] = [
  {
    name: 'stash and resume',
    why: "Space ' stashes the shown session with a note, its row closes, the start prompt lists it under Stashed with the note, and resuming it removes the stash.",
    steps: [
      {
        keys: [' ', "'"],
        expect: `[session-stash] stash dialog opened for ${SELFTEST_TITLE}`,
        screenshot: 'note-dialog',
      },
      {
        keys: [...NOTE, 'Enter'],
        expect: `[chat] session closed: ${SELFTEST_PROJECT_NAME}`,
        alsoExpect: [
          new RegExp(`^\\[session-stash\\] stashed "${SELFTEST_TITLE}"$`),
        ],
        why: '`open` waited for the idle line, so the close asks nothing and the stash is written.',
      },
      {
        keys: [' ', 'b', 'n'],
        expect: '[chat] picker shown: Folder',
        alsoExpect: [/^\[chat\] resume section Stashed: \d+ rows$/],
        screenshot: 'stashed-section',
        why: 'Chat asks Stashed first, so session-log leaves the stashed session out of Recently closed, which a filtered run then leaves out as empty.',
      },
      {
        keys: ['/', ...NOTE_WORD, 'Enter'],
        expect: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        alsoExpect: [
          new RegExp(
            `^\\[session-stash\\] stash removed: "${SELFTEST_TITLE}"$`,
          ),
        ],
        why: 'The filter matches the note in the row, so Enter resumes the stashed session.',
      },
    ],
  },
];

export interface SessionStashSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
}

// Each run closes the sessions an earlier run left in the project folder, since
// `open` runs on each page load, launches a chat session there with a plain
// first message, and activates its row so that a pane shows its Chat tab. The
// fake ends that turn before the row activates, so the page logs its idle line
// around the shown line, before any step began waiting.
export function sessionStashSelfTestScript(
  deps: SessionStashSelfTestDeps,
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
          message: { text: SELFTEST_TITLE, images: [] },
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
