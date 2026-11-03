import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { FAKE_AGENTS_TEXT } from '../../../shared/fake-agent-harness';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every page line.
const SELFTEST_PROJECT_NAME = 'agent-lines-selftest';

export interface AgentLinesSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
}

// `<Leader>zla` opens agents' sample session, and closes it while it is
// open; its session is named by its project folder. Page keys fire only while
// no editor has focus, so the first opening leaves the box with Esc.
const PREVIEW_KEYS = [' ', 'z', 'l', 'a'];
const PREVIEW_NAME = 'Agents preview';

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

// The side bar's open width (`sidebar-width`, 256px) less four 24px resize
// steps is its least width, 160px.
const SIDE_BAR_STEPS_TO_LEAST = 4;

// One side bar resize step `direction`, by `Alt+Shift+h` or `Alt+Shift+l`.
const resizeSideBar = (direction: 'Left' | 'Right') => {
  const keys = direction === 'Left' ? '<A-S-h>' : '<A-S-l>';
  return {
    keys: [keys],
    expect: `[page] ${keys} ran panes.resizePane${direction}`,
  };
};

const GROUPS: SelfTestGroup[] = [
  {
    name: 'working line',
    why: "A session whose agent spawns two subagents and starts two tasks draws one working line under its row (a running dot and the oldest item's elapsed time, counting all four); at the side bar's least width the line fits its row; an interrupt ends the session's subagents and tasks and the line goes.",
    steps: [
      {
        keys: sendKeys(FAKE_AGENTS_TEXT),
        expect: `[agent-lines] running in ${SELFTEST_PROJECT_NAME}: 4`,
        checksFit: true,
        screenshot: 'working-line',
      },
      ...Array.from({ length: SIDE_BAR_STEPS_TO_LEAST }, () =>
        resizeSideBar('Left'),
      ),
      {
        keys: ['Escape', ...PREVIEW_KEYS],
        expect: `[agent-lines] running in ${PREVIEW_NAME}: 4`,
        checksFit: 'held',
        screenshot: 'working-line-narrow',
        why: "The preview's sample roster holds an elapsed time past a minute, checked beside this run's line at the side bar's least width: the fit check at the minimum width hides the side bar.",
      },
      {
        keys: PREVIEW_KEYS,
        expect: `[sessions] activated ${SELFTEST_PROJECT_NAME}`,
        why: "Closing the preview ends its row and the pane shows this run's session again, whose box the resize keys and the interrupt reach.",
      },
      ...Array.from({ length: SIDE_BAR_STEPS_TO_LEAST }, () =>
        resizeSideBar('Right'),
      ),
      {
        keys: ['<C-c>'],
        expect: `[agent-lines] running in ${SELFTEST_PROJECT_NAME}: 0`,
        why: 'Interrupt ends each running subagent and task, so the roster marks them finished and the page draws no line.',
      },
    ],
  },
];

// Each run launches a new chat session in the project folder with a plain
// first message, and the steps send the agents text by keys: a launch that
// spawned the subagents and tasks would log the count before any step began
// waiting.
// An earlier run's row stays open, its line gone after its interrupt; only
// the new row's count changes, so the waits stay exact.
export function agentLinesSelfTestScript(
  deps: AgentLinesSelfTestDeps,
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
    // A session row's status, and each of the activity dock's tool calls (the Agent calls
    // carry the subagents' prompts), end in an ellipsis inside their own
    // boxes, as their CSS says. The tab bar's parts clip in their own box.
    // The side bar handle's resize prompt shows past its box for a second
    // after each resize step, and the split handle of the preview pane's Docs
    // tab holds its prompt, hidden until hovered, over both panes.
    scrollsItself: [
      '.session-row-status',
      '.session-bar-parts',
      '.chat-working-action',
      '.shell-side-bar-handle',
      '.ui-split-handle',
    ],
    open() {
      made ??= makeProject().catch((error: unknown) => {
        made = null;
        throw error;
      });
      const result = made.then(async (projectDir) => {
        const sessionId = await chat.launch({
          projectDir,
          profile: 'work',
          message: { text: 'agent-lines self-test', images: [] },
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
