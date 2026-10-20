import { app, type BrowserWindow } from 'electron';
import type { SelfTestHost, SelfTestStep } from '../contracts/plugin';
import {
  type Chord,
  CHORD_NOTATION_RULE,
  isChordToken,
  parseChord,
} from '../shared/chord-notation';
import { errorText } from '../shared/error-text';
import {
  type HandedScript,
  mergeSelfTestConfigs,
  type SelfTestConfig,
} from './selftest-config';

// Runs the plugins' self-test scripts on every page load, one after another:
// opens each script's fixture, drives its keys into the page through
// Electron's input pipeline, and checks the lines the page logs, that the page
// fits the window's minimum width, and the result the script checks. Run with `npm run selftest`; exits non-zero on
// failure.

const KEY_CODES: Record<string, string> = { ' ': 'Space' };
const STEP_TIMEOUT_MS = 5000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A chord sends no `char`: its modifiers make it a command, not typed text.
function pressChord(window: BrowserWindow, chord: Chord) {
  const keyCode = chord.key;
  const modifiers = [
    ...(chord.ctrl ? ['control' as const] : []),
    ...(chord.alt ? ['alt' as const] : []),
    ...(chord.shift ? ['shift' as const] : []),
    ...(chord.meta ? ['meta' as const] : []),
  ];
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

// Presses a KeyboardEvent.key value, or a chord in the page keymap's notation;
// throws on a chord token that does not fit the notation.
function press(window: BrowserWindow, key: string) {
  if (isChordToken(key)) {
    const chord = parseChord(key);
    if (!chord) {
      throw new Error(
        `Self-test step presses a malformed chord ${key}: ${CHORD_NOTATION_RULE}`,
      );
    }
    pressChord(window, chord);
    return;
  }
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

// The error the page's start failed with, or null while it has not failed.
function readStartFailure(window: BrowserWindow): Promise<string | null> {
  return window.webContents.executeJavaScript(
    `document.body.dataset.startFailed ?? null`,
  );
}

// Lists what the page cuts off on the right: an element whose content is wider
// than its box, or that ends past the window, skipping the elements the
// `scrollsItself` selectors match and everything inside them.
function cutOffScript(scrollsItself: string[]): string {
  return `(() => {
  const scrollsItself = ${JSON.stringify(scrollsItself)};
  const isScroller = (node) => scrollsItself.some((selector) => node.matches(selector));
  const name = (node) => [node.tagName.toLowerCase(), ...node.classList].join('.');
  const problems = [];
  const page = document.documentElement;
  if (page.scrollWidth > innerWidth) {
    problems.push('page is ' + page.scrollWidth + 'px wide');
  }
  for (const node of document.querySelectorAll('#app *')) {
    const right = node.getBoundingClientRect().right;
    const isInScroller = scrollsItself.some(
      (selector) => node.parentElement.closest(selector) !== null,
    );
    if (isInScroller || node.getClientRects().length === 0) {
      continue;
    }
    const isOverfull =
      node.clientWidth > 0 &&
      node.scrollWidth > node.clientWidth + 1 &&
      !isScroller(node);
    if (isOverfull) {
      problems.push(name(node) + ' holds ' + node.scrollWidth + 'px in ' + node.clientWidth + 'px');
    } else if (right > innerWidth + 1) {
      problems.push(name(node) + ' ends at ' + Math.round(right) + 'px');
    }
  }
  return problems;
})()`;
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

let hasExited = false;

// `cleanUp` runs before every exit, since app.exit skips quit handlers. Only
// the first exit counts: a run a late page load starts after it stays quiet.
function exitSelfTest(code: number, cleanUp: () => void) {
  if (hasExited) {
    return;
  }
  hasExited = true;
  cleanUp();
  app.exit(code);
}

// Reports `what` as failed with `error`'s text, and exits non-zero; after the
// self-test has exited, does nothing.
export function failSelfTest(
  what: string,
  error: unknown,
  cleanUp: () => void,
) {
  if (hasExited) {
    return;
  }
  report(false, `${what}: ${errorText(error)}`);
  exitSelfTest(1, cleanUp);
}

function waitForPageWidth(window: BrowserWindow, width: number) {
  return waitFor(async () => {
    const pageWidth: number =
      await window.webContents.executeJavaScript('innerWidth');
    return pageWidth === width;
  });
}

// Waits for three of the page's frames, true once they have run and false when
// they have not within the step timeout (a page that stops producing frames or
// reloads mid-wait): a resize reaches the editors' ResizeObserver in the first,
// which asks vim to redraw its cursor in the next, and the third starts after
// that redraw.
async function waitForResizeRedraw(window: BrowserWindow): Promise<boolean> {
  await window.webContents.executeJavaScript(`{
  window.resizeRedrawFrames = 0;
  const frame = () => {
    window.resizeRedrawFrames += 1;
    if (window.resizeRedrawFrames < 3) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}`);
  return waitFor(
    async () =>
      (await window.webContents.executeJavaScript(
        'window.resizeRedrawFrames',
      )) >= 3,
  );
}

// Shrinks the window to its minimum width, lists what the page cuts off
// there once the page has redrawn at that width, and restores the window's
// size.
async function cutOffAtMinimumWidth(
  window: BrowserWindow,
  scrollsItself: string[],
): Promise<string[]> {
  const [width, height] = window.getSize();
  const [minimumWidth] = window.getMinimumSize();
  window.setSize(minimumWidth, height);
  const [narrowWidth] = window.getContentSize();
  const hasNarrowed = await waitForPageWidth(window, narrowWidth);
  const hasRedrawn = hasNarrowed && (await waitForResizeRedraw(window));
  let problems: string[];
  if (!hasNarrowed) {
    problems = [`the page never narrowed to ${narrowWidth}px`];
  } else if (!hasRedrawn) {
    problems = [
      `the page produced no frames after narrowing to ${narrowWidth}px`,
    ];
  } else {
    problems = await window.webContents.executeJavaScript(
      cutOffScript(scrollsItself),
    );
  }
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
  scrollsItself: string[],
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
  const cutOff = await cutOffAtMinimumWidth(window, scrollsItself);
  if (isCurrent()) {
    report(
      cutOff.length === 0,
      `${keys} fits the minimum width: ${cutOff.join('; ') || 'nothing cut off'}`,
    );
  }
  return cutOff.length === 0;
}

// Opens the script's fixture, runs its steps and checks its result, reporting
// each under `pluginId`; returns how many checks failed, or null when a reload
// interrupted the run.
async function runScript(
  window: BrowserWindow,
  { pluginId, script }: HandedScript,
  run: number,
  isCurrent: () => boolean,
): Promise<number | null> {
  const seen = (await readLog(window)).length;
  // A later run may have begun while the log was read.
  if (!isCurrent()) {
    return null;
  }
  const { shownLine, result } = script.open(run);
  let failures = (await waitForNewLogLine(window, shownLine, seen)) ? 0 : 1;
  if (isCurrent()) {
    report(failures === 0, shownLine);
  }

  for (const step of script.steps) {
    if (!isCurrent()) {
      return null;
    }
    if (!(await runStep(window, step, script.scrollsItself, isCurrent))) {
      failures++;
    }
  }
  const outcome = await result;
  if (!isCurrent()) {
    return null;
  }
  const problems = script.problems(outcome);
  report(
    problems.length === 0,
    `${pluginId} result ${problems.join(', ') || 'as expected'}`,
  );
  return failures + (problems.length === 0 ? 0 : 1);
}

// Waits for the page to be ready for keys and focuses it, then runs every
// handed script in hand-over order; a failing script does not stop the next.
async function runAllScripts(
  window: BrowserWindow,
  handed: readonly HandedScript[],
  run: number,
  isCurrent: () => boolean,
  cleanUp: () => void,
) {
  const exit = (code: number) => exitSelfTest(code, cleanUp);
  const isReadyForKeys = async () =>
    hasPaintedSinceNavigation && (await isPageReady(window));
  const hasStartFailed = async () => (await readStartFailure(window)) !== null;
  const isSettled = async () =>
    (await isReadyForKeys()) || (await hasStartFailed());
  const isReady = await waitFor(isSettled);
  if (!isCurrent()) {
    return;
  }
  const startFailure = await readStartFailure(window);
  if (startFailure !== null) {
    failSelfTest('the page starts', startFailure, cleanUp);
    return;
  }
  if (!isReady) {
    report(false, 'page ready for keys');
    exit(1);
    return;
  }
  window.webContents.focus();

  let failures = 0;
  for (const script of handed) {
    const scriptFailures = await runScript(window, script, run, isCurrent);
    if (scriptFailures === null) {
      return;
    }
    failures += scriptFailures;
  }
  console.log(
    `[selftest] ${failures === 0 ? 'all passed' : `${failures} failed`}`,
  );
  exit(failures === 0 ? 0 : 1);
}

// Starts a fresh run of every handed script; a step that throws fails the
// self-test, unless a reload already interrupted the run.
function startRun(
  window: BrowserWindow,
  handed: readonly HandedScript[],
  cleanUp: () => void,
) {
  if (hasExited) {
    return;
  }
  const run = ++latestRun;
  const isCurrent = () => run === latestRun;
  runAllScripts(window, handed, run, isCurrent, cleanUp).catch((error) => {
    if (isCurrent()) {
      failSelfTest('the steps run', error, cleanUp);
    }
  });
}

// What the composition root holds: `hostFor` gives each plugin the host its
// part hands its script to, and `closeHandover`, called once every part has
// started, returns the merged page binds and settings of every handed script.
// With no script handed over, or scripts whose settings clash, `closeHandover`
// fails the self-test and exits.
export interface SelfTestDriver {
  hostFor(pluginId: string): SelfTestHost;
  closeHandover(): SelfTestConfig;
}

// `cleanUp` deletes what the self-test made outside the repo; it runs before
// the self-test exits. Each plugin hands at most one script while the parts
// start; a host throws on its plugin's second script or one handed over late.
// Every page load runs the handed scripts in hand-over order.
export function startSelfTest(
  window: BrowserWindow,
  cleanUp: () => void,
): SelfTestDriver {
  window.webContents.on('did-navigate', () => {
    // A run begun on the previous page stands down before its load finishes.
    latestRun++;
    hasPaintedSinceNavigation = false;
  });
  window.webContents.on('paint', () => {
    hasPaintedSinceNavigation = true;
  });
  const handed: HandedScript[] = [];
  let isHandoverClosed = false;
  return {
    hostFor: (pluginId) => ({
      run(script) {
        if (isHandoverClosed) {
          throw new Error(
            'A self-test script was handed over after the plugins started; hand it over during start',
          );
        }
        if (handed.some((entry) => entry.pluginId === pluginId)) {
          throw new Error(
            `Plugin ${pluginId} handed over a second self-test script; each plugin hands at most one`,
          );
        }
        handed.push({ pluginId, script });
      },
    }),
    closeHandover() {
      isHandoverClosed = true;
      if (handed.length === 0) {
        report(false, 'a plugin handed over a self-test script during start');
        exitSelfTest(1, cleanUp);
        return { pageBinds: [], settings: {} };
      }
      let config: SelfTestConfig;
      try {
        config = mergeSelfTestConfigs(handed);
      } catch (error) {
        failSelfTest('the self-test scripts merge', error, cleanUp);
        return { pageBinds: [], settings: {} };
      }
      window.webContents.on('did-finish-load', () =>
        startRun(window, handed, cleanUp),
      );
      return config;
    },
  };
}
