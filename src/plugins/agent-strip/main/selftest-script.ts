import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { FAKE_AGENTS_TEXT } from '../../../shared/fake-agent-harness';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every page line.
const SELFTEST_PROJECT_NAME = 'agent-strip-selftest';

export interface AgentStripSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
}

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

const boxesLine = (count: number, running: number) =>
  `[agent-strip] boxes in ${SELFTEST_PROJECT_NAME}: ${count} (${running} running)`;

const selectedLine = (index: number) =>
  `[agent-strip] selected box ${index} of 4 in ${SELFTEST_PROJECT_NAME}`;

const GROUPS: SelfTestGroup[] = [
  {
    name: 'strip keys',
    why: 'j from the last entry enters the strip on its first box, each card shows its name, kind tag and runtime, each row its Shell tag, command and runtime, l and h move through the cards and then the rows, Enter opens and closes a box, k hands the cursor back, and an interrupt ends the items so their boxes leave.',
    steps: [
      {
        keys: sendKeys(FAKE_AGENTS_TEXT),
        expect: boxesLine(4, 4),
        checksFit: true,
        screenshot: 'strip',
        why: 'The fake turn spawns two subagents and starts two tasks, and stays open.',
      },
      {
        keys: ['Escape', 'G', 'j'],
        expect: selectedLine(1),
        alsoExpect: [
          /^\[chat\] composer part agent-strip\.strip took the cursor in agent-strip-selftest$/,
          /^\[agent-strip\] box 1 of 4 in agent-strip-selftest shows: map-decoderSubagent(\d+m )?\d+s/,
        ],
        screenshot: 'strip-selected',
        why: 'G lands on the last entry, the last stop, and j from there hands the cursor to the strip, whose first box shows its name, tag and runtime.',
      },
      {
        keys: ['l'],
        expect: selectedLine(2),
        alsoExpect: [
          /^\[agent-strip\] box 2 of 4 in agent-strip-selftest shows: ExploreBackground agent(\d+m )?\d+s/,
        ],
        why: 'The launched subagent reads Background agent.',
      },
      {
        keys: ['l'],
        expect: selectedLine(3),
        alsoExpect: [
          /^\[agent-strip\] box 3 of 4 in agent-strip-selftest shows: Shellnpm run selftest.*(\d+m )?\d+s/,
        ],
        why: 'After the cards, the first row reads Shell and its command.',
      },
      {
        keys: ['l'],
        expect: selectedLine(4),
        alsoExpect: [
          /^\[agent-strip\] box 4 of 4 in agent-strip-selftest shows: Shellnpm run build -- --watch.*(\d+m )?\d+s/,
        ],
        why: "A subagent's task is a row like the main agent's: a closed row names no owner.",
      },
      { keys: ['h'], expect: selectedLine(3) },
      { keys: ['h'], expect: selectedLine(2) },
      { keys: ['h'], expect: selectedLine(1) },
      {
        keys: ['Enter'],
        expect: `[agent-strip] opened box 1 in ${SELFTEST_PROJECT_NAME}`,
        screenshot: 'strip-opened',
      },
      {
        keys: ['Enter'],
        expect: `[agent-strip] closed box 1 in ${SELFTEST_PROJECT_NAME}`,
      },
      {
        keys: ['k'],
        expect: `[agent-strip] left strip in ${SELFTEST_PROJECT_NAME}`,
        alsoExpect: [
          /^\[chat\] cursor back on the entries in agent-strip-selftest$/,
        ],
      },
      {
        keys: ['j'],
        expect: selectedLine(1),
        alsoExpect: [
          /^\[chat\] composer part agent-strip\.strip took the cursor in agent-strip-selftest$/,
        ],
        why: 'k put the cursor back on the last stop and chat holds no part, so j hands it to the strip again.',
      },
      {
        keys: ['k'],
        expect: `[agent-strip] left strip in ${SELFTEST_PROJECT_NAME}`,
        alsoExpect: [
          /^\[chat\] cursor back on the entries in agent-strip-selftest$/,
        ],
      },
      {
        keys: ['<C-c>'],
        expect: boxesLine(0, 0),
        screenshot: 'strip-finished',
        why: 'Interrupt ends each running subagent and task, so their boxes leave and the strip draws nothing.',
      },
    ],
  },
];

// Each run closes the sessions an earlier run left in the project folder, so
// the new row's label stays the folder's name, launches a chat session there
// with a plain first message, and activates its row so that a pane shows its
// Chat tab. The steps send the agents text by keys: a launch that spawned the
// subagents and tasks would log the boxes before any step began waiting.
export function agentStripSelfTestScript(
  deps: AgentStripSelfTestDeps,
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
    // A box's name, description, model line, tool lines, closed command and open
    // row's owner line end in an ellipsis inside their own boxes, an open box's
    // tool list scrolls inside its box and the rows scroll in their column, as
    // their CSS says. The activity dock's tool calls (the
    // Agent calls carry the subagents' prompts) and done line, and the session
    // row's status, end in an ellipsis inside their own boxes; the tab bar's
    // parts clip in their own box.
    scrollsItself: [
      '.agent-strip-name',
      '.agent-strip-description',
      '.agent-strip-model',
      '.agent-strip-tool',
      '.agent-strip-command',
      '.agent-strip-row-owner',
      '.agent-strip-toolList',
      '.agent-strip-rows',
      '.chat-working-action',
      '.chat-working-done',
      '.session-row-status',
      '.session-bar-parts',
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
          message: { text: 'agent-strip self-test', images: [] },
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
