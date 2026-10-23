import path from 'node:path';
import type { AgentHarness } from '../../../contracts/agent';
import type { Files } from '../../../contracts/files';
import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  FAKE_HOLD_TEXT,
  FAKE_PAST_SESSIONS,
  FAKE_SIGN_IN_CODE,
  FAKE_TOOL_TEXT,
  type FakeAgentCall,
  type FakeAgentHarness,
  type FakeAgentProcessRecord,
  isFakeAgentHarness,
} from '../../../shared/fake-agent-harness';
import type {
  ConnectedSession,
  SessionsMainExports,
  ToolCallContext,
  ToolResult,
} from '../../sessions/contract';
import type { ChatSessions } from './chat-sessions';
import { askFixturePermission } from './fixtures';
import { PERMISSION_TOOL_NAME } from './permission-tool';

// The names of the self-test's project folders, made under the self-test's
// home so the start prompt's folder step, which leaves out missing folders,
// lists them. The fake harness spawns nothing in them. The folder's name names
// the session in every page line.
const SELFTEST_PROJECT_NAME = 'chat-selftest';
// A second session whose Chat tab the steps show while the first holds a
// pending permission.
const SECOND_PROJECT_NAME = 'chat-second';

export interface ChatSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  chat: Pick<
    ChatSessions,
    'start' | 'closed' | 'permissionToolSession' | 'sessions' | 'setArchived'
  >;
  sessions: Pick<SessionsMainExports, 'activate' | 'connect'>;
  harnesses: readonly AgentHarness[];
}

interface ChatSelfTestResult {
  // The self-test project's folder.
  selftest: string;
  permission: ToolResult;
  // Null when no fake process was found to join.
  round: ToolResult | null;
}

const ROUND_HEADING = 'Chat self-test round';

const PERMISSION_INPUT = { command: 'rm selftest.txt' };
const ALLOW_REPLY = JSON.stringify({
  behavior: 'allow',
  updatedInput: PERMISSION_INPUT,
});

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

// Thirty paragraphs, so the message and its echo make the transcript several
// sheets tall.
const LONG_PARAGRAPHS = Array.from(
  { length: 30 },
  (_, index) => `${index + 1}`,
);
const LONG_TEXT = LONG_PARAGRAPHS.join('\n\n');
// Enter in insert mode breaks the line.
const LONG_KEYS = [
  'i',
  ...LONG_PARAGRAPHS.flatMap((paragraph, index) => [
    ...(index === 0 ? [] : ['Enter', 'Enter']),
    ...paragraph,
  ]),
  'Escape',
  'Enter',
];

// The line an account command's notice adds; the notice's text is not logged.
const NOTICE_LINE = '[chat] notice entry added in chat-selftest';
const SIGN_IN_LINK_LINE = '[chat] sign-in link shown for work';
// Main's line for a sign-in that ended with no error, so signed in.
const SIGNED_IN_LINE = '[chat] sign-in for work ended';

// Each step expects the last line its keys cause: the fake emits in microtasks,
// so an earlier line can land before the step's wait begins. Each session opens
// on its Chat tab: Option+Shift+i shows the second session's Chat tab, where y
// finds no pending permission, leaving the first session's alone, and
// Option+Shift+o goes back to the first session's Chat tab. e opens Effort, and
// showing the second session's Chat tab closes it; Space k n opens the start
// prompt, which stays open over the second session's Chat tab until Esc closes
// it, and Option+Shift+o goes back. hi typed, Esc and v leave the box in visual
// mode, and showing the second session's Chat tab blurs it; back on the first,
// i leaves visual mode and inserts before the cursor, so ok sends hoki. hello
// draws its reply; Enter in insert mode breaks the line, so one, two goes as
// one message; hello again in insert mode, sent with Cmd+Enter, draws its own;
// Esc leaves insert mode and Esc again the box. y allows the fixture's
// permission, which asks the round that takes the Chat tab over; Space Space
// opens its review and Cmd+Enter submits, which hands the Chat tab back. The
// tool turn's entries are user, tool, assistant, result, focus following the
// result, so k k j k walks them; Enter opens the tool entry, gg focuses the
// first entry and G follows the latest. A thirty-paragraph message makes the
// transcript taller than the sheet; Esc leaves the box, which resizes the
// sheet, and the following transcript stays at the bottom. Ctrl+k scrolls half
// a page up off the bottom, which stops following, and Ctrl+j back onto the
// bottom, which follows again. e opens Effort on Medium, j Enter sets High; i
// Esc puts the box in normal mode, where Space c e opens Effort again, / and
// low filter to Low, and Enter in the filter's insert mode sets it. m opens
// Mode and Esc closes it; o finds the fake has no model control; c opens every
// control and Esc closes it. A held turn ends on Ctrl+c in the box with the
// fake's notice; Space k n opens the start prompt and Esc closes it. A second
// held turn makes Cmd+W ask, and y ends the session. Space k n then picks the
// self-test's folder and the work profile, and its session step lists the
// fake's saved sessions: j x archives session one, . shows it again, k x
// restores it and . hides the archived again; Enter resumes it. / and fa offer
// the fake's command, Tab accepts it and Esc Enter sends it. The fake starts
// every profile signed in: /status reports it in a notice, /logout signs the
// work profile out and /status reports that. /login opens the sign-in dialog
// on the fake's link, its box in insert mode: Esc leaves insert mode and Esc
// again cancels, the fake's end reaching a closed dialog. /login again, the
// fake's code and Cmd+Enter sign in; /logout, /login, the code and Esc Enter,
// Enter sending from the box's normal mode, sign in again, so the profile ends
// signed in, as /status then reports. Space c x finds no attached image and Esc
// leaves the box. gg focuses the first entry, the resumed history's message
// with the fake's two images: Enter opens the viewer on the first, l steps to
// the second and stops there, h steps back and stops at the first, and Esc
// closes the viewer. Cmd+W closes the idle session without asking.
const STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  { keys: ['y'], expect: '[chat] no pending permission in chat-second' },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  { keys: ['e'], expect: '[chat] picker shown: Effort' },
  { keys: ['<A-S-i>'], expect: '[chat] picker closed: Effort' },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  { keys: [' ', 'k', 'n'], expect: '[chat] picker shown: Folder' },
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  { keys: ['Escape'], expect: '[chat] picker closed: Folder' },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  {
    keys: ['i', ...'hi', 'Escape', 'v', '<A-S-i>'],
    expect: '[chat] Chat tab shown in chat-second',
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  {
    keys: ['i', ...'ok', 'Escape', 'Enter'],
    expect: '[chat] assistant entry added in chat-selftest',
  },
  {
    keys: sendKeys('hello'),
    expect: '[chat] assistant entry added in chat-selftest',
  },
  {
    keys: ['i', ...'one', 'Enter', ...'two', 'Escape', 'Enter'],
    expect: '[chat] assistant entry added in chat-selftest',
  },
  {
    keys: ['i', ...'hello', '<D-Enter>'],
    expect: '[chat] assistant entry added in chat-selftest',
  },
  { keys: ['Escape', 'Escape'], expect: '[chat] left the box' },
  {
    keys: ['y'],
    expect: `[forms] round shown: chat-selftest · ${ROUND_HEADING}`,
  },
  { keys: [' ', ' '], expect: '[forms] review opened' },
  {
    keys: ['<D-Enter>'],
    expect: '[chat] Chat tab shown in chat-selftest',
    checksFit: true,
  },
  {
    keys: sendKeys(FAKE_TOOL_TEXT),
    expect: '[chat] result entry added in chat-selftest',
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  { keys: ['k'], expect: '[chat] focused assistant entry' },
  { keys: ['k'], expect: '[chat] focused tool entry' },
  { keys: ['j'], expect: '[chat] focused assistant entry' },
  { keys: ['k'], expect: '[chat] focused tool entry' },
  { keys: ['Enter'], expect: '[chat] expanded tool entry', checksFit: true },
  { keys: ['g', 'g'], expect: '[chat] focused the first entry' },
  { keys: ['G'], expect: '[chat] following the latest entry' },
  {
    keys: LONG_KEYS,
    expect: '[chat] assistant entry added in chat-selftest',
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  {
    keys: ['<C-k>'],
    expect: '[chat] scrolled the transcript up half a page; not following',
  },
  {
    keys: ['<C-j>'],
    expect:
      '[chat] scrolled the transcript down half a page to the bottom; following the latest entry',
  },
  { keys: ['e'], expect: '[chat] picker shown: Effort', checksFit: true },
  { keys: ['j', 'Enter'], expect: '[chat] Effort is High in chat-selftest' },
  {
    keys: ['i', 'Escape', ' ', 'c', 'e'],
    expect: '[chat] picker shown: Effort',
  },
  {
    keys: ['/', ...'low', 'Enter'],
    expect: '[chat] Effort is Low in chat-selftest',
  },
  { keys: ['m'], expect: '[chat] picker shown: Mode' },
  { keys: ['Escape'], expect: '[chat] picker closed: Mode' },
  { keys: ['o'], expect: '[chat] chat-selftest has no model control' },
  { keys: ['c'], expect: '[chat] picker shown: Controls' },
  { keys: ['Escape'], expect: '[chat] picker closed: Controls' },
  {
    keys: sendKeys(FAKE_HOLD_TEXT),
    expect: '[chat] chat-selftest is working',
  },
  { keys: ['<C-c>'], expect: '[chat] notice entry added in chat-selftest' },
  { keys: ['Escape'], expect: '[chat] left the box' },
  {
    keys: [' ', 'k', 'n'],
    expect: '[chat] picker shown: Folder',
    checksFit: true,
  },
  { keys: ['Escape'], expect: '[chat] picker closed: Folder' },
  {
    keys: sendKeys(FAKE_HOLD_TEXT),
    expect: '[chat] chat-selftest is working',
  },
  {
    keys: ['<D-w>'],
    expect: '[chat] closing the session asks to end chat-selftest',
    checksFit: true,
  },
  { keys: ['y'], expect: '[chat] session closed: chat-selftest' },
  { keys: [' ', 'k', 'n'], expect: '[chat] picker shown: Folder' },
  { keys: ['Enter'], expect: '[chat] picker shown: Profile' },
  {
    keys: ['Enter'],
    expect: '[chat] picker shown: Session',
    checksFit: true,
  },
  { keys: ['j', 'x'], expect: '[chat] archived fake past session one' },
  {
    keys: ['.'],
    expect: '[chat] archived sessions shown',
    checksFit: true,
  },
  { keys: ['k', 'x'], expect: '[chat] restored fake past session one' },
  { keys: ['.'], expect: '[chat] archived sessions hidden' },
  {
    keys: ['Enter'],
    expect: '[chat] Chat tab shown in chat-selftest',
    checksFit: true,
  },
  {
    keys: ['/', 'f', 'a'],
    expect: '[chat] completions offered: /fake-command',
  },
  { keys: ['Tab'], expect: '[chat] completion accepted: /fake-command' },
  {
    keys: ['Escape', 'Enter'],
    expect: '[chat] result entry added in chat-selftest',
  },
  { keys: sendKeys('/status'), expect: NOTICE_LINE },
  { keys: sendKeys('/logout'), expect: NOTICE_LINE },
  { keys: sendKeys('/status'), expect: NOTICE_LINE },
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE, checksFit: true },
  {
    keys: ['Escape', 'Escape'],
    expect: '[chat] sign-in for work ended with its dialog closed',
  },
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE },
  {
    keys: [...FAKE_SIGN_IN_CODE, '<D-Enter>'],
    expect: SIGNED_IN_LINE,
  },
  { keys: sendKeys('/logout'), expect: NOTICE_LINE },
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE },
  {
    keys: [...FAKE_SIGN_IN_CODE, 'Escape', 'Enter'],
    expect: SIGNED_IN_LINE,
  },
  { keys: sendKeys('/status'), expect: NOTICE_LINE },
  { keys: [' ', 'c', 'x'], expect: '[chat] no attached image' },
  { keys: ['Escape'], expect: '[chat] left the box' },
  { keys: ['g', 'g'], expect: '[chat] focused the first entry' },
  {
    keys: ['Enter'],
    expect: '[chat] image viewer showing 1 of 2',
    checksFit: true,
  },
  { keys: ['l'], expect: '[chat] image viewer showing 2 of 2' },
  { keys: ['l'], expect: '[chat] no next image' },
  { keys: ['h'], expect: '[chat] image viewer showing 1 of 2' },
  { keys: ['h'], expect: '[chat] no previous image' },
  { keys: ['Escape'], expect: '[chat] image viewer closed' },
  { keys: ['<D-w>'], expect: '[chat] session closed: chat-selftest' },
];

// Raw JSON and tool output scroll in their own box, as code and tables do, and
// a row's status ends in an ellipsis.
const SCROLLS_ITSELF = [
  '.chat-json',
  '.chat-tool-result',
  '.md pre',
  '.md table',
  '.session-row-status',
];

// The calls STEPS cause on the fixture's fake process, in order.
const EXPECTED_CALLS: FakeAgentCall[] = [
  { method: 'send', text: 'hoki', imageCount: 0 },
  { method: 'send', text: 'hello', imageCount: 0 },
  { method: 'send', text: 'one\ntwo', imageCount: 0 },
  { method: 'send', text: 'hello', imageCount: 0 },
  { method: 'send', text: FAKE_TOOL_TEXT, imageCount: 0 },
  { method: 'send', text: LONG_TEXT, imageCount: 0 },
  { method: 'setControl', id: 'effort', value: 'high' },
  { method: 'setControl', id: 'effort', value: 'low' },
  { method: 'send', text: FAKE_HOLD_TEXT, imageCount: 0 },
  { method: 'interrupt' },
  { method: 'send', text: FAKE_HOLD_TEXT, imageCount: 0 },
  { method: 'end' },
];

// The saved session the steps resume, the first of the fake's.
const RESUMED_SESSION_ID = '00000000-0000-4000-8000-000000000001';

// The calls STEPS cause on the resumed session's fake process, in order.
const EXPECTED_RESUMED_CALLS: FakeAgentCall[] = [
  { method: 'send', text: '/fake-command ', imageCount: 0 },
  { method: 'end' },
];

// The round the fixture's permission answer asks in the first session. Each
// run's differs in its context, so a later run never opens pre-filled from an
// earlier run's saved draft.
function chatRound(run: number) {
  return {
    heading: ROUND_HEADING,
    overview: 'Takes over the Chat tab until submitted.',
    notices: [],
    questions: [
      {
        title: 'Back to chat',
        context: `Run ${run}: submitted untouched.`,
        question: 'Pick one.',
        choices: ['Yes', 'No'],
        recommend: 1,
        rationale: 'Yes is the default.',
      },
    ],
  };
}

const toolCallContext = (): ToolCallContext => ({
  toolUseId: null,
  signal: new AbortController().signal,
});

// Each fake harness with how many records it held when this run opened: a
// fake keeps its records for the app's whole life, and the scripts run again
// on every page load, so a run reads only the records past its mark.
interface RunMark {
  harness: FakeAgentHarness;
  processes: number;
  pastSessionCalls: number;
}

const markRun = (harnesses: readonly AgentHarness[]): RunMark[] =>
  harnesses.filter(isFakeAgentHarness).map((harness) => ({
    harness,
    processes: harness.processes.length,
    pastSessionCalls: harness.pastSessionCalls.length,
  }));

// The last fake process this run started for the self-test's project, resumed
// or new.
function selftestProcess(
  marks: readonly RunMark[],
  projectDir: string,
  resume: boolean,
): FakeAgentProcessRecord | null {
  const records = marks
    .flatMap((mark) => mark.harness.processes.slice(mark.processes))
    .filter(
      (record) =>
        record.request.projectDir === projectDir &&
        record.request.resume === resume,
    );
  return records.at(-1) ?? null;
}

function fixtureProblems(
  { permission, round }: ChatSelfTestResult,
  process: FakeAgentProcessRecord | null,
  projectDir: string,
): string[] {
  const reply = permission.content[0]?.text;
  const problems: string[] = [];
  if (permission.isError === true) {
    problems.push(`${PERMISSION_TOOL_NAME} failed: ${reply}`);
  }
  if (reply !== ALLOW_REPLY) {
    problems.push(`permission reply ${reply}`);
  }
  if (process === null || round === null) {
    problems.push(`no fake process for ${projectDir}`);
    return problems;
  }
  const outcome = round.structuredContent?.outcome;
  if (round.isError === true) {
    problems.push(`ask_round failed: ${round.content[0]?.text}`);
  } else if (outcome !== 'submitted') {
    problems.push(`round outcome ${String(outcome)}`);
  }
  const calls = JSON.stringify(process.calls);
  if (calls !== JSON.stringify(EXPECTED_CALLS)) {
    problems.push(`fake calls ${calls}`);
  }
  if (!process.ended) {
    problems.push('fake process not ended');
  }
  return problems;
}

function resumedProblems(
  process: FakeAgentProcessRecord | null,
  projectDir: string,
): string[] {
  if (process === null) {
    return ['no resumed fake process'];
  }
  const problems: string[] = [];
  const { request } = process;
  const resumesSessionOne =
    request.sessionId === RESUMED_SESSION_ID &&
    request.resume &&
    request.projectDir === projectDir;
  if (!resumesSessionOne) {
    problems.push(`resumed request ${JSON.stringify(request)}`);
  }
  const calls = JSON.stringify(process.calls);
  if (calls !== JSON.stringify(EXPECTED_RESUMED_CALLS)) {
    problems.push(`resumed calls ${calls}`);
  }
  return problems;
}

// Reads only this run's calls.
function pastSessionProblems(
  marks: readonly RunMark[],
  projectDir: string,
): string[] {
  const calls = marks.flatMap((mark) =>
    mark.harness.pastSessionCalls.slice(mark.pastSessionCalls),
  );
  const listedSelftestFolder = calls.some(
    (call) => call.method === 'listSessions' && call.projectDir === projectDir,
  );
  const readResumedHistory = calls.some(
    (call) =>
      call.method === 'history' &&
      call.sessionId === RESUMED_SESSION_ID &&
      call.projectDir === projectDir,
  );
  if (listedSelftestFolder && readResumedHistory) {
    return [];
  }
  return [`past session calls ${JSON.stringify(calls)}`];
}

// The self-test's two project folders.
interface SelfTestProjects {
  selftest: string;
  second: string;
}

// Makes both self-test project folders under the home's real path, the one
// the page shows as `~`, then starts two chat sessions each run, first closing
// every session chat holds in a self-test project (a resumed one included)
// and unarchiving the fake's saved sessions: the second project's, then the
// self-test's, whose Chat tab it shows. Asks one permission prompt through
// chat's tool in the self-test's session, which the steps allow; the answer
// asks a forms round there over a relay that joins the session, which the
// steps submit. The result is both calls' replies and the self-test project's
// folder; problems reads the fake processes, whose records the steps keep
// changing in place, when it runs, reading only the records this run added.
// The run waits on the session's Chat tab being shown.
export function chatSelfTestScript(deps: ChatSelfTestDeps): SelfTestScript {
  const { chat, sessions, harnesses, files } = deps;
  // Cleared when making them fails, so a later run tries again.
  let made: Promise<SelfTestProjects> | null = null;
  let previousRelay: ConnectedSession | null = null;
  let archiveResetFailures: string[] = [];
  let marks: RunMark[] = [];

  async function makeProjects(): Promise<SelfTestProjects> {
    const home = await files.realPath(deps.homeDir);
    const madeProjects = {
      selftest: path.join(home, SELFTEST_PROJECT_NAME),
      second: path.join(home, SECOND_PROJECT_NAME),
    };
    await files.makeFolder(madeProjects.selftest);
    await files.makeFolder(madeProjects.second);
    return madeProjects;
  }

  // Closes every session an earlier run left open in a self-test project.
  function closeEarlierSessions({ selftest, second }: SelfTestProjects) {
    for (const state of chat.sessions()) {
      if ([selftest, second].includes(state.projectDir)) {
        chat.closed(state.sessionId);
      }
    }
  }

  function openSessions(
    run: number,
    { selftest, second }: SelfTestProjects,
  ): Promise<ChatSelfTestResult> {
    chat.start({ projectDir: second, profile: 'work' });
    const id = chat.start({ projectDir: selftest, profile: 'work' });
    sessions.activate(id);
    const process = selftestProcess(marks, selftest, false);
    const permission = askFixturePermission(chat, id, selftest, {
      toolName: 'Bash',
      input: PERMISSION_INPUT,
      toolUseId: 'selftest-tool-use',
    });
    return permission.then(async (reply): Promise<ChatSelfTestResult> => {
      if (process === null) {
        return { selftest, permission: reply, round: null };
      }
      const relay = sessions.connect({
        sessionId: process.request.sessionId,
        projectDir: selftest,
        deadlineSeconds: null,
        harness: 'claude',
      });
      previousRelay = relay;
      const round = await relay.call(
        'ask_round',
        chatRound(run),
        toolCallContext(),
      );
      return { selftest, permission: reply, round };
    });
  }

  function runProblems(result: ChatSelfTestResult): string[] {
    const { selftest } = result;
    return [
      ...fixtureProblems(
        result,
        selftestProcess(marks, selftest, false),
        selftest,
      ),
      ...resumedProblems(selftestProcess(marks, selftest, true), selftest),
      ...pastSessionProblems(marks, selftest),
    ];
  }

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: SCROLLS_ITSELF,
    open(run) {
      marks = markRun(harnesses);
      previousRelay?.end();
      const failures: string[] = [];
      archiveResetFailures = failures;
      for (const past of FAKE_PAST_SESSIONS) {
        chat.setArchived(past.sessionId, false).catch((error: unknown) => {
          failures.push(`archive reset failed: ${errorText(error)}`);
        });
      }
      made ??= makeProjects().catch((error: unknown) => {
        made = null;
        throw error;
      });
      const result = made.then((madeProjects) => {
        closeEarlierSessions(madeProjects);
        return openSessions(run, madeProjects);
      });
      return {
        shownLine: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        result,
      };
    },
    steps: STEPS,
    problems: (result) => [
      ...archiveResetFailures,
      ...runProblems(result as ChatSelfTestResult),
    ],
  };
}
