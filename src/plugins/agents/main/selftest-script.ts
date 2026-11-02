import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { FAKE_AGENTS_TEXT } from '../../../shared/fake-agent-harness';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every page line.
const SELFTEST_PROJECT_NAME = 'agents-selftest';

export interface AgentsSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
}

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

const GROUPS: SelfTestGroup[] = [
  {
    name: 'subagent lines',
    why: 'A session whose agent spawns two subagents draws a line for each under its row (dot, type, description, elapsed, tool count), and an interrupt finishes them and the lines go.',
    steps: [
      {
        keys: sendKeys(FAKE_AGENTS_TEXT),
        expect: `[agents] lines in ${SELFTEST_PROJECT_NAME}: 2`,
        checksFit: true,
        screenshot: 'subagent-lines',
      },
      {
        keys: ['<C-c>'],
        expect: `[agents] lines in ${SELFTEST_PROJECT_NAME}: 0`,
        why: 'Interrupt sends agentFinished for each running subagent, so the roster empties.',
      },
    ],
  },
];

// Each run launches a new chat session in the project folder with a plain
// first message, and the steps send the agents text by keys: a launch that
// spawned the subagents would log the two lines before any step began waiting.
// An earlier run's row stays open, its lines gone after its interrupt; only
// the new row's count changes, so the waits stay exact.
export function agentsSelfTestScript(deps: AgentsSelfTestDeps): SelfTestScript {
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
    // A line's description, and each of the transcript's live activity steps
    // (the Agent calls carry the subagents' prompts), end in an ellipsis
    // inside their own boxes, as their CSS says.
    scrollsItself: ['.agents-line-description', '.chat-activity-step'],
    open() {
      made ??= makeProject().catch((error: unknown) => {
        made = null;
        throw error;
      });
      const result = made.then(async (projectDir) => {
        const sessionId = await chat.launch({
          projectDir,
          profile: 'work',
          message: { text: 'agents self-test', images: [] },
        });
        sessions.activate(sessionId);
      });
      return {
        shownLine: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        result,
      };
    },
    groups: GROUPS,
    // The log file's content is `agent-log.test.ts`'s to check.
    problems: () => [],
  };
}
