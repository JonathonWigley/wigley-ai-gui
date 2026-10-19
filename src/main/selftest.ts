import { app, type BrowserWindow } from 'electron';
import type {
  SelfTestHost,
  SelfTestScript,
  SelfTestStep,
} from '../contracts/plugin';

// Runs a plugin's self-test script on every page load: opens its fixture,
// drives its keys into the page through Electron's input pipeline, and checks
// the lines the page logs, that the page fits the window's minimum width, and
// the result the script checks. Run with `npm run selftest`; exits non-zero on
// failure.

const KEY_CODES: Record<string, string> = { ' ': 'Space' };
const STEP_TIMEOUT_MS = 5000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
// Chromium drops input that reaches a page before the page's first frame.
// `paint` fires only for an offscreen window, and self-test windows are
// offscreen (window.ts), so a visible-window self-test would time out here.
let hasPaintedSinceNavigation = false;

async function runStep(
  window: BrowserWindow,
  step: SelfTestStep,
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
  script: SelfTestScript,
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
  const { shownLine, result } = script.open(run);
  let failures = (await waitForNewLogLine(window, shownLine, seen)) ? 0 : 1;
  if (isCurrent()) {
    report(failures === 0, shownLine);
  }

  for (const step of script.steps) {
    if (!(await runStep(window, step, isCurrent))) {
      failures++;
    }
  }
  const outcome = await result;
  if (!isCurrent()) {
    return;
  }
  const problems = script.problems(outcome);
  report(
    problems.length === 0,
    `result ${problems.join(', ') || 'as expected'}`,
  );
  failures += problems.length === 0 ? 0 : 1;
  console.log(
    `[selftest] ${failures === 0 ? 'all passed' : `${failures} failed`}`,
  );
  exit(failures === 0 ? 0 : 1);
}

// `cleanUp` deletes what the self-test made outside the repo; it runs before
// the self-test exits. The returned host runs the script a plugin hands it.
export function startSelfTest(
  window: BrowserWindow,
  cleanUp: () => void,
): SelfTestHost {
  window.webContents.on('did-navigate', () => {
    // A run begun on the previous page stands down before its load finishes.
    latestRun++;
    hasPaintedSinceNavigation = false;
  });
  window.webContents.on('paint', () => {
    hasPaintedSinceNavigation = true;
  });
  return {
    run(script) {
      window.webContents.on(
        'did-finish-load',
        () => void runAllSteps(window, script, cleanUp),
      );
    },
  };
}
