import path from 'node:path';
import type { AgentHarness } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import { type Files, isMissingFile } from '../../../contracts/files';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  FAKE_WORKFLOW_FEATURE_TEXT,
  FAKE_WORKFLOW_PLAN_PATH,
  FAKE_WORKFLOW_STEP_TEXT,
  markRun,
  projectRecords,
  type RunMark,
  sendTexts,
} from '../../../shared/fake-agent-harness';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import type { WorkflowSelfTestHooks } from '../../workflow/contract';

// The self-test's project folder, made under the self-test's home. Its name
// names the session in every page line.
const SELFTEST_PROJECT_NAME = 'workflow-selftest';

// Relative to the self-test's temp home, as `writeFile` takes it.
const SETTINGS_FILE = '.config/wigley-ai-gui/settings.json';
// 30 s outlasts every step's wait, so the countdown never runs out mid-group.
const AUTO_START_SETTINGS =
  '{"workflow-heavy":{"autoClearAndMake":true,"autoStartSeconds":30}}';
const NO_SETTINGS = '{}';

const FEATURE_SEND = `/wigley:feature ${FAKE_WORKFLOW_FEATURE_TEXT}`;

// A send the fake answers as any other, whose turn end makes the
// `set_workflow_step` call this step would come with from a real agent.
const REPORT_SEND_PREFIX = 'fake: report ';
const REPORT_FIX_SEND = `${REPORT_SEND_PREFIX}fix`;

export interface WorkflowHeavySelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath' | 'trash' | 'write'>;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
  harnesses: readonly AgentHarness[];
  hooks: WorkflowSelfTestHooks;
}

// The launched session's id, or the launch's error; `turnEnds` holds the
// session id of each main turn end main heard during the run.
interface WorkflowHeavySelfTestResult {
  project: string;
  sessionId: string | null;
  launchError: string | null;
  turnEnds: readonly string[];
}

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

const FEATURE_KEYS = sendKeys(FEATURE_SEND);

const line = (text: string) => `[workflow] ${SELFTEST_PROJECT_NAME} ${text}`;
// `text` holds no regex metacharacter.
const anchored = (text: string) =>
  new RegExp(`^\\[workflow\\] ${SELFTEST_PROJECT_NAME} ${text}$`);

const GROUPS: SelfTestGroup[] = [
  {
    name: 'feature to plan ready',
    why: 'A wigley:feature turn that writes a plan and ends moves the session to plan ready on the chip, the strip and the side pane, and ws hides and shows the pane.',
    steps: [
      {
        width: 1200,
        keys: FEATURE_KEYS,
        expect: line('shows planReady'),
        alsoExpect: [anchored('progress 0/3 wave 1')],
        screenshot: 'strip-plan-ready',
      },
      {
        keys: [' ', 'w', 's'],
        expect: '[workflow] side pane hidden',
        screenshot: 'side-pane-hidden',
      },
      {
        width: 'start',
        keys: [' ', 'w', 's'],
        expect: '[workflow] side pane shown',
      },
    ],
  },
  {
    name: 'clear and make',
    why: 'ww runs Clear & make: the session clears and sends /wigley:make with the plan folder, and make shows progress.',
    steps: [
      {
        keys: [' ', 'w', 'w'],
        expect: line('shows make'),
        alsoExpect: [anchored('progress 1/3 wave 1')],
      },
      {
        keys: sendKeys(FAKE_WORKFLOW_STEP_TEXT),
        expect: line('progress 2/3 wave 2'),
        screenshot: 'strip-make',
      },
    ],
  },
  {
    name: 'review',
    why: 'A review round in the Run log lights review.',
    steps: [
      {
        keys: sendKeys(FAKE_WORKFLOW_STEP_TEXT),
        expect: line('shows review'),
        alsoExpect: [anchored('progress 3/3 review 1')],
      },
    ],
  },
  {
    name: 'reported fix',
    why: 'A set_workflow_step call from review moves the session to fix, and the strip draws the trail at Fix with its cycle.',
    steps: [
      {
        keys: sendKeys(REPORT_FIX_SEND),
        expect: line('shows fix'),
        screenshot: 'strip-fix',
      },
    ],
  },
  {
    name: 'close and dismiss',
    why: 'The plan folder deleted closes the run, from fix too, and wd returns the session to idle.',
    steps: [
      {
        keys: sendKeys(FAKE_WORKFLOW_STEP_TEXT),
        expect: line('shows closed'),
        screenshot: 'strip-closed',
      },
      { keys: [' ', 'w', 'd'], expect: line('shows idle') },
    ],
  },
  {
    name: 'auto-start countdown',
    why: 'With auto-start on, plan ready counts down, and ww during it cancels without clearing.',
    steps: [
      {
        writeFile: { path: SETTINGS_FILE, text: AUTO_START_SETTINGS },
        keys: [],
        expect:
          '[workflow-heavy] settings: autoClearAndMake on, autoStartSeconds 30',
      },
      {
        keys: FEATURE_KEYS,
        expect: `[workflow] countdown shown in ${SELFTEST_PROJECT_NAME}`,
        alsoExpect: [anchored('shows planReady')],
        screenshot: 'strip-countdown',
      },
      {
        keys: [' ', 'w', 'w'],
        expect: `[workflow] countdown stopped in ${SELFTEST_PROJECT_NAME}`,
      },
      {
        writeFile: { path: SETTINGS_FILE, text: NO_SETTINGS },
        keys: [],
        expect:
          '[workflow-heavy] settings: autoClearAndMake off, autoStartSeconds 10',
      },
    ],
  },
];

function expectedSends(project: string): string[] {
  const planFolder = `${project}/${FAKE_WORKFLOW_PLAN_PATH}`.slice(
    0,
    -'/plan.md'.length,
  );
  return [
    'hello',
    FEATURE_SEND,
    `/wigley:make ${planFolder}`,
    FAKE_WORKFLOW_STEP_TEXT,
    FAKE_WORKFLOW_STEP_TEXT,
    REPORT_FIX_SEND,
    FAKE_WORKFLOW_STEP_TEXT,
    FEATURE_SEND,
  ];
}

function runProblems(
  result: WorkflowHeavySelfTestResult,
  marks: readonly RunMark[],
): string[] {
  if (result.sessionId === null) {
    return [`no workflow session: ${result.launchError}`];
  }
  const records = projectRecords(marks, result.project);
  const problems: string[] = [];
  const sends = records.flatMap(sendTexts);
  if (JSON.stringify(sends) !== JSON.stringify(expectedSends(result.project))) {
    problems.push(`sends were ${JSON.stringify(sends)}`);
  }
  const makeAt = records.findIndex((record) =>
    sendTexts(record).some((text) => text.startsWith('/wigley:make ')),
  );
  const earlierRecordRuns = records
    .slice(0, Math.max(makeAt, 0))
    .some((record) => !record.ended);
  if (makeAt === 0 || earlierRecordRuns) {
    problems.push('make was not sent after a clear');
  }
  const turnEnds = result.turnEnds.filter((id) => id === result.sessionId);
  if (turnEnds.length < sends.length - 1) {
    problems.push(
      `${String(turnEnds.length)} main turn ends for ${String(sends.length)} sends`,
    );
  }
  return problems;
}

// Each run first undoes what an earlier run left: the fake's plan under the
// project's `docs`, an auto-start `settings.json`, every session still open in
// the project, waiting for their rows to go so the new row takes the first
// label, and the flows of the project's sessions. It then launches one session
// in the project, counting the main turn ends main hears until the next run
// opens, and makes the step call a report send asks for at that send's turn end.
// The fake writes, ticks and deletes the plan itself; problems reads its records,
// which the steps keep changing in place, when it runs.
export function workflowHeavySelfTestScript(
  deps: WorkflowHeavySelfTestDeps,
): SelfTestScript {
  const { homeDir, files, chat, sessions, harnesses, hooks } = deps;
  let made: Promise<string> | null = null;
  let marks: RunMark[] = [];
  let turnEndListener: Disposable | null = null;

  async function makeProject(): Promise<string> {
    const project = path.join(
      await files.realPath(homeDir),
      SELFTEST_PROJECT_NAME,
    );
    await files.makeFolder(project);
    return project;
  }

  async function undoEarlierRun(project: string): Promise<void> {
    try {
      await files.trash(path.join(project, 'docs'));
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
    await files.write(path.join(homeDir, SETTINGS_FILE), NO_SETTINGS);
    await chat.closeSessionsIn(project);
    hooks.forgetFlows(project);
  }

  async function openSession(): Promise<WorkflowHeavySelfTestResult> {
    made ??= makeProject().catch((error: unknown) => {
      made = null;
      throw error;
    });
    const project = await made;
    await undoEarlierRun(project);
    const turnEnds: string[] = [];
    turnEndListener = hooks.onMainTurnEnded((sessionId) => {
      turnEnds.push(sessionId);
      const lastSend = projectRecords(marks, project).flatMap(sendTexts).at(-1);
      if (lastSend?.startsWith(REPORT_SEND_PREFIX) === true) {
        hooks.callStepTool(
          sessionId,
          lastSend.slice(REPORT_SEND_PREFIX.length),
        );
      }
    });
    try {
      const sessionId = await chat.launch({
        projectDir: project,
        profile: 'work',
        message: { text: 'hello', images: [] },
      });
      sessions.activate(sessionId);
      return { project, sessionId, launchError: null, turnEnds };
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
    // The strip wraps, and the chip's one tag keeps its width.
    scrollsItself: [],
    open() {
      marks = markRun(harnesses);
      turnEndListener?.dispose();
      turnEndListener = null;
      return {
        shownLine: line('shows idle'),
        result: openSession(),
      };
    },
    groups: GROUPS,
    problems: (result) =>
      runProblems(result as WorkflowHeavySelfTestResult, marks),
  };
}
