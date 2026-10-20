import type { AgentHarness } from '../../../contracts/agent';
import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import {
  FAKE_HOLD_TEXT,
  FAKE_TOOL_TEXT,
  type FakeAgentCall,
  type FakeAgentProcessRecord,
  isFakeAgentHarness,
} from '../../../shared/fake-agent-harness';
import type { SessionsMainExports, ToolResult } from '../../sessions/contract';
import type { ChatSessions } from './chat-sessions';
import { PERMISSION_TOOL_NAME } from './permission-tool';

// Never read: the fake harness spawns nothing. Its last segment names the
// session in every page line.
export const SELFTEST_PROJECT_DIR = '/selftest/chat-selftest';

export interface ChatSelfTestDeps {
  chat: Pick<ChatSessions, 'start' | 'closed' | 'permissionToolSession'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
  harnesses: readonly AgentHarness[];
}

interface ChatSelfTestResult {
  permission: ToolResult;
  process: FakeAgentProcessRecord | null;
}

const PERMISSION_INPUT = { command: 'rm selftest.txt' };
const ALLOW_REPLY = JSON.stringify({
  behavior: 'allow',
  updatedInput: PERMISSION_INPUT,
});

// Normal-mode Enter in the box sends; its text holds no j, which would start
// the insert remap jk.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

// Each step expects the last line its keys cause: the fake emits in
// microtasks, so an earlier line can land before the step's wait begins.
// hello draws its reply; Esc leaves the box and y allows the fixture's
// permission; the tool turn's entries are user, tool, assistant, result, focus
// following the result, so k k j k walks them; Enter opens the tool entry and
// G follows the latest. Space c e opens Effort on Medium, j Enter sets High. A
// held turn ends on Ctrl+c in the box with the fake's notice; Space k n opens
// the start prompt and Esc closes it. A second held turn makes Cmd+W ask, and
// y ends the session.
const STEPS: SelfTestStep[] = [
  {
    keys: sendKeys('hello'),
    expect: '[chat] assistant entry added in chat-selftest',
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  {
    keys: ['y'],
    expect: '[chat] allowed Bash in chat-selftest',
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

// The calls STEPS cause on the fake process, in order.
const EXPECTED_CALLS: FakeAgentCall[] = [
  { method: 'send', text: 'hello' },
  { method: 'send', text: FAKE_TOOL_TEXT },
  { method: 'setControl', id: 'effort', value: 'high' },
  { method: 'send', text: FAKE_HOLD_TEXT },
  { method: 'interrupt' },
  { method: 'send', text: FAKE_HOLD_TEXT },
  { method: 'end' },
];

// The last fake process started for the self-test's project.
function selftestProcess(
  harnesses: readonly AgentHarness[],
): FakeAgentProcessRecord | null {
  const records = harnesses
    .filter(isFakeAgentHarness)
    .flatMap((harness) => harness.processes)
    .filter((record) => record.request.projectDir === SELFTEST_PROJECT_DIR);
  return records.at(-1) ?? null;
}

function resultProblems({ permission, process }: ChatSelfTestResult): string[] {
  const reply = permission.content[0]?.text;
  const problems: string[] = [];
  if (permission.isError === true) {
    problems.push(`${PERMISSION_TOOL_NAME} failed: ${reply}`);
  }
  if (reply !== ALLOW_REPLY) {
    problems.push(`permission reply ${reply}`);
  }
  if (process === null) {
    problems.push(`no fake process for ${SELFTEST_PROJECT_DIR}`);
    return problems;
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

// Starts one chat session in the self-test's project each run, closing the
// previous run's, shows its Chat tab, and asks one permission prompt through
// chat's tool, which the steps allow. The result is that call's reply and the
// session's fake process, whose record the steps keep changing in place.
export function chatSelfTestScript(deps: ChatSelfTestDeps): SelfTestScript {
  const { chat, sessions, harnesses } = deps;
  let previousId: string | null = null;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: SCROLLS_ITSELF,
    open() {
      if (previousId !== null) {
        chat.closed(previousId);
      }
      const id = chat.start({
        projectDir: SELFTEST_PROJECT_DIR,
        profile: 'work',
      });
      previousId = id;
      sessions.activate(id);
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
          {
            toolUseId: 'selftest-tool-use',
            signal: new AbortController().signal,
          },
        );
      const result = permission.then((reply): ChatSelfTestResult => ({
        permission: reply,
        process: selftestProcess(harnesses),
      }));
      return { shownLine: '[chat] Chat tab shown in chat-selftest', result };
    },
    steps: STEPS,
    problems: (result) => resultProblems(result as ChatSelfTestResult),
  };
}
