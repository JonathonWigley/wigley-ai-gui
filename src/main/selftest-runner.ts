import { writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import type { Files } from '../contracts/files';
import type {
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../contracts/plugin';
import { errorText } from '../shared/error-text';
import {
  PLACEMENT_CHECK_EVENT,
  UNPLACED_PREFIX,
} from '../shared/placement-check';
import type { DrivenWindow } from './drive/driven-window';
import {
  capturePng,
  cutOffAtWidth,
  type LogMark,
  markLog,
  press,
  readLog,
  resizeContentWidth,
  STEP_TIMEOUT_MS,
  waitForAnyNewLogLine,
  waitForNewLogLine,
  withPrimitiveClipping,
} from './drive/page-driver';
import type { ScriptRun } from './selftest-config';

// Runs one plugin's self-test script over a driven window: opens its fixture,
// walks its groups of steps, sets and holds the widths steps set, writes the
// files a step writes, drives its keys (again and again for a repeating step),
// and checks the lines the page logs, that the page fits the window's minimum
// width, and the result the script checks, saving the screenshots steps ask
// for. Imports no `electron`: the window is a `DrivenWindow`, so tests drive it
// over a fake.
//
// A run belongs to one page load, numbered by the window's navigation count,
// and stands down once the page has navigated past it: every press, resize,
// file write, report line and fixture open checks `isCurrent` with no await
// between the check and the act.

// The `isCurrent` of a run started on page load `load`: true while the window
// is still on that load and `hasExited` is false.
export function isOnLoad(
  window: DrivenWindow,
  load: number,
  hasExited: () => boolean,
): () => boolean {
  return () => window.navigationCount() === load && !hasExited();
}

// The lines of `lines` the keys plugin logged as unplaced binds, in the order
// given.
function unplacedLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.startsWith(UNPLACED_PREFIX));
}

// Asks the page to log the unplaced binds of every scope it has had in force,
// then fails on each unplaced line the page load logged, oldest first, or
// passes once when there is none. Returns how many there are.
export async function checkPlacement(window: DrivenWindow): Promise<number> {
  await window.run(
    `document.dispatchEvent(new Event(${JSON.stringify(PLACEMENT_CHECK_EVENT)}))`,
  );
  const unplaced = unplacedLines((await readLog(window)).reverse());
  for (const line of unplaced) {
    report(false, line);
  }
  if (unplaced.length === 0) {
    report(true, 'every key placed');
  }
  return unplaced.length;
}

// Prints one self-test check line.
export function report(passed: boolean, what: string) {
  console.log(`[selftest] ${passed ? 'PASS' : 'FAIL'} ${what}`);
}

// Saves a PNG of the window to `png` once the page has redrawn; returns why it
// was not saved, or null when it was. Writes nothing once `isCurrent` turns
// false during the capture, since the next load's run saves to the same path.
async function saveScreenshot(
  window: DrivenWindow,
  png: string,
  isCurrent: () => boolean,
): Promise<string | null> {
  const capture = await capturePng(window);
  if (typeof capture === 'string') {
    return capture;
  }
  if (!isCurrent()) {
    return 'the run stood down before the write';
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
async function settleWithin<T>(
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

// Presses each key with a short gap after it; false, pressing nothing more,
// once `isCurrent` turns false.
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
  const failure = await saveScreenshot(window, png, isCurrent);
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

// Waits up to `timeoutMs` for `expect` or `until` after the first press, and
// after each `expect` presses the keys again from a fresh mark, until `until`
// is logged, a press logs neither, or `max` presses ran without `until`. Saves
// `pngs[n - 1]` after the n-th press's wait when the step has screenshots.
async function repeatUntil(
  window: DrivenWindow,
  step: RepeatingStep,
  firstMark: LogMark,
  pngs: readonly string[],
  timeoutMs: number,
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
      timeoutMs,
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

// Which of `lines` `waitForLine` never saw, waiting for each in turn: after the
// first one missed, the rest share one wait, so a failure costs at most one more.
async function missingLines(
  lines: readonly (string | RegExp)[],
  waitForLine: (line: string | RegExp) => Promise<boolean>,
): Promise<(string | RegExp)[]> {
  for (const [index, line] of lines.entries()) {
    if (!(await waitForLine(line))) {
      const rest = lines.slice(index + 1);
      const isLogged = await Promise.all(rest.map(waitForLine));
      return [line, ...rest.filter((_, each) => !isLogged[each])];
    }
  }
  return [];
}

// The report text of `lines`, naming those missing.
function linesReport(
  lines: readonly (string | RegExp)[],
  missing: readonly (string | RegExp)[],
): string {
  const expected = lines.join(' and ');
  return missing.length === 0
    ? expected
    : `${expected}: ${missing.join(' and ')} never logged`;
}

// Waits up to `timeoutMs` for the step's line, then for a line each of its
// `alsoExpect` patterns matches, and reports them, naming any that never came,
// then saves the window to `png` when the step has one.
async function waitForStepLine(
  window: DrivenWindow,
  step: SelfTestStep,
  mark: LogMark,
  label: string,
  png: string | undefined,
  timeoutMs: number,
  isCurrent: () => boolean,
): Promise<{ passed: boolean; isSaved: boolean }> {
  const lines = [step.expect, ...(step.alsoExpect ?? [])];
  const missing = await missingLines(lines, (line) =>
    waitForNewLogLine(window, line, mark, timeoutMs),
  );
  const passed = missing.length === 0;
  if (isCurrent()) {
    report(passed, `${label} -> ${linesReport(lines, missing)}`);
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
  timeoutMs: number,
  isCurrent: () => boolean,
): Promise<{ passed: boolean; isSaved: boolean }> {
  const outcome = await repeatUntil(
    window,
    step,
    mark,
    pngs,
    timeoutMs,
    isCurrent,
  );
  if (isCurrent()) {
    const failure = outcome.failure === null ? '' : `: ${outcome.failure}`;
    report(
      outcome.passed,
      `${label} ×${outcome.presses} -> ${step.repeat.until}${failure}`,
    );
  }
  return outcome;
}

// The step's write, removal and keys as its report line names them.
function stepLabel(step: SelfTestStep): string {
  return [
    ...(step.writeFile ? [`write ${step.writeFile.path}`] : []),
    ...(step.remove === undefined ? [] : [`remove ${step.remove}`]),
    step.keys.join('').replaceAll(' ', '␣'),
  ]
    .filter((part) => part !== '')
    .join(', ');
}

// Sets the step's `width` (`'start'` being `startWidth`) when it has one,
// writes its file and then removes its `remove` path through `homeFiles`
// (rooted at the self-test's temp home, so a path outside it rejects), presses
// its keys, and waits for its line; a repeating step presses again after each
// `expect` until its `until` line, each line waited for up to the step's own
// `timeoutMs`, else `runTimeoutMs`. The log is marked before the resize, the
// write and the removal, so a line any of them alone causes counts. A width
// that never lands fails the step before its write and keys. Then, whether the
// line came or not, saves the window to each of `pngs` the presses reached,
// and, when the step passed, runs its fit check, at the minimum width or the
// held one, which resizes the window, so it comes after the screenshots, and
// returns to the width the step left.
async function runStep(
  window: DrivenWindow,
  homeFiles: Files,
  step: SelfTestStep,
  pngs: readonly string[],
  startWidth: number,
  scrollsItself: string[],
  runTimeoutMs: number,
  isCurrent: () => boolean,
): Promise<boolean> {
  const timeoutMs = step.timeoutMs ?? runTimeoutMs;
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
  if (step.remove !== undefined) {
    if (!isCurrent()) {
      return false;
    }
    await homeFiles.trash(step.remove);
  }
  if (!(await pressKeys(window, step.keys, isCurrent))) {
    return false;
  }
  const { passed, isSaved } =
    step.repeat === undefined
      ? await waitForStepLine(
          window,
          step,
          mark,
          label,
          pngs[0],
          timeoutMs,
          isCurrent,
        )
      : await repeatStep(
          window,
          { ...step, repeat: step.repeat },
          mark,
          label,
          pngs,
          timeoutMs,
          isCurrent,
        );
  if (!passed || !isSaved || !step.checksFit) {
    return passed && isSaved;
  }
  const isHeld = step.checksFit === 'held';
  const cutOff = await cutOffAtWidth(
    window,
    isHeld ? window.contentSize().width : window.minimumWidth(),
    scrollsItself,
    isCurrent,
  );
  if (isCurrent()) {
    report(
      cutOff.length === 0,
      `${label} fits the ${isHeld ? 'held' : 'minimum'} width: ${cutOff.join('; ') || 'nothing cut off'}`,
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
// steps; the shown line, its `alsoShown` lines and each step's lines are
// waited for up to `stepTimeoutMs`, a result that has not settled within it
// once the steps end fails as timed out, and a result that rejects, even
// before the steps end, stops the run and rejects with its error. The window starts and ends the
// script at `startWidth`, the content width the self-test started on: a run
// that opens on another (a reload interrupted a held width) resizes back first,
// and a width a step held is restored once the result is checked. `screenshots`
// maps each step that saves PNGs to their paths, and the fit check lets the
// script's `scrollsItself` and the primitives' clipping parts clip. `load` is
// the page load the run belongs to, which the fixture opens under, and
// `isCurrent` (`isOnLoad` of it) whether the run still owns the window.
// Without `checksResult` the result is left unchecked, a skip line saying so,
// unless it has rejected by the time the script ends, which rejects with its
// error: a script cut short is the run's last (`selectScripts`), so that is the
// end of the run. Returns how many checks failed, or null when a reload
// interrupted the run.
export async function runScript(
  window: DrivenWindow,
  homeFiles: Files,
  { pluginId, script, checksResult }: ScriptRun,
  screenshots: ReadonlyMap<SelfTestStep, readonly string[]>,
  startWidth: number,
  load: number,
  isCurrent: () => boolean,
  stepTimeoutMs = STEP_TIMEOUT_MS,
): Promise<number | null> {
  const mark = await markLog(window);
  // The page may have navigated while the log was read.
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
  // The page may have navigated while the width was restored.
  if (!isCurrent()) {
    return null;
  }
  const { shownLine, alsoShown, result } = script.open(load);
  const settled: { hasRejected: boolean; error?: unknown } = {
    hasRejected: false,
  };
  result.catch((error: unknown) => {
    settled.hasRejected = true;
    settled.error = error;
  });
  // Rejects with the result's error and otherwise never settles, so a wait
  // raced against it ends as soon as the result rejects.
  const rejection = result.then(() => new Promise<never>(() => {}));
  const shownLines = [shownLine, ...(alsoShown ?? [])];
  const missingShown = await missingLines(shownLines, (line) =>
    Promise.race([
      waitForNewLogLine(window, line, mark, stepTimeoutMs),
      rejection,
    ]),
  );
  const isShown = missingShown.length === 0;
  if (!isShown) {
    failures++;
  }
  if (isCurrent()) {
    report(isShown, linesReport(shownLines, missingShown));
  }

  const scrollsItself = withPrimitiveClipping(script.scrollsItself);
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
          stepTimeoutMs,
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
  failures += await checkResult(
    pluginId,
    script,
    result,
    checksResult,
    stepTimeoutMs,
    isCurrent,
  );
  if (!isCurrent()) {
    return null;
  }
  if (!(await restoreStartWidth(window, pluginId, startWidth, isCurrent))) {
    failures++;
  }
  if (!isCurrent()) {
    return null;
  }
  // A skipped result, or a checked one that timed out in `settleWithin`, that
  // has rejected by now: a checked one that rejected in time rejected there.
  if (settled.hasRejected) {
    throw settled.error;
  }
  return failures;
}

// Checks the script's result once it settles within `stepTimeoutMs`, reporting
// it under `pluginId`, or without `checksResult` prints that it was skipped;
// returns how many checks failed. Reports nothing once the run stands down.
async function checkResult(
  pluginId: string,
  script: SelfTestScript,
  result: Promise<unknown>,
  checksResult: boolean,
  stepTimeoutMs: number,
  isCurrent: () => boolean,
): Promise<number> {
  if (!checksResult) {
    if (isCurrent()) {
      console.log(
        `[selftest] SKIP ${pluginId} result: the run left out its later groups`,
      );
    }
    return 0;
  }
  const outcome = await settleWithin(result, stepTimeoutMs);
  if (!isCurrent()) {
    return 0;
  }
  if (outcome.timedOut) {
    report(
      false,
      `${pluginId} result did not settle within ${stepTimeoutMs} ms`,
    );
    return 1;
  }
  const problems = script.problems(outcome.value);
  report(
    problems.length === 0,
    `${pluginId} result ${problems.join(', ') || 'as expected'}`,
  );
  return problems.length > 0 ? 1 : 0;
}
