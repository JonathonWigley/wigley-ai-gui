import { app, type BrowserWindow } from 'electron';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Files } from '../contracts/files';
import type { SelfTestHost, SelfTestStep } from '../contracts/plugin';
import { errorText } from '../shared/error-text';
import type { DrivenWindow } from './drive/driven-window';
import { isReadyForKeys, readStartFailure, waitFor } from './drive/page-driver';
import { electronDrivenWindow } from './electron-driven-window';
import {
  checkGroups,
  type HandedScript,
  mergeSelfTestConfigs,
  type SelfTestConfig,
  screenshotFiles,
} from './selftest-config';
import { isOnLoad, report, runScript } from './selftest-runner';

// Runs the plugins' self-test scripts on every page load, one after another,
// each through `runScript`, which drives its keys into the page through
// Electron's input pipeline; takes the scripts the plugins hand over, starts a
// fresh run on each page load, and exits once the run ends. Run with
// `npm run selftest`; exits non-zero on failure.

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

// Forge's dev server can reload the page once at startup, so every load starts
// a fresh run, numbered by the window's navigation count, and a run that a
// reload interrupted stands down. The load that started the latest run, so a
// load starts at most one.
let startedLoad = 0;

// Waits for the page to be ready for keys and focuses it, acting as the
// focused window as a drive run's page does, then runs every handed script in
// hand-over order; a failing script does not stop the next.
async function runAllScripts(
  window: DrivenWindow,
  homeFiles: Files,
  handed: readonly HandedScript[],
  screenshots: ReadonlyMap<SelfTestStep, readonly string[]>,
  startWidth: number,
  load: number,
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
  const startFailure = await readStartFailure(window);
  if (!isCurrent()) {
    return;
  }
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
      load,
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

// Starts a fresh run of every handed script on the page load the window is on,
// printing `[selftest] page load <n> starts its run` (the drive's `ready`
// reports the same number), unless that load already started one; a step that
// throws or a script result that rejects fails the self-test, unless a reload
// already interrupted the run. The run stands down once the page navigates or
// the self-test begins to exit, so a step still running when its script's
// result rejected presses, saves and reports nothing more.
function startRun(
  window: DrivenWindow,
  homeFiles: Files,
  handed: readonly HandedScript[],
  screenshots: ReadonlyMap<SelfTestStep, readonly string[]>,
  startWidth: number,
  cleanUp: () => Promise<void>,
) {
  const load = window.navigationCount();
  if (hasExited || load === startedLoad) {
    return;
  }
  startedLoad = load;
  console.log(`[selftest] page load ${load} starts its run`);
  const isCurrent = isOnLoad(window, load, () => hasExited);
  runAllScripts(
    window,
    homeFiles,
    handed,
    screenshots,
    startWidth,
    load,
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
// it before it exits. `screenshotFolder` is emptied here, so it ends the run
// holding only that run's PNGs. Each plugin hands at most one script while the
// parts start; a host throws on its plugin's second script or one handed over
// late. Every page load runs the handed scripts in hand-over order, a run
// begun on the previous page standing down as the new one commits. The
// window's content width as the self-test starts is the width every script
// starts and ends on.
export function startSelfTest(
  window: BrowserWindow,
  homeFiles: Files,
  cleanUp: () => Promise<void>,
  screenshotFolder: string,
): SelfTestDriver {
  emptyFolder(screenshotFolder);
  const drivenWindow = electronDrivenWindow(window);
  const startWidth = drivenWindow.contentSize().width;
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
