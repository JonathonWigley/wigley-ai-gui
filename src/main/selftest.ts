import { app, type BrowserWindow } from 'electron';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Files } from '../contracts/files';
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
  screenshotFiles,
  withPrimitiveEllipsis,
} from './selftest-config';

// Runs the plugins' self-test scripts on every page load, one after another:
// opens each script's fixture, writes the files a step writes, drives its keys
// into the page through Electron's input pipeline, and checks the lines the
// page logs, that the page fits the window's minimum width, and the result the
// script checks, saving the screenshots steps ask for. Run with
// `npm run selftest`; exits non-zero on failure.

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

// The core shell's elements that clip their own text with an ellipsis.
const CORE_SCROLLS_ITSELF = ['.title-bar-context'];

// Lists what the page cuts off on the right: an element whose content is wider
// than its box, or that ends past the window, skipping the elements the
// `scrollsItself` selectors and the core's own match, and everything inside
// them.
function cutOffScript(scrollsItself: string[]): string {
  return `(() => {
  const scrollsItself = ${JSON.stringify([...CORE_SCROLLS_ITSELF, ...scrollsItself])};
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
// reloads mid-wait). The fit check waits after a resize, and a screenshot
// before its capture: a change reaches the editors' ResizeObserver in the
// first frame, which asks vim to redraw its cursor in the next, and the third
// starts after that redraw.
async function waitForRedraw(window: BrowserWindow): Promise<boolean> {
  await window.webContents.executeJavaScript(`{
  window.redrawFrames = 0;
  const frame = () => {
    window.redrawFrames += 1;
    if (window.redrawFrames < 3) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}`);
  return waitFor(
    async () =>
      (await window.webContents.executeJavaScript('window.redrawFrames')) >= 3,
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
  const hasRedrawn = hasNarrowed && (await waitForRedraw(window));
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

// Saves a PNG of the window to `png` once the page has redrawn; returns why it
// was not saved, or null when it was.
async function saveScreenshot(
  window: BrowserWindow,
  png: string,
): Promise<string | null> {
  if (!(await waitForRedraw(window))) {
    return 'the page produced no frames';
  }
  try {
    const image = await window.webContents.capturePage(undefined, {
      stayHidden: true,
    });
    if (image.isEmpty()) {
      return 'the capture came back empty';
    }
    await writeFile(png, image.toPNG());
    return null;
  } catch (error) {
    return errorText(error);
  }
}

// Forge's dev server can reload the page once at startup, so every load starts
// a fresh run and a run that a reload interrupted stands down.
let latestRun = 0;
// Chromium drops input that reaches a page before the page's first frame.
// `paint` fires only for an offscreen window, and self-test windows are
// offscreen (window.ts), so a visible-window self-test would time out here.
let hasPaintedSinceNavigation = false;

// Writes the step's file through `homeFiles` (rooted at the self-test's temp
// home, so a path outside it rejects), presses its keys, and waits for its
// line; the log is counted before the write, so a line the write alone
// causes counts. Then, whether the line came or not, saves the window to
// `png` when the step has one, and, when the line came, runs the step's fit
// check, which resizes the window and so comes after the screenshot.
async function runStep(
  window: BrowserWindow,
  homeFiles: Files,
  step: SelfTestStep,
  png: string | null,
  scrollsItself: string[],
  isCurrent: () => boolean,
): Promise<boolean> {
  const seen = (await readLog(window)).length;
  if (step.writeFile) {
    if (!isCurrent()) {
      return false;
    }
    await homeFiles.write(step.writeFile.path, step.writeFile.text);
  }
  for (const key of step.keys) {
    if (!isCurrent()) {
      return false;
    }
    press(window, key);
    await wait(30);
  }
  const passed = await waitForNewLogLine(window, step.expect, seen);
  const keys = [
    ...(step.writeFile ? [`write ${step.writeFile.path}`] : []),
    step.keys.join('').replaceAll(' ', '␣'),
  ]
    .filter((part) => part !== '')
    .join(', ');
  if (isCurrent()) {
    report(passed, `${keys} -> ${step.expect}`);
  }
  let isSaved = true;
  if (png !== null && isCurrent()) {
    const failure = await saveScreenshot(window, png);
    isSaved = failure === null;
    if (isCurrent()) {
      report(isSaved, `screenshot ${png}${isSaved ? '' : `: ${failure}`}`);
    }
  }
  if (!passed || !isSaved || !step.checksFit) {
    return passed && isSaved;
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
// each under `pluginId`; `screenshots` maps each step that saves a PNG to its
// path, and the fit check lets the script's `scrollsItself` and the
// primitives' ellipsis parts clip. Returns how many checks failed, or null
// when a reload interrupted the run.
async function runScript(
  window: BrowserWindow,
  homeFiles: Files,
  { pluginId, script }: HandedScript,
  screenshots: ReadonlyMap<SelfTestStep, string>,
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

  const scrollsItself = withPrimitiveEllipsis(script.scrollsItself);
  for (const step of script.steps) {
    if (!isCurrent()) {
      return null;
    }
    const passed = await runStep(
      window,
      homeFiles,
      step,
      screenshots.get(step) ?? null,
      scrollsItself,
      isCurrent,
    );
    if (!passed) {
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
  homeFiles: Files,
  handed: readonly HandedScript[],
  screenshots: ReadonlyMap<SelfTestStep, string>,
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
    const scriptFailures = await runScript(
      window,
      homeFiles,
      script,
      screenshots,
      run,
      isCurrent,
    );
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
  homeFiles: Files,
  handed: readonly HandedScript[],
  screenshots: ReadonlyMap<SelfTestStep, string>,
  cleanUp: () => void,
) {
  if (hasExited) {
    return;
  }
  const run = ++latestRun;
  const isCurrent = () => run === latestRun;
  runAllScripts(
    window,
    homeFiles,
    handed,
    screenshots,
    run,
    isCurrent,
    cleanUp,
  ).catch((error) => {
    if (isCurrent()) {
      failSelfTest('the steps run', error, cleanUp);
    }
  });
}

// What the composition root holds: `hostFor` gives each plugin the host its
// part hands its script to, and `closeHandover`, called once every part has
// started, returns the merged page binds and settings of every handed script.
// With no script handed over, scripts whose settings clash, or steps whose
// screenshot names are malformed or save one file, `closeHandover` fails the
// self-test and exits.
export interface SelfTestDriver {
  hostFor(pluginId: string): SelfTestHost;
  closeHandover(): SelfTestConfig;
}

// `homeFiles` is the files service rooted at the self-test's temp home, which
// steps' `writeFile` writes through. `cleanUp` deletes what the self-test made
// outside the repo; it runs before the self-test exits. `screenshotFolder` is
// emptied here, so it ends the run holding only that run's PNGs. Each plugin
// hands at most one script while the parts start; a host throws on its
// plugin's second script or one handed over late. Every page load runs the
// handed scripts in hand-over order.
export function startSelfTest(
  window: BrowserWindow,
  homeFiles: Files,
  cleanUp: () => void,
  screenshotFolder: string,
): SelfTestDriver {
  rmSync(screenshotFolder, { recursive: true, force: true });
  mkdirSync(screenshotFolder, { recursive: true });
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
      let screenshots: Map<SelfTestStep, string>;
      try {
        screenshots = new Map(
          [...screenshotFiles(handed)].map(([step, file]) => [
            step,
            path.join(screenshotFolder, file),
          ]),
        );
      } catch (error) {
        failSelfTest('the self-test screenshots name', error, cleanUp);
        return { pageBinds: [], settings: {} };
      }
      window.webContents.on('did-finish-load', () =>
        startRun(window, homeFiles, handed, screenshots, cleanUp),
      );
      return config;
    },
  };
}
