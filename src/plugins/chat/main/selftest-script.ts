import path from 'node:path';
import type { AgentHarness } from '../../../contracts/agent';
import type { Files } from '../../../contracts/files';
import type {
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  FAKE_END_TEXT,
  FAKE_HOLD_TEXT,
  FAKE_PAST_SESSIONS,
  FAKE_SIGN_IN_CODE,
  FAKE_TOOL_TEXT,
  type FakeAgentCall,
  type FakeAgentProcessRecord,
  markRun,
  type RunMark,
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
// The dialog's line for a sign-in that ended with no error, signed in.
const SIGNED_IN_LINE = '[chat] signed in to work';

// Each step expects the last line its keys cause: the fake emits in microtasks,
// so an earlier line can land before the step's wait begins. Each session opens
// on its Chat tab, and the first session holds the fixture's pending
// permission.
const TWO_SESSIONS_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  {
    keys: ['y'],
    expect: '[chat] no pending permission in chat-second',
    why: "The first session's pending permission stays pending.",
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  { keys: ['e'], expect: '[chat] picker shown: Effort' },
  { keys: ['<A-S-i>'], expect: '[chat] picker closed: Effort' },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  { keys: [' ', 'k', 'n'], expect: '[chat] picker shown: Folder' },
  {
    keys: ['<A-S-i>'],
    expect: '[chat] Chat tab shown in chat-second',
    why: "The start prompt stays open over the second session's Chat tab.",
  },
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
    why: 'Back on the first session, i leaves visual mode and inserts before the cursor, so ok sends hoki.',
  },
];

// The second session's process ends here, leaving its row resting until the
// next message there starts it again; its processes' calls are not checked.
const RESTING_SESSION_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  { keys: sendKeys(FAKE_END_TEXT), expect: '[chat] chat-second rested' },
  {
    keys: [' ', 'c', 'e'],
    expect: '[chat] chat-second has no running process',
    why: "The resting tab's box opens no control picker.",
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  {
    keys: ['j'],
    expect: '[chat] focused notice entry',
    why: 'The exit notice follows the sent message.',
  },
  {
    keys: sendKeys('again'),
    expect: '[chat] assistant entry added in chat-second',
    why: 'The send starts the process again in the same row.',
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
];

const SENDING_STEPS: SelfTestStep[] = [
  {
    keys: sendKeys('hello'),
    expect: '[chat] assistant entry added in chat-selftest',
  },
  {
    keys: ['i', ...'one', 'Enter', ...'two', 'Escape', 'Enter'],
    expect: '[chat] assistant entry added in chat-selftest',
    why: 'Enter in insert mode breaks the line, so one and two go as one message.',
  },
  {
    keys: ['i', ...'hello', '<D-Enter>'],
    expect: '[chat] assistant entry added in chat-selftest',
  },
  { keys: ['Escape', 'Escape'], expect: '[chat] left the box' },
];

const PERMISSION_CARD_STEPS: SelfTestStep[] = [
  {
    keys: ['y'],
    expect: `[forms] form shown: chat-selftest · ${ROUND_HEADING}`,
  },
  { keys: [' ', ' '], expect: '[forms] review opened' },
  {
    keys: ['<D-Enter>'],
    expect: '[chat] Chat tab shown in chat-selftest',
    checksFit: true,
  },
];

const TRANSCRIPT_FOCUS_STEPS: SelfTestStep[] = [
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
];

const TRANSCRIPT_SCROLL_STEPS: SelfTestStep[] = [
  {
    keys: LONG_KEYS,
    expect: '[chat] assistant entry added in chat-selftest',
  },
  {
    keys: ['Escape'],
    expect: '[chat] left the box',
    why: 'Leaving the box resizes the sheet, and the transcript stays at the bottom, following.',
  },
  {
    keys: ['<C-S-k>'],
    expect: '[chat] scrolled the transcript up half a page; not following',
  },
  {
    keys: ['<C-S-j>'],
    expect:
      '[chat] scrolled the transcript down half a page to the bottom; following the latest entry',
  },
  {
    keys: ['<C-k>'],
    expect: '[chat] scrolled the transcript up a line; not following',
  },
  {
    keys: ['<C-j>'],
    expect:
      '[chat] scrolled the transcript down a line to the bottom; following the latest entry',
  },
];

const CONTROLS_STEPS: SelfTestStep[] = [
  { keys: ['e'], expect: '[chat] picker shown: Effort', checksFit: true },
  {
    keys: ['j', 'Enter'],
    expect: '[chat] Effort is High in chat-selftest',
    why: 'Effort opens on Medium, so j picks High.',
  },
  {
    keys: ['i', 'Escape', ' ', 'c', 'e'],
    expect: '[chat] picker shown: Effort',
  },
  {
    keys: ['/', ...'low', 'Enter'],
    expect: '[chat] Effort is Low in chat-selftest',
    why: "Enter in the filter's insert mode sets the filtered choice.",
  },
  { keys: ['m'], expect: '[chat] picker shown: Mode' },
  { keys: ['Escape'], expect: '[chat] picker closed: Mode' },
  { keys: ['o'], expect: '[chat] picker shown: Model' },
  { keys: ['Escape'], expect: '[chat] picker closed: Model' },
  { keys: ['c'], expect: '[chat] picker shown: Controls' },
  { keys: ['Escape'], expect: '[chat] picker closed: Controls' },
];

const INTERRUPT_AND_CLOSE_STEPS: SelfTestStep[] = [
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
];

const RESUME_LIST_STEPS: SelfTestStep[] = [
  { keys: [' ', 'k', 'n'], expect: '[chat] picker shown: Folder' },
  {
    keys: ['/', ...SELFTEST_PROJECT_NAME, 'Enter'],
    expect: '[chat] picker shown: Profile',
    why: "The second session's restart made its folder the newest, so the filter picks the self-test's.",
  },
  {
    keys: ['Enter'],
    expect: '[chat] picker shown: Session',
    checksFit: true,
  },
];

const ARCHIVE_STEPS: SelfTestStep[] = [
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
    why: 'Enter resumes the restored session one.',
  },
];

const SLASH_COMPLETION_STEPS: SelfTestStep[] = [
  {
    keys: ['/', 'f', 'a'],
    expect: '[chat] completions offered: /fake-command',
  },
  { keys: ['Tab'], expect: '[chat] completion accepted: /fake-command' },
  {
    keys: ['Escape', 'Enter'],
    expect: '[chat] result entry added in chat-selftest',
  },
];

const ACCOUNT_STATUS_STEPS: SelfTestStep[] = [
  { keys: sendKeys('/status'), expect: NOTICE_LINE },
  { keys: sendKeys('/logout'), expect: NOTICE_LINE },
  { keys: sendKeys('/status'), expect: NOTICE_LINE },
];

const SIGN_IN_STEPS: SelfTestStep[] = [
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE, checksFit: true },
  {
    keys: ['Escape', ' ', 'c', 'y'],
    expect: '[chat] sign-in link copied',
    why: "The dialog's box opens in insert mode, so Esc leaves insert mode before Space c y.",
  },
  {
    keys: ['Escape'],
    expect: '[chat] sign-in for work ended: Sign-in cancelled',
    why: 'Main logs the cancelled end, which it sends the page nothing for.',
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
  { keys: sendKeys('/logout'), expect: NOTICE_LINE },
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE },
  { keys: [...FAKE_SIGN_IN_CODE, 'Enter'], expect: SIGNED_IN_LINE },
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE },
  {
    keys: ['x', 'Enter'],
    expect: '[chat] sign-in failed for work: Wrong code',
  },
  {
    keys: sendKeys('/status'),
    expect: NOTICE_LINE,
    why: 'The profile still reads signed in after the wrong code.',
  },
];

const IMAGES_STEPS: SelfTestStep[] = [
  { keys: [' ', 'c', 'x'], expect: '[chat] no attached image' },
  { keys: ['Escape'], expect: '[chat] left the box' },
  { keys: ['g', 'g'], expect: '[chat] focused the first entry' },
  {
    keys: ['Enter'],
    expect: '[chat] image viewer showing 1 of 2',
    checksFit: true,
    why: "The first entry is the resumed history's message with the fake's two images.",
  },
  { keys: ['l'], expect: '[chat] image viewer showing 2 of 2' },
  { keys: ['l'], expect: '[chat] no next image' },
  { keys: ['h'], expect: '[chat] image viewer showing 1 of 2' },
  { keys: ['h'], expect: '[chat] no previous image' },
  { keys: ['Escape'], expect: '[chat] image viewer closed' },
];

const IDLE_CLOSE_STEPS: SelfTestStep[] = [
  { keys: ['<D-w>'], expect: '[chat] session closed: chat-selftest' },
];

// The preview row is named after its folder, `Chat preview`.
const LAYOUT_PREVIEW_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'z', 'l', 'c'],
    expect: '[chat] Chat tab shown in Chat preview',
    screenshot: 'chat-preview',
  },
  {
    keys: sendKeys('hi'),
    expect: '[chat] send failed: the chat preview sends nothing',
  },
  {
    keys: ['Escape', ' ', ';'],
    expect: '[chat] session closed: Chat preview',
    why: 'Esc leaves the box, then Space ; closes the session.',
  },
];

const GROUPS: SelfTestGroup[] = [
  {
    name: 'two sessions',
    why: "Each session keeps its own state across switching Chat tabs: y in the second leaves the first's permission alone, a picker closes, the start prompt stays open, and a box left in visual mode keeps its text and cursor across a blur.",
    steps: TWO_SESSIONS_STEPS,
  },
  {
    name: 'resting session',
    why: "fake: end leaves the second session resting in its row, where the box's control keys log that no process runs, Esc still leaves the box, j still moves through the entries, and the next message starts the process again in place.",
    steps: RESTING_SESSION_STEPS,
  },
  {
    name: 'sending',
    why: 'Enter in normal mode and Cmd+Enter in insert mode send from the box, each message drawing its reply, and Esc leaves insert mode then the box.',
    steps: SENDING_STEPS,
  },
  {
    name: 'permission card',
    why: "y allows the fixture's permission, whose answer asks a round that takes the Chat tab over until Cmd+Enter submits it from its review.",
    steps: PERMISSION_CARD_STEPS,
  },
  {
    name: 'transcript focus',
    why: "A tool turn's entries are user, tool, assistant and result, focus following the result: k and j walk them, Enter opens the tool entry, gg focuses the first entry and G follows the latest.",
    steps: TRANSCRIPT_FOCUS_STEPS,
  },
  {
    name: 'transcript scroll',
    why: 'A thirty-paragraph message makes the transcript taller than the sheet; scrolling half a page or a line up off the bottom stops following, and back onto the bottom follows again.',
    steps: TRANSCRIPT_SCROLL_STEPS,
  },
  {
    name: 'session controls',
    why: "The Effort picker sets the session's effort from the transcript and from the box's normal mode, its filter included; Mode, Model and Controls open and close.",
    steps: CONTROLS_STEPS,
  },
  {
    name: 'interrupt and close',
    why: "Ctrl+c in the box ends a held turn with the fake's notice, and Cmd+W on a working session asks before y ends it.",
    steps: INTERRUPT_AND_CLOSE_STEPS,
  },
  {
    name: 'resume list',
    why: "The start prompt's folder step, filtered to the self-test's folder, and profile step lead to a session step listing the fake's saved sessions for the self-test's folder.",
    steps: RESUME_LIST_STEPS,
  },
  {
    name: 'archive',
    why: 'x archives and restores a saved session in the resume list, . shows and hides the archived ones, and Enter resumes the restored session.',
    steps: ARCHIVE_STEPS,
  },
  {
    name: 'slash completion',
    why: "/ and fa offer the fake's command, Tab accepts it and Esc Enter sends it.",
    steps: SLASH_COMPLETION_STEPS,
  },
  {
    name: 'account status',
    why: 'The fake starts every profile signed in: /status reports it in a notice, /logout signs the work profile out and /status reports that.',
    steps: ACCOUNT_STATUS_STEPS,
  },
  {
    name: 'sign-in',
    why: "/login opens the sign-in dialog on the fake's link, which Space c y copies and Esc cancels; the fake's code signs in sent with Cmd+Enter, Enter from normal mode and Enter from insert mode, and a wrong code fails.",
    steps: SIGN_IN_STEPS,
  },
  {
    name: 'images',
    why: "Space c x finds no attached image; the image viewer opens on the first of a message's two images, steps between them and stops at either end, and Esc closes it.",
    steps: IMAGES_STEPS,
  },
  {
    name: 'idle close',
    why: 'Cmd+W closes an idle session without asking.',
    steps: IDLE_CLOSE_STEPS,
  },
  {
    name: 'layout preview',
    why: 'Space z l c opens the sample session with no agent, and a send there sends nothing.',
    steps: LAYOUT_PREVIEW_STEPS,
  },
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

// The calls the steps cause on the fixture's fake process, in order.
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

// The calls the steps cause on the resumed session's fake process, in order.
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
    groups: GROUPS,
    problems: (result) => [
      ...archiveResetFailures,
      ...runProblems(result as ChatSelfTestResult),
    ],
  };
}
