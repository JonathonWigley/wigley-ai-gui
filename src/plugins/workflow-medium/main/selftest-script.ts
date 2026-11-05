import type { AgentHarness } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  FAKE_TOOL_TEXT,
  type FakeAgentProcessRecord,
  markRun,
  type RunMark,
} from '../../../shared/fake-agent-harness';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import type {
  ChecklistItem,
  WorkflowSelfTestHooks,
} from '../../workflow/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every page line.
const SELFTEST_PROJECT_NAME = 'workflow-medium-selftest';

const MEDIUM_SEND = '/wigley:medium';
// Sends the fake answers as any other, whose turn end makes the tool call the
// send asks for, as a real agent would.
const REPORT_SEND_PREFIX = 'fake: report ';
const CHECKLIST_SEND = 'fake: checklist';
const CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  { text: 'first', done: true },
  { text: 'second', done: false },
  { text: 'third', done: false },
];

const reportSend = (step: string) => `${REPORT_SEND_PREFIX}${step}`;

const EXPECTED_SENDS = [
  FAKE_TOOL_TEXT,
  MEDIUM_SEND,
  reportSend('build'),
  CHECKLIST_SEND,
  reportSend('review'),
  reportSend('fix'),
  reportSend('review'),
  reportSend('fix'),
  reportSend('land'),
  reportSend('done'),
];

export interface WorkflowMediumSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Pick<Paths, 'join'>;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
  harnesses: readonly AgentHarness[];
  hooks: WorkflowSelfTestHooks;
}

// The launched session's id, or the launch's error; `turnEnds` holds the
// session id of each main turn end main heard during the run.
interface WorkflowMediumSelfTestResult {
  project: string;
  sessionId: string | null;
  launchError: string | null;
  turnEnds: readonly string[];
}

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

const line = (text: string) => `[workflow] ${SELFTEST_PROJECT_NAME} ${text}`;
// `text` holds no regex metacharacter.
const anchored = (text: string) =>
  new RegExp(`^\\[workflow\\] ${SELFTEST_PROJECT_NAME} ${text}$`);

const GROUPS: SelfTestGroup[] = [
  {
    name: 'level and trail',
    why: "The skill's start claims the session: the M badge, the five-word trail, and Interview as the first step, and the No workflow tag leaves.",
    steps: [
      {
        width: 1200,
        keys: sendKeys(MEDIUM_SEND),
        expect: line('shows interview'),
        alsoExpect: [
          anchored('level M'),
          anchored('trail Interview › Build › Review › Fix › Land'),
        ],
        screenshot: 'medium-interview',
      },
    ],
  },
  {
    name: 'steps move back',
    why: 'Reports move the trail forward and back, the checklist draws with its count, and a fix cycle may return to review.',
    steps: [
      { keys: sendKeys(reportSend('build')), expect: line('shows build') },
      {
        keys: sendKeys(CHECKLIST_SEND),
        expect: line('progress 1/3'),
        screenshot: 'medium-build-checklist',
      },
      { keys: sendKeys(reportSend('review')), expect: line('shows review') },
      {
        keys: sendKeys(reportSend('fix')),
        expect: line('shows fix'),
        screenshot: 'medium-fix-cycle',
      },
      { keys: sendKeys(reportSend('review')), expect: line('shows review') },
      { keys: sendKeys(reportSend('fix')), expect: line('shows fix') },
      { keys: sendKeys(reportSend('land')), expect: line('shows land') },
      {
        width: 'start',
        keys: sendKeys(reportSend('done')),
        expect: line('shows done'),
        screenshot: 'medium-done',
      },
    ],
  },
];

// This run's fake records for `project`, in start order.
function projectRecords(
  marks: readonly RunMark[],
  project: string,
): FakeAgentProcessRecord[] {
  return marks
    .flatMap((mark) => mark.harness.processes.slice(mark.processes))
    .filter((record) => record.request.projectDir === project);
}

const sendTexts = (record: FakeAgentProcessRecord) =>
  record.calls.flatMap((call) => (call.method === 'send' ? [call.text] : []));

function runProblems(
  result: WorkflowMediumSelfTestResult,
  marks: readonly RunMark[],
): string[] {
  if (result.sessionId === null) {
    return [`no workflow-medium session: ${result.launchError}`];
  }
  const problems: string[] = [];
  const sends = projectRecords(marks, result.project).flatMap(sendTexts);
  if (JSON.stringify(sends) !== JSON.stringify(EXPECTED_SENDS)) {
    problems.push(`sends were ${JSON.stringify(sends)}`);
  }
  const turnEnds = result.turnEnds.filter((id) => id === result.sessionId);
  if (turnEnds.length < sends.length - 1) {
    problems.push(
      `${String(turnEnds.length)} main turn ends for ${String(sends.length)} sends`,
    );
  }
  return problems;
}

// Each run first closes every session still open in the project, waiting for their
// rows to go so the new row takes the first label, and forgets the flows of the
// project's sessions. It then launches one session in the project, counting the main
// turn ends main hears until the next run opens, and at each of the launched
// session's turn ends makes the tool call its last send asks for. The listener
// outlives the script, so a later script's session calls nothing here.
export function workflowMediumSelfTestScript(
  deps: WorkflowMediumSelfTestDeps,
): SelfTestScript {
  const { homeDir, files, paths, chat, sessions, harnesses, hooks } = deps;
  let made: Promise<string> | null = null;
  let marks: RunMark[] = [];
  let turnEndListener: Disposable | null = null;

  async function makeProject(): Promise<string> {
    const project = paths.join(
      await files.realPath(homeDir),
      SELFTEST_PROJECT_NAME,
    );
    await files.makeFolder(project);
    return project;
  }

  function callAskedTool(sessionId: string, lastSend: string | undefined) {
    if (lastSend === CHECKLIST_SEND) {
      hooks.callChecklistTool(sessionId, CHECKLIST_ITEMS);
    } else if (lastSend?.startsWith(REPORT_SEND_PREFIX) === true) {
      hooks.callStepTool(sessionId, lastSend.slice(REPORT_SEND_PREFIX.length));
    }
  }

  async function openSession(): Promise<WorkflowMediumSelfTestResult> {
    made ??= makeProject().catch((error: unknown) => {
      made = null;
      throw error;
    });
    const project = await made;
    await chat.closeSessionsIn(project);
    hooks.forgetFlows(project);
    const turnEnds: string[] = [];
    let launched: string | null = null;
    turnEndListener = hooks.onMainTurnEnded((sessionId) => {
      turnEnds.push(sessionId);
      if (sessionId === launched) {
        callAskedTool(
          sessionId,
          projectRecords(marks, project).flatMap(sendTexts).at(-1),
        );
      }
    });
    try {
      launched = await chat.launch({
        projectDir: project,
        profile: 'work',
        message: { text: FAKE_TOOL_TEXT, images: [] },
      });
      sessions.activate(launched);
      return { project, sessionId: launched, launchError: null, turnEnds };
    } catch (error) {
      return {
        project,
        sessionId: null,
        launchError: errorText(error),
        turnEnds,
      };
    }
  }

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open() {
      marks = markRun(harnesses);
      turnEndListener?.dispose();
      turnEndListener = null;
      return {
        shownLine: line('shows idle'),
        alsoShown: [anchored('no workflow')],
        result: openSession(),
      };
    },
    groups: GROUPS,
    problems: (result) =>
      runProblems(result as WorkflowMediumSelfTestResult, marks),
  };
}
