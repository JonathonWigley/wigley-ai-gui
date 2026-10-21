import type { AgentHarness } from '../../../contracts/agent';
import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  FAKE_HOLD_TEXT,
  FAKE_PAST_SESSIONS,
  FAKE_TOOL_TEXT,
  type FakeAgentCall,
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
import { PERMISSION_TOOL_NAME } from './permission-tool';

// Never read: the fake harness spawns nothing. Its last segment names the
// session in every page line.
export const SELFTEST_PROJECT_DIR = '/selftest/chat-selftest';
// A second session whose Chat tab the steps show while the first holds a
// pending permission.
const SECOND_PROJECT_DIR = '/selftest/chat-second';

export interface ChatSelfTestDeps {
  chat: Pick<
    ChatSessions,
    'start' | 'closed' | 'permissionToolSession' | 'sessions' | 'setArchived'
  >;
  sessions: Pick<SessionsMainExports, 'activate' | 'connect'>;
  harnesses: readonly AgentHarness[];
}

interface ChatSelfTestResult {
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

// Each step expects the last line its keys cause: the fake emits in microtasks,
// so an earlier line can land before the step's wait begins. Each session
// opens on its Chat tab: Option+Shift+i shows the second session's Chat tab,
// where y finds no pending permission, leaving the first session's alone, and
// Option+Shift+o goes back to the first session's Chat tab. Space c e
// opens Effort, and showing the second session's Chat tab closes it; Space k n
// opens the start prompt, which stays open over the second session's Chat tab
// until Esc closes it, and Option+Shift+o goes back. hi typed, Esc and v leave
// the box in visual mode, and showing the second session's Chat tab blurs it;
// back on the first, i leaves visual mode and inserts before the cursor, so ok
// sends hoki. hello draws its reply; Enter in insert mode breaks the line, so
// one, two goes as one message; hello again in insert mode, sent with
// Cmd+Enter, draws its own; Esc leaves insert mode and Esc again the box. y
// allows the fixture's permission, which asks the round that takes the Chat tab
// over; Space Space opens its review and Space Enter submits, which hands the
// Chat tab back. The tool turn's entries are user, tool, assistant, result,
// focus following the result, so k k j k walks them; Enter opens the tool entry
// and G follows the latest. Space c e opens Effort on Medium, j Enter sets
// High; Space c e again, / and low filter to Low, and Enter in the filter's
// insert mode sets it. A held turn ends on Ctrl+c in the box with the fake's
// notice; Space k n opens the start prompt and Esc closes it. A second held
// turn makes Cmd+W ask, and y ends the session. Space k n then picks the
// self-test's folder and the work profile, and its session step lists the
// fake's saved sessions: j x archives session one, . shows it again, k x
// restores it and . hides the archived again; Enter resumes it. / and fa offer
// the fake's command, Tab accepts it, Esc Enter sends it, Esc leaves the box,
// and Cmd+W closes the idle session without asking.
const STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  { keys: ['y'], expect: '[chat] no pending permission in chat-second' },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  { keys: [' ', 'c', 'e'], expect: '[chat] picker shown: Effort' },
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
    keys: [' ', 'Enter'],
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
  { keys: ['G'], expect: '[chat] following the latest entry' },
  {
    keys: [' ', 'c', 'e'],
    expect: '[chat] picker shown: Effort',
    checksFit: true,
  },
  { keys: ['j', 'Enter'], expect: '[chat] Effort is High in chat-selftest' },
  { keys: [' ', 'c', 'e'], expect: '[chat] picker shown: Effort' },
  {
    keys: ['/', ...'low', 'Enter'],
    expect: '[chat] Effort is Low in chat-selftest',
  },
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
  { keys: ['Escape'], expect: '[chat] left the box' },
  { keys: ['<D-w>'], expect: '[chat] session closed: chat-selftest' },
];

// Raw JSON and tool output scroll in their own box, as code and tables do, and
// row and tab titles end in an ellipsis.
const SCROLLS_ITSELF = [
  '.chat-json',
  '.chat-tool-result',
  '.md pre',
  '.md table',
  '.session-row-label',
  '.session-row-status',
  '.session-tab-label',
];

// The calls STEPS cause on the fixture's fake process, in order.
const EXPECTED_CALLS: FakeAgentCall[] = [
  { method: 'send', text: 'hoki' },
  { method: 'send', text: 'hello' },
  { method: 'send', text: 'one\ntwo' },
  { method: 'send', text: 'hello' },
  { method: 'send', text: FAKE_TOOL_TEXT },
  { method: 'setControl', id: 'effort', value: 'high' },
  { method: 'setControl', id: 'effort', value: 'low' },
  { method: 'send', text: FAKE_HOLD_TEXT },
  { method: 'interrupt' },
  { method: 'send', text: FAKE_HOLD_TEXT },
  { method: 'end' },
];

// The saved session the steps resume, the first of the fake's.
const RESUMED_SESSION_ID = '00000000-0000-4000-8000-000000000001';

// The calls STEPS cause on the resumed session's fake process, in order.
const EXPECTED_RESUMED_CALLS: FakeAgentCall[] = [
  { method: 'send', text: '/fake-command ' },
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

const toolCallContext = (toolUseId: string | null): ToolCallContext => ({
  toolUseId,
  signal: new AbortController().signal,
});

const fakeHarnesses = (harnesses: readonly AgentHarness[]) =>
  harnesses.filter(isFakeAgentHarness);

// The last fake process started for the self-test's project, resumed or new.
function selftestProcess(
  harnesses: readonly AgentHarness[],
  resume: boolean,
): FakeAgentProcessRecord | null {
  const records = fakeHarnesses(harnesses)
    .flatMap((harness) => harness.processes)
    .filter(
      (record) =>
        record.request.projectDir === SELFTEST_PROJECT_DIR &&
        record.request.resume === resume,
    );
  return records.at(-1) ?? null;
}

function fixtureProblems(
  { permission, round }: ChatSelfTestResult,
  process: FakeAgentProcessRecord | null,
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
    problems.push(`no fake process for ${SELFTEST_PROJECT_DIR}`);
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

function resumedProblems(process: FakeAgentProcessRecord | null): string[] {
  if (process === null) {
    return ['no resumed fake process'];
  }
  const problems: string[] = [];
  const { request } = process;
  const resumesSessionOne =
    request.sessionId === RESUMED_SESSION_ID &&
    request.resume &&
    request.projectDir === SELFTEST_PROJECT_DIR;
  if (!resumesSessionOne) {
    problems.push(`resumed request ${JSON.stringify(request)}`);
  }
  const calls = JSON.stringify(process.calls);
  if (calls !== JSON.stringify(EXPECTED_RESUMED_CALLS)) {
    problems.push(`resumed calls ${calls}`);
  }
  return problems;
}

function pastSessionProblems(harnesses: readonly AgentHarness[]): string[] {
  const calls = fakeHarnesses(harnesses).flatMap(
    (harness) => harness.pastSessionCalls,
  );
  const listedSelftestFolder = calls.some(
    (call) =>
      call.method === 'listSessions' &&
      call.projectDir === SELFTEST_PROJECT_DIR,
  );
  const readResumedHistory = calls.some(
    (call) =>
      call.method === 'history' &&
      call.sessionId === RESUMED_SESSION_ID &&
      call.projectDir === SELFTEST_PROJECT_DIR,
  );
  if (listedSelftestFolder && readResumedHistory) {
    return [];
  }
  return [`past session calls ${JSON.stringify(calls)}`];
}

// Every self-test project, whose sessions an earlier run may have left open.
const SELFTEST_PROJECT_DIRS = [SELFTEST_PROJECT_DIR, SECOND_PROJECT_DIR];

// Starts two chat sessions each run, first closing every session chat holds in
// a self-test project (a resumed one included) and unarchiving the fake's
// saved sessions: the second project's, then the self-test's, whose Chat tab
// it shows. Asks one permission prompt through chat's tool in the self-test's
// session, which the steps allow; the answer asks a forms round there over a
// relay that joins the session, which the steps submit. The result is both
// calls' replies; problems reads the fake processes, whose records the steps
// keep changing in place, when it runs. The run waits on the session's Chat
// tab being shown.
export function chatSelfTestScript(deps: ChatSelfTestDeps): SelfTestScript {
  const { chat, sessions, harnesses } = deps;
  let previousRelay: ConnectedSession | null = null;
  let archiveResetFailures: string[] = [];
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: SCROLLS_ITSELF,
    open(run) {
      previousRelay?.end();
      for (const state of chat.sessions()) {
        if (SELFTEST_PROJECT_DIRS.includes(state.projectDir)) {
          chat.closed(state.sessionId);
        }
      }
      const failures: string[] = [];
      archiveResetFailures = failures;
      for (const past of FAKE_PAST_SESSIONS) {
        chat.setArchived(past.sessionId, false).catch((error: unknown) => {
          failures.push(`archive reset failed: ${errorText(error)}`);
        });
      }
      chat.start({
        projectDir: SECOND_PROJECT_DIR,
        profile: 'work',
      });
      const id = chat.start({
        projectDir: SELFTEST_PROJECT_DIR,
        profile: 'work',
      });
      sessions.activate(id);
      const process = selftestProcess(harnesses, false);
      const permission = chat
        .permissionToolSession({
          id,
          info: {
            sessionId: null,
            projectDir: SELFTEST_PROJECT_DIR,
            deadlineSeconds: null,
            harness: 'claude',
          },
        })
        .call(
          PERMISSION_TOOL_NAME,
          {
            tool_name: 'Bash',
            input: PERMISSION_INPUT,
            tool_use_id: 'selftest-tool-use',
          },
          toolCallContext('selftest-tool-use'),
        );
      const result = permission.then(
        async (reply): Promise<ChatSelfTestResult> => {
          if (process === null) {
            return { permission: reply, round: null };
          }
          const relay = sessions.connect({
            sessionId: process.request.sessionId,
            projectDir: SELFTEST_PROJECT_DIR,
            deadlineSeconds: null,
            harness: 'claude',
          });
          previousRelay = relay;
          const round = await relay.call(
            'ask_round',
            chatRound(run),
            toolCallContext(null),
          );
          return { permission: reply, round };
        },
      );
      return { shownLine: '[chat] Chat tab shown in chat-selftest', result };
    },
    steps: STEPS,
    problems: (result) => [
      ...archiveResetFailures,
      ...fixtureProblems(
        result as ChatSelfTestResult,
        selftestProcess(harnesses, false),
      ),
      ...resumedProblems(selftestProcess(harnesses, true)),
      ...pastSessionProblems(harnesses),
    ],
  };
}
