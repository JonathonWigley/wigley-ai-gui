import { app, type BrowserWindow } from 'electron';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import path from 'node:path';
import type { Files } from '../contracts/files';
import type { SelfTestHost, SelfTestStep } from '../contracts/plugin';
import { errorText } from '../shared/error-text';
import type { DrivenWindow } from './drive/driven-window';
import {
  capturePng,
  cutOffAtWidth,
  isReadyForKeys,
  press,
  readLog,
  readStartFailure,
  waitFor,
  waitForNewLogLine,
  withPrimitiveEllipsis,
} from './drive/page-driver';
import { electronDrivenWindow } from './electron-driven-window';
import {
  type HandedScript,
  mergeSelfTestConfigs,
  type SelfTestConfig,
  screenshotFiles,
} from './selftest-config';

// Runs the plugins' self-test scripts on every page load, one after another:
// opens each script's fixture, writes the files a step writes, drives its keys
// into the page through Electron's input pipeline, and checks the lines the
// page logs, that the page fits the window's minimum width, and the result the
// script checks, saving the screenshots steps ask for. Run with
// `npm run selftest`; exits non-zero on failure.

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

// Saves a PNG of the window to `png` once the page has redrawn; returns why it
// was not saved, or null when it was.
async function saveScreenshot(
  window: DrivenWindow,
  png: string,
): Promise<string | null> {
  const capture = await capturePng(window);
  if (typeof capture === 'string') {
    return capture;
  }
  try {
    await writeFile(png, capture);
    return null;
  } catch (error) {
    return errorText(error);
  }
}

// Forge's dev server can reload the page once at startup, so every load starts
// a fresh run and a run that a reload interrupted stands down.
let latestRun = 0;

// Writes the step's file through `homeFiles` (rooted at the self-test's temp
// home, so a path outside it rejects), presses its keys, and waits for its
// line; the log is counted before the write, so a line the write alone
// causes counts. Then, whether the line came or not, saves the window to
// `png` when the step has one, and, when the line came, runs the step's fit
// check, which resizes the window and so comes after the screenshot.
async function runStep(
  window: DrivenWindow,
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
  const cutOff = await cutOffAtWidth(
    window,
    window.minimumWidth(),
    scrollsItself,
  );
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
  window: DrivenWindow,
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
  window: DrivenWindow,
  homeFiles: Files,
  handed: readonly HandedScript[],
  screenshots: ReadonlyMap<SelfTestStep, string>,
  run: number,
  isCurrent: () => boolean,
  cleanUp: () => void,
) {
  const exit = (code: number) => exitSelfTest(code, cleanUp);
  // Chromium drops input that reaches a page before the page's first frame,
  // and only an offscreen window reports its frames, so a visible-window
  // self-test would time out here.
  const hasStartFailed = async () => (await readStartFailure(window)) !== null;
  const isSettled = async () =>
    (await isReadyForKeys(window)) || (await hasStartFailed());
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
  window.focus();

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
  window: DrivenWindow,
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
  const drivenWindow = electronDrivenWindow(window);
  window.webContents.on('did-navigate', () => {
    // A run begun on the previous page stands down before its load finishes.
    latestRun++;
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
        startRun(drivenWindow, homeFiles, handed, screenshots, cleanUp),
      );
      return config;
    },
  };
}
