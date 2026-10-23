import { app, type BrowserWindow } from 'electron';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import path from 'node:path';
import type { Files } from '../contracts/files';
import type {
  SelfTestGroup,
  SelfTestHost,
  SelfTestStep,
} from '../contracts/plugin';
import { errorText } from '../shared/error-text';
import type { DrivenWindow } from './drive/driven-window';
import {
  capturePng,
  cutOffAtWidth,
  isReadyForKeys,
  type LogMark,
  markLog,
  press,
  readStartFailure,
  resizeContentWidth,
  STEP_TIMEOUT_MS,
  waitFor,
  waitForAnyNewLogLine,
  waitForNewLogLine,
  withPrimitiveEllipsis,
} from './drive/page-driver';
import { electronDrivenWindow } from './electron-driven-window';
import {
  checkGroups,
  type HandedScript,
  mergeSelfTestConfigs,
  type SelfTestConfig,
  screenshotFiles,
} from './selftest-config';

// Runs the plugins' self-test scripts on every page load, one after another:
// opens each script's fixture, walks its groups of steps, sets and holds the
// widths steps set, writes the files a step writes, drives its keys (again and
// again for a repeating step) into the page through Electron's input
// pipeline, and checks the lines the
// page logs, that the page fits the window's minimum width, and the result the
// script checks, saving the screenshots steps ask for. Run with
// `npm run selftest`; exits non-zero on failure.

function report(passed: boolean, what: string) {
  console.log(`[selftest] ${passed ? 'PASS' : 'FAIL'} ${what}`);
}

let hasExited = false;

// Exits with `code` once `cleanUp` settles, since app.exit skips quit
// handlers; a cleanup that throws or rejects is reported on stderr and the
// exit keeps `code`. Only the first exit counts: a run a late page load starts
// during the cleanup or after it stays quiet.
async function exitSelfTest(code: number, cleanUp: () => Promise<void>) {
  if (hasExited) {
    return;
  }
  hasExited = true;
  try {
    await cleanUp();
  } catch (error) {
    console.error(`[selftest] cleanup failed: ${errorText(error)}`);
  } finally {
    app.exit(code);
  }
}

// Reports `what` as failed with `error`'s text, and exits non-zero once
// `cleanUp` settles; after the self-test has begun to exit, does nothing.
export function failSelfTest(
  what: string,
  error: unknown,
  cleanUp: () => Promise<void>,
) {
  if (hasExited) {
    return;
  }
  report(false, `${what}: ${errorText(error)}`);
  void exitSelfTest(1, cleanUp);
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

// What `result` resolves to, or `timedOut` when it has not settled within
// `timeoutMs`; a rejection rejects. The result is left running.
export async function settleWithin<T>(
  result: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    return await Promise.race([
      result.then((value) => ({ timedOut: false as const, value })),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Forge's dev server can reload the page once at startup, so every load starts
// a fresh run and a run that a reload interrupted stands down.
let latestRun = 0;

// Presses each key with a short gap after it; false, pressing nothing more,
// once a later run has begun.
async function pressKeys(
  window: DrivenWindow,
  keys: readonly string[],
  isCurrent: () => boolean,
): Promise<boolean> {
  for (const key of keys) {
    if (!isCurrent()) {
      return false;
    }
    press(window, key);
    await wait(30);
  }
  return true;
}

// Saves the window to `png` and reports the save; true when it was saved.
async function saveStepScreenshot(
  window: DrivenWindow,
  png: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  const failure = await saveScreenshot(window, png);
  const isSaved = failure === null;
  if (isCurrent()) {
    report(isSaved, `screenshot ${png}${isSaved ? '' : `: ${failure}`}`);
  }
  return isSaved;
}

type RepeatingStep = SelfTestStep & Required<Pick<SelfTestStep, 'repeat'>>;

// How a repeating step's presses went: whether `until` came, how many
// presses ran, why it failed when it did, and whether every screenshot saved.
interface RepeatOutcome {
  passed: boolean;
  presses: number;
  failure: string | null;
  isSaved: boolean;
}

// Waits for `expect` or `until` after the first press, and after each
// `expect` presses the keys again from a fresh mark, until `until` is logged,
// a press logs neither, or `max` presses ran without `until`. Saves
// `pngs[n - 1]` after the n-th press's wait when the step has screenshots.
async function repeatUntil(
  window: DrivenWindow,
  step: RepeatingStep,
  firstMark: LogMark,
  pngs: readonly string[],
  isCurrent: () => boolean,
): Promise<RepeatOutcome> {
  const { until, max } = step.repeat;
  let mark = firstMark;
  let isSaved = true;
  for (let presses = 1; ; presses++) {
    if (presses > 1) {
      mark = await markLog(window);
      if (!(await pressKeys(window, step.keys, isCurrent))) {
        return { passed: false, presses, failure: null, isSaved };
      }
    }
    const logged = await waitForAnyNewLogLine(
      window,
      [until, step.expect],
      mark,
    );
    if (pngs.length > 0 && isCurrent()) {
      isSaved =
        (await saveStepScreenshot(window, pngs[presses - 1], isCurrent)) &&
        isSaved;
    }
    if (logged === null) {
      const failure = `${step.expect} or ${until} never logged after press ${presses}`;
      return { passed: false, presses, failure, isSaved };
    }
    if (logged === until) {
      return { passed: true, presses, failure: null, isSaved };
    }
    if (presses >= max) {
      const failure = `${until} not reached in ${max} presses`;
      return { passed: false, presses, failure, isSaved };
    }
  }
}

// Waits for the step's line and reports it, then saves the window to `png`
// when the step has one.
async function waitForStepLine(
  window: DrivenWindow,
  step: SelfTestStep,
  mark: LogMark,
  label: string,
  png: string | undefined,
  isCurrent: () => boolean,
): Promise<{ passed: boolean; isSaved: boolean }> {
  const passed = await waitForNewLogLine(window, step.expect, mark);
  if (isCurrent()) {
    report(passed, `${label} -> ${step.expect}`);
  }
  const isSaved =
    png === undefined || !isCurrent()
      ? true
      : await saveStepScreenshot(window, png, isCurrent);
  return { passed, isSaved };
}

// Runs a repeating step's presses and reports them as one line,
// `<label> ×<presses> -> <until>`, with why when it failed.
async function repeatStep(
  window: DrivenWindow,
  step: RepeatingStep,
  mark: LogMark,
  label: string,
  pngs: readonly string[],
  isCurrent: () => boolean,
): Promise<{ passed: boolean; isSaved: boolean }> {
  const outcome = await repeatUntil(window, step, mark, pngs, isCurrent);
  if (isCurrent()) {
    const failure = outcome.failure === null ? '' : `: ${outcome.failure}`;
    report(
      outcome.passed,
      `${label} ×${outcome.presses} -> ${step.repeat.until}${failure}`,
    );
  }
  return outcome;
}

// The step's write and keys as its report line names them.
function stepLabel(step: SelfTestStep): string {
  return [
    ...(step.writeFile ? [`write ${step.writeFile.path}`] : []),
    step.keys.join('').replaceAll(' ', '␣'),
  ]
    .filter((part) => part !== '')
    .join(', ');
}

// Sets the step's `width` (`'start'` being `startWidth`) when it has one,
// writes its file through `homeFiles` (rooted at the self-test's temp home, so
// a path outside it rejects), presses its keys, and waits for its line; a
// repeating step presses again after each `expect` until its `until` line.
// The log is marked before the resize and the write, so a line either alone
// causes counts. A width that never lands fails the step before its write and
// keys. Then, whether the line came or not, saves the window to each of
// `pngs` the presses reached, and, when the step passed, runs its fit check,
// which resizes the window, so it comes after the screenshots, and returns to
// the width the step left.
async function runStep(
  window: DrivenWindow,
  homeFiles: Files,
  step: SelfTestStep,
  pngs: readonly string[],
  startWidth: number,
  scrollsItself: string[],
  isCurrent: () => boolean,
): Promise<boolean> {
  const label = stepLabel(step);
  const mark = await markLog(window);
  if (step.width !== undefined) {
    if (!isCurrent()) {
      return false;
    }
    const width = step.width === 'start' ? startWidth : step.width;
    if (!(await resizeContentWidth(window, width))) {
      if (isCurrent()) {
        report(
          false,
          `${label} -> ${step.expect}: width ${width} never landed`,
        );
      }
      return false;
    }
  }
  if (step.writeFile) {
    if (!isCurrent()) {
      return false;
    }
    await homeFiles.write(step.writeFile.path, step.writeFile.text);
  }
  if (!(await pressKeys(window, step.keys, isCurrent))) {
    return false;
  }
  const { passed, isSaved } =
    step.repeat === undefined
      ? await waitForStepLine(window, step, mark, label, pngs[0], isCurrent)
      : await repeatStep(
          window,
          { ...step, repeat: step.repeat },
          mark,
          label,
          pngs,
          isCurrent,
        );
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
      `${label} fits the minimum width: ${cutOff.join('; ') || 'nothing cut off'}`,
    );
  }
  return cutOff.length === 0;
}

// Resizes the window back to `startWidth` when a held width left it at
// another, reporting a resize that never lands under `pluginId`; true when the
// window is at `startWidth`.
async function restoreStartWidth(
  window: DrivenWindow,
  pluginId: string,
  startWidth: number,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (window.contentSize().width === startWidth) {
    return true;
  }
  const hasRestored = await resizeContentWidth(window, startWidth);
  if (!hasRestored && isCurrent()) {
    report(false, `${pluginId} start width ${startWidth} never landed`);
  }
  return hasRestored;
}

// Prints a failed step's group why, and the step's own why when it has one.
function reportWhys(group: SelfTestGroup, step: SelfTestStep) {
  console.log(`[selftest]   group why: ${group.why}`);
  if (step.why !== undefined) {
    console.log(`[selftest]   step why: ${step.why}`);
  }
}

// Opens the script's fixture, runs its groups' steps in order and checks its
// result, reporting each under `pluginId` and each group's name before its
// steps; a result that has not settled within the step timeout once the
// steps end fails as timed out, and a result that rejects, even before the
// steps end, stops the run and rejects with its error. The window starts and
// ends the script at `startWidth`, the content width the self-test started
// on: a run that opens on another (a reload interrupted a held width) resizes
// back first, and a width a step held is restored once the result is checked.
// `screenshots` maps each step that saves PNGs to their paths, and the fit
// check lets the script's `scrollsItself` and the primitives' ellipsis parts
// clip. Returns how many checks failed, or null when a reload interrupted the
// run.
export async function runScript(
  window: DrivenWindow,
  homeFiles: Files,
  { pluginId, script }: HandedScript,
  screenshots: ReadonlyMap<SelfTestStep, readonly string[]>,
  startWidth: number,
  run: number,
  isCurrent: () => boolean,
): Promise<number | null> {
  const mark = await markLog(window);
  // A later run may have begun while the log was read.
  if (!isCurrent()) {
    return null;
  }
  let failures = (await restoreStartWidth(
    window,
    pluginId,
    startWidth,
    isCurrent,
  ))
    ? 0
    : 1;
  const { shownLine, result } = script.open(run);
  // Rejects with the result's error and otherwise never settles, so a wait
  // raced against it ends as soon as the result rejects.
  const rejection = result.then(() => new Promise<never>(() => {}));
  const isShown = await Promise.race([
    waitForNewLogLine(window, shownLine, mark),
    rejection,
  ]);
  if (!isShown) {
    failures++;
  }
  if (isCurrent()) {
    report(isShown, shownLine);
  }

  const scrollsItself = withPrimitiveEllipsis(script.scrollsItself);
  for (const group of script.groups) {
    if (!isCurrent()) {
      return null;
    }
    console.log(`[selftest] group ${pluginId}: ${group.name}`);
    for (const step of group.steps) {
      if (!isCurrent()) {
        return null;
      }
      const passed = await Promise.race([
        runStep(
          window,
          homeFiles,
          step,
          screenshots.get(step) ?? [],
          startWidth,
          scrollsItself,
          isCurrent,
        ),
        rejection,
      ]);
      if (!passed) {
        failures++;
        if (isCurrent()) {
          reportWhys(group, step);
        }
      }
    }
  }
  const outcome = await settleWithin(result, STEP_TIMEOUT_MS);
  if (!isCurrent()) {
    return null;
  }
  if (outcome.timedOut) {
    report(
      false,
      `${pluginId} result did not settle within ${STEP_TIMEOUT_MS} ms`,
    );
    failures++;
  } else {
    const problems = script.problems(outcome.value);
    report(
      problems.length === 0,
      `${pluginId} result ${problems.join(', ') || 'as expected'}`,
    );
    if (problems.length > 0) {
      failures++;
    }
  }
  if (!(await restoreStartWidth(window, pluginId, startWidth, isCurrent))) {
    failures++;
  }
  return isCurrent() ? failures : null;
}

// Waits for the page to be ready for keys and focuses it, acting as the
// focused window as a drive run's page does, then runs every handed script in
// hand-over order; a failing script does not stop the next.
async function runAllScripts(
  window: DrivenWindow,
  homeFiles: Files,
  handed: readonly HandedScript[],
  screenshots: ReadonlyMap<SelfTestStep, readonly string[]>,
  startWidth: number,
  run: number,
  isCurrent: () => boolean,
  cleanUp: () => Promise<void>,
) {
  const exit = (code: number) => void exitSelfTest(code, cleanUp);
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
  await window.emulateFocus();
  if (!isCurrent()) {
    return;
  }

  let failures = 0;
  for (const script of handed) {
    const scriptFailures = await runScript(
      window,
      homeFiles,
      script,
      screenshots,
      startWidth,
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

// Starts a fresh run of every handed script; a step that throws or a script
// result that rejects fails the self-test, unless a reload already interrupted
// the run. The run stands down once the self-test begins to exit, so a step
// still running when its script's result rejected presses, saves and reports
// nothing more.
function startRun(
  window: DrivenWindow,
  homeFiles: Files,
  handed: readonly HandedScript[],
  screenshots: ReadonlyMap<SelfTestStep, readonly string[]>,
  startWidth: number,
  cleanUp: () => Promise<void>,
) {
  if (hasExited) {
    return;
  }
  const run = ++latestRun;
  const isCurrent = () => run === latestRun && !hasExited;
  runAllScripts(
    window,
    homeFiles,
    handed,
    screenshots,
    startWidth,
    run,
    isCurrent,
    cleanUp,
  ).catch((error) => {
    if (isCurrent()) {
      failSelfTest('the steps run', error, cleanUp);
    }
  });
}

// Removes the folder's entries and keeps the folder, creating it when missing:
// on Windows a removed folder stays delete-pending for a moment, and creating
// it again in that moment fails with EPERM.
function emptyFolder(folder: string): void {
  mkdirSync(folder, { recursive: true });
  for (const entry of readdirSync(folder)) {
    rmSync(path.join(folder, entry), { recursive: true, force: true });
  }
}

// What the composition root holds: `hostFor` gives each plugin the host its
// part hands its script to, and `closeHandover`, called once every part has
// started, returns the merged page binds and settings of every handed script.
// With no script handed over, scripts whose settings clash, groups or steps
// `checkGroups` rejects, or steps whose screenshot names are malformed or
// save one file, `closeHandover` fails the self-test and exits.
export interface SelfTestDriver {
  hostFor(pluginId: string): SelfTestHost;
  closeHandover(): SelfTestConfig;
}

// `homeFiles` is the files service rooted at the self-test's temp home, which
// steps' `writeFile` writes through. `cleanUp` closes what holds files there
// and deletes what the self-test made outside the repo; the self-test awaits
// it before it exits. `screenshotFolder` is
// emptied here, so it ends the run holding only that run's PNGs. Each plugin
// hands at most one script while the parts start; a host throws on its
// plugin's second script or one handed over late. Every page load runs the
// handed scripts in hand-over order. The window's content width as the
// self-test starts is the width every script starts and ends on.
export function startSelfTest(
  window: BrowserWindow,
  homeFiles: Files,
  cleanUp: () => Promise<void>,
  screenshotFolder: string,
): SelfTestDriver {
  emptyFolder(screenshotFolder);
  const drivenWindow = electronDrivenWindow(window);
  const startWidth = drivenWindow.contentSize().width;
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
        void exitSelfTest(1, cleanUp);
        return { pageBinds: [], settings: {} };
      }
      let config: SelfTestConfig;
      try {
        config = mergeSelfTestConfigs(handed);
      } catch (error) {
        failSelfTest('the self-test scripts merge', error, cleanUp);
        return { pageBinds: [], settings: {} };
      }
      try {
        checkGroups(handed);
      } catch (error) {
        failSelfTest('the self-test groups check', error, cleanUp);
        return { pageBinds: [], settings: {} };
      }
      let screenshots: Map<SelfTestStep, string[]>;
      try {
        screenshots = new Map(
          [...screenshotFiles(handed)].map(([step, files]) => [
            step,
            files.map((file) => path.join(screenshotFolder, file)),
          ]),
        );
      } catch (error) {
        failSelfTest('the self-test screenshots name', error, cleanUp);
        return { pageBinds: [], settings: {} };
      }
      window.webContents.on('did-finish-load', () =>
        startRun(
          drivenWindow,
          homeFiles,
          handed,
          screenshots,
          startWidth,
          cleanUp,
        ),
      );
      return config;
    },
  };
}
