import { app, type BrowserWindow } from 'electron';
import type {
  AnswersPayload,
  FormsService,
  FormsSession,
} from '../contracts/forms';
import type { PageBind } from '../contracts/keymap';

// Opens a fixture round through FormsService, drives keys into the page
// through Electron's input pipeline, and checks the lines the page logs, that
// the page fits the window's minimum width, and the answers the round
// returns. Run with `npm run selftest`; exits non-zero on failure.

const KEY_CODES: Record<string, string> = { ' ': 'Space' };
const STEP_TIMEOUT_MS = 5000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Step {
  keys: string[];
  expect: string;
  // After the step, the window shrinks to its minimum width and the page
  // must fit it without cutting anything off.
  checksFit?: true;
}

// Exists only for the self-test, which adds it to the keymap main serves; it
// is never in the user's keymap. No step completes it: `q a x` then `b` breaks
// it, so `a` runs forms.editWhat and `x b` are typed into the What box.
export const SELF_TEST_PAGE_BINDS: PageBind[] = [
  { keys: ['q', 'a', 'x', 'y'], scope: 'forms', command: 'forms.nextItem' },
];

// An unbroken run of letters wider than any pane; no j, which would start jk.
const LONG_WORD = 'unbroken'.repeat(14);

// Starting on the notice: Space then j replays j to question 1, pick 2; a
// types "ab" at once (INSERT), jk then Space j to its why box, A appends a
// long word, Esc out; a again types "c" after "ab"; j to question 2 and mark
// it not applicable; o types "note" into the note box at once (INSERT), Esc
// out; g t switches rounds; review, ? opens and closes help, C
// opens and n dismisses the cancel prompt, Enter jumps back to the question,
// review again and Space Enter submits.
const STEPS: Step[] = [
  { keys: [' ', 'j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: ['2'], expect: '[forms] chose 2 on question 1' },
  { keys: ['a'], expect: '[forms] focused what on question 1' },
  {
    keys: ['a', 'b', 'j', 'k', ' ', 'j'],
    expect: '[forms] focused why on question 1',
    checksFit: true,
  },
  {
    keys: ['A', ...LONG_WORD, 'j', 'k', 'Escape'],
    expect: '[forms] left the box',
    checksFit: true,
  },
  { keys: ['a'], expect: '[forms] focused what on question 1' },
  { keys: ['c', 'j', 'k', 'Escape'], expect: '[forms] left the box' },
  {
    keys: ['j', 'q', 'a', 'x', 'b'],
    expect: '[page] typed xb into the editor',
  },
  { keys: ['j', 'k', 'Escape'], expect: '[forms] left the box' },
  { keys: ['x'], expect: '[forms] not applicable on question 2' },
  {
    keys: ['o', 'n', 'o', 't', 'e', 'j', 'k', 'Escape'],
    expect: '[forms] left the box',
  },
  { keys: ['g', 't'], expect: '[page] gt ran forms.nextRound' },
  { keys: [' ', ' '], expect: '[forms] review opened', checksFit: true },
  { keys: ['?'], expect: '[page] ? ran help.toggle', checksFit: true },
  { keys: ['?'], expect: '[page] ? ran help.close' },
  { keys: ['C'], expect: '[page] C ran forms.askCancel', checksFit: true },
  { keys: ['n'], expect: '[page] n ran forms.dismissConfirm' },
  { keys: ['Enter'], expect: '[page] Enter ran forms.reviewJump' },
  { keys: [' ', ' '], expect: '[forms] review opened' },
  { keys: [' ', 'Enter'], expect: '[forms] submitted' },
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
        title: `First question titled ${LONG_WORD}`,
        context: [
          `- a fact naming ${LONG_WORD}`,
          '',
          `| ${Array.from({ length: 12 }, (_, column) => `column ${column}`).join(' | ')} |`,
          `|${' --- |'.repeat(12)}`,
          `|${' cell |'.repeat(12)}`,
          '',
          '```',
          `code ${LONG_WORD}`,
          '```',
        ].join('\n'),
        question: `Pick one of ${LONG_WORD}.`,
        choices: ['One', `Two ${LONG_WORD}`, 'Three'],
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
    // "abc" proves each a entered INSERT with the cursor at the end.
    [first?.what === 'abc', `question 1 what ${JSON.stringify(first?.what)}`],
    // "xb" proves the keys a broken sequence left over were typed into the
    // box its command focused, in INSERT.
    [second?.what === 'xb', `question 2 what ${JSON.stringify(second?.what)}`],
    [
      second?.status === 'not_applicable',
      `question 2 status ${second?.status}`,
    ],
    // "note" proves o entered INSERT at once, keys typed straight after it.
    [payload.note === 'note', `note ${JSON.stringify(payload.note)}`],
    [payload.notices.length === 1, `${payload.notices.length} notices`],
  ];
  return checks.filter(([passed]) => !passed).map(([, problem]) => problem);
}

function press(window: BrowserWindow, key: string) {
  const keyCode = KEY_CODES[key] ?? key;
  // A capital letter's key event says Shift, as the keyboard's does.
  const modifiers = /^[A-Z]$/.test(key) ? ['shift' as const] : [];
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (key.length === 1) {
    window.webContents.sendInputEvent({ type: 'char', keyCode: key });
  }
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
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

// Lists what the page cuts off on the right: an element whose content is wider
// than its box, or that ends past the window. Code and tables scroll in their
// own box, and rail and switcher titles end in an ellipsis, their full text in
// the item heading and the tooltip.
const CUT_OFF_SCRIPT = `(() => {
  const scrollsItself = '.md pre, .md table, .rail-title, .switcher-label';
  const name = (node) => [node.tagName.toLowerCase(), ...node.classList].join('.');
  const problems = [];
  const page = document.documentElement;
  if (page.scrollWidth > innerWidth) {
    problems.push('page is ' + page.scrollWidth + 'px wide');
  }
  for (const node of document.querySelectorAll('#app *')) {
    const right = node.getBoundingClientRect().right;
    const isInScroller = node.parentElement.closest(scrollsItself) !== null;
    if (isInScroller || node.getClientRects().length === 0) {
      continue;
    }
    const isOverfull =
      node.clientWidth > 0 &&
      node.scrollWidth > node.clientWidth + 1 &&
      !node.matches(scrollsItself);
    if (isOverfull) {
      problems.push(name(node) + ' holds ' + node.scrollWidth + 'px in ' + node.clientWidth + 'px');
    } else if (right > innerWidth + 1) {
      problems.push(name(node) + ' ends at ' + Math.round(right) + 'px');
    }
  }
  return problems;
})()`;

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

function waitForPageWidth(window: BrowserWindow, width: number) {
  return waitFor(async () => {
    const pageWidth: number =
      await window.webContents.executeJavaScript('innerWidth');
    return pageWidth === width;
  });
}

// Shrinks the window to its minimum width, lists what the page cuts off
// there, and restores the window's size.
async function cutOffAtMinimumWidth(window: BrowserWindow): Promise<string[]> {
  const [width, height] = window.getSize();
  const [minimumWidth] = window.getMinimumSize();
  window.setSize(minimumWidth, height);
  const [narrowWidth] = window.getContentSize();
  const problems = (await waitForPageWidth(window, narrowWidth))
    ? await window.webContents.executeJavaScript(CUT_OFF_SCRIPT)
    : [`the page never narrowed to ${narrowWidth}px`];
  window.setSize(width, height);
  await waitForPageWidth(window, window.getContentSize()[0]);
  return problems;
}

// Forge's dev server can reload the page once at startup, so every load starts
// a fresh run and a run that a reload interrupted stands down.
let latestRun = 0;
let session: FormsSession | null = null;
// Chromium drops input that reaches a page before the page's first frame.
// `paint` fires only for an offscreen window, and self-test windows are
// offscreen (window.ts), so a visible-window self-test would time out here.
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
  const keys = step.keys.join('').replaceAll(' ', '␣');
  if (isCurrent()) {
    report(passed, `${keys} -> ${step.expect}`);
  }
  if (!passed || !step.checksFit) {
    return passed;
  }
  const cutOff = await cutOffAtMinimumWidth(window);
  if (isCurrent()) {
    report(
      cutOff.length === 0,
      `${keys} fits the minimum width: ${cutOff.join('; ') || 'nothing cut off'}`,
    );
  }
  return cutOff.length === 0;
}

// `cleanUp` runs before every exit, since app.exit skips quit handlers.
async function runAllSteps(
  window: BrowserWindow,
  forms: FormsService,
  cleanUp: () => void,
) {
  const exit = (code: number) => {
    cleanUp();
    app.exit(code);
  };
  const run = ++latestRun;
  const isCurrent = () => run === latestRun;
  const isReadyForKeys = async () =>
    hasPaintedSinceNavigation && (await isPageReady(window));
  const isReady = await waitFor(isReadyForKeys);
  if (!isCurrent()) {
    return;
  }
  if (!isReady) {
    report(false, 'page ready for keys');
    exit(1);
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
  if (isCurrent()) {
    report(failures === 0, shown);
  }

  for (const step of STEPS) {
    if (!(await runStep(window, step, isCurrent))) {
      failures++;
    }
  }
  const payload = await answers;
  if (!isCurrent()) {
    return;
  }
  const problems = payloadProblems(payload);
  report(
    problems.length === 0,
    `payload ${problems.join(', ') || 'as expected'}`,
  );
  failures += problems.length === 0 ? 0 : 1;
  console.log(
    `[selftest] ${failures === 0 ? 'all passed' : `${failures} failed`}`,
  );
  exit(failures === 0 ? 0 : 1);
}

// `cleanUp` deletes what the self-test made outside the repo; it runs before
// the self-test exits.
export function startSelfTest(
  window: BrowserWindow,
  forms: FormsService,
  cleanUp: () => void,
) {
  window.webContents.on('did-navigate', () => {
    // A run begun on the previous page stands down before its load finishes.
    latestRun++;
    hasPaintedSinceNavigation = false;
  });
  window.webContents.on('paint', () => {
    hasPaintedSinceNavigation = true;
  });
  window.webContents.on(
    'did-finish-load',
    () => void runAllSteps(window, forms, cleanUp),
  );
}
