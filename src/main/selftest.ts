import { app, type BrowserWindow } from 'electron';
import type {
  AnswersPayload,
  FormsService,
  FormsSession,
} from '../contracts/forms';

// Opens a fixture round through FormsService, drives keys into the page
// through Electron's input pipeline, and checks the lines the page logs and
// the answers the round returns. Run with `npm run selftest`; exits non-zero
// on failure.

const KEY_CODES: Record<string, string> = { ' ': 'Space' };
const STEP_TIMEOUT_MS = 5000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Step {
  keys: string[];
  expect: string;
}

// Starting on the notice: j to question 1, pick 2, type "ab" in its answer
// box, Space j to its why box, Esc out, j to question 2 and mark it not
// applicable, then review and submit.
const STEPS: Step[] = [
  { keys: ['j'], expect: '[page] j ran forms.nextItem' },
  { keys: ['2'], expect: '[forms] chose 2 on question 1' },
  { keys: ['a'], expect: '[forms] focused what on question 1' },
  {
    keys: ['i', 'a', 'b', 'j', 'k', ' ', 'j'],
    expect: '[forms] focused why on question 1',
  },
  { keys: ['Escape'], expect: '[forms] left the box' },
  { keys: ['j', 'x'], expect: '[forms] not applicable on question 2' },
  { keys: [' ', ' '], expect: '[forms] review opened' },
  { keys: ['Enter'], expect: '[forms] submitted' },
];

// Each run's fixture differs in one context line, so a later run never opens
// pre-filled from an earlier run's saved draft.
function fixtureRound(run: number) {
  return {
    heading: 'Self-test round',
    overview: 'Drives the forms view offscreen.',
    notices: [
      {
        title: 'A settled point',
        context: `Run ${run}: nothing to decide here.`,
        badge: 'Decided',
      },
    ],
    questions: [
      {
        title: 'First question',
        context: '- a fact',
        question: 'Pick one.',
        choices: ['One', 'Two', 'Three'],
        recommend: 1,
        rationale: 'The first is simplest.',
      },
      {
        title: 'Second question',
        context: '- another fact',
        question: 'Pick one.',
        choices: ['Yes', 'No'],
        recommend: 1,
        rationale: 'Yes is the default.',
      },
    ],
  };
}

// What the fixture's answers must come back as after STEPS.
function payloadProblems(payload: AnswersPayload): string[] {
  const [first, second] = payload.answers;
  const checks: [boolean, string][] = [
    [payload.outcome === 'submitted', `outcome ${payload.outcome}`],
    [first?.status === 'answered', `question 1 status ${first?.status}`],
    [first?.choice === 2, `question 1 choice ${first?.choice}`],
    [first?.what === 'ab', `question 1 what ${JSON.stringify(first?.what)}`],
    [
      second?.status === 'not_applicable',
      `question 2 status ${second?.status}`,
    ],
    [payload.notices.length === 1, `${payload.notices.length} notices`],
  ];
  return checks.filter(([passed]) => !passed).map(([, problem]) => problem);
}

function press(window: BrowserWindow, key: string) {
  const keyCode = KEY_CODES[key] ?? key;
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  if (key.length === 1) {
    window.webContents.sendInputEvent({ type: 'char', keyCode: key });
  }
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
}

function readLog(window: BrowserWindow): Promise<string[]> {
  return window.webContents.executeJavaScript(
    `[...document.querySelectorAll('#log li')].map((li) => li.textContent)`,
  );
}

function isPageReady(window: BrowserWindow): Promise<boolean> {
  return window.webContents.executeJavaScript(
    `document.body.dataset.ready === 'true'`,
  );
}

async function waitFor(check: () => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await wait(50);
  }
  return false;
}

// Waits for the line among those logged after `seen` lines; the log is newest first.
function waitForNewLogLine(window: BrowserWindow, line: string, seen: number) {
  return waitFor(async () => {
    const lines = await readLog(window);
    return lines.slice(0, lines.length - seen).includes(line);
  });
}

function report(passed: boolean, what: string) {
  console.log(`[selftest] ${passed ? 'PASS' : 'FAIL'} ${what}`);
}

// Forge's dev server can reload the page once at startup, so every load starts
// a fresh run and a run that a reload interrupted stands down.
let latestRun = 0;
let session: FormsSession | null = null;
// Chromium drops input that reaches a page before the page's first frame.
let hasPaintedSinceNavigation = false;

async function runStep(
  window: BrowserWindow,
  step: Step,
  isCurrent: () => boolean,
): Promise<boolean> {
  const seen = (await readLog(window)).length;
  for (const key of step.keys) {
    if (!isCurrent()) {
      return false;
    }
    press(window, key);
    await wait(30);
  }
  const passed = await waitForNewLogLine(window, step.expect, seen);
  if (isCurrent()) {
    const keys = step.keys.join('').replaceAll(' ', '␣');
    report(passed, `${keys} -> ${step.expect}`);
  }
  return passed;
}

async function runAllSteps(window: BrowserWindow, forms: FormsService) {
  const run = ++latestRun;
  const isCurrent = () => run === latestRun;
  const isReadyForKeys = async () =>
    hasPaintedSinceNavigation && (await isPageReady(window));
  if (!(await waitFor(isReadyForKeys)) || !isCurrent()) {
    return;
  }
  window.webContents.focus();

  const seen = (await readLog(window)).length;
  // A later run may have begun while the log was read.
  if (!isCurrent()) {
    return;
  }
  session?.end();
  session = forms.startSession({
    sessionId: `selftest-${run}`,
    projectDir: 'selftest',
    deadlineSeconds: 120,
  });
  const answers = session.askRound(
    fixtureRound(run),
    null,
    new AbortController().signal,
  );
  const shown = '[forms] round shown: selftest · Self-test round';
  let failures = (await waitForNewLogLine(window, shown, seen)) ? 0 : 1;
  report(failures === 0, shown);

  for (const step of STEPS) {
    if (!(await runStep(window, step, isCurrent))) {
      failures++;
    }
  }
  if (!isCurrent()) {
    return;
  }
  const problems = payloadProblems(await answers);
  report(
    problems.length === 0,
    `payload ${problems.join(', ') || 'as expected'}`,
  );
  failures += problems.length === 0 ? 0 : 1;
  console.log(
    `[selftest] ${failures === 0 ? 'all passed' : `${failures} failed`}`,
  );
  app.exit(failures === 0 ? 0 : 1);
}

export function startSelfTest(window: BrowserWindow, forms: FormsService) {
  window.webContents.on('did-navigate', () => {
    hasPaintedSinceNavigation = false;
  });
  window.webContents.on('paint', () => {
    hasPaintedSinceNavigation = true;
  });
  window.webContents.on(
    'did-finish-load',
    () => void runAllSteps(window, forms),
  );
}
