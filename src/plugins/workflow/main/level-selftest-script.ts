import type { AgentHarness } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  FAKE_TOOL_TEXT,
  markRun,
  projectRecords,
  type RunMark,
  sendTexts,
} from '../../../shared/fake-agent-harness';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import type { ChecklistItem, WorkflowSelfTestHooks } from '../contract';

// Sends the fake answers as any other, whose turn end makes the tool call the
// send asks for, as a real agent would.
const REPORT_SEND_PREFIX = 'fake: report ';
export const CHECKLIST_SEND = 'fake: checklist';
const CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  { text: 'first', done: true },
  { text: 'second', done: false },
  { text: 'third', done: false },
];

export const reportSend = (step: string) => `${REPORT_SEND_PREFIX}${step}`;

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
export const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

// The page lines of the session in the self-test's project folder.
export function levelLines(projectName: string) {
  return {
    line: (text: string) => `[workflow] ${projectName} ${text}`,
    // `text` holds no regex metacharacter.
    anchored: (text: string) =>
      new RegExp(`^\\[workflow\\] ${projectName} ${text}$`),
  };
}

export interface LevelSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Pick<Paths, 'join'>;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
  harnesses: readonly AgentHarness[];
  hooks: WorkflowSelfTestHooks;
}

export interface LevelSelfTestSpec {
  // The self-test's project folder, made under the self-test's home. Its name
  // names the session in every page line.
  projectName: string;
  groups: SelfTestGroup[];
  // Every send the run's steps make, after the launch's own.
  sendsAfterLaunch: readonly string[];
}

// The launched session's id, or the launch's error; `turnEnds` holds the
// session id of each main turn end main heard during the run.
interface LevelSelfTestResult {
  project: string;
  sessionId: string | null;
  launchError: string | null;
  turnEnds: readonly string[];
}

function runProblems(
  result: LevelSelfTestResult,
  marks: readonly RunMark[],
  { projectName, sendsAfterLaunch }: LevelSelfTestSpec,
): string[] {
  if (result.sessionId === null) {
    return [`no ${projectName} session: ${result.launchError}`];
  }
  const problems: string[] = [];
  const sends = projectRecords(marks, result.project).flatMap(sendTexts);
  const expectedSends = [FAKE_TOOL_TEXT, ...sendsAfterLaunch];
  if (JSON.stringify(sends) !== JSON.stringify(expectedSends)) {
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

// The self-test script of a checklist level. Each run first closes every session
// still open in the project, waiting for their rows to go so the new row takes the
// first label, and forgets the flows of the project's sessions. It then launches one
// session in the project, counting the main turn ends main hears until the next run
// opens, and at each of the launched session's turn ends makes the tool call its last
// send asks for. The listener outlives the script, so a later script's session calls
// nothing here.
export function levelSelfTestScript(
  deps: LevelSelfTestDeps,
  spec: LevelSelfTestSpec,
): SelfTestScript {
  const { homeDir, files, paths, chat, sessions, harnesses, hooks } = deps;
  const { line, anchored } = levelLines(spec.projectName);
  let made: Promise<string> | null = null;
  let marks: RunMark[] = [];
  let turnEndListener: Disposable | null = null;

  async function makeProject(): Promise<string> {
    const project = paths.join(await files.realPath(homeDir), spec.projectName);
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

  async function openSession(): Promise<LevelSelfTestResult> {
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
    groups: spec.groups,
    problems: (result) =>
      runProblems(result as LevelSelfTestResult, marks, spec),
  };
}
