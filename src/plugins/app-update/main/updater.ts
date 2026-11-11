import type { Clock, Timers } from '../../../contracts/ambient';
import type { Git } from '../../../contracts/git';
import type { SlotWriter } from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import type { AppUpdateStatus } from '../contract';
import type { Installer } from './installer';
import { updateStatusOf } from './update-decision';

// The ref an update comes from.
const ORIGIN_MAIN = 'origin/main';
export const CHECK_EVERY_MS = 15 * 60 * 1000;
// A focus within this long of the last check checks nothing, so switching
// windows back and forth fetches at most once a minute.
export const FOCUS_CHECK_GAP_MS = 60 * 1000;
export const INSTALL_POLL_MS = 2000;
// How long a start polls an install an earlier run of this build started
// and left with no exit code, before it gives up on it.
export const RESUMED_INSTALL_CAP_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 60 * 1000;

// `installed` is the commit the app was built from and `cloneDir` the clone it
// was built from; `status` is the plugin's slot writer.
export interface UpdaterDeps {
  installed: string;
  cloneDir: string;
  git: Pick<Git, 'fetch' | 'resolveCommit' | 'isAncestor'>;
  installer: Installer;
  status: SlotWriter<AppUpdateStatus>;
  timers: Timers;
  clock: Clock;
  log(message: string): void;
}

// `check` fetches the clone and sets `available` or `none` from origin's
// `main`, leaving an `installing` or `failed` status as it is, and logs the
// status it ends on; a check while one runs joins it, and a failed one logs
// and keeps the status. `focused`
// checks unless the last check began under `FOCUS_CHECK_GAP_MS` ago. `install`
// starts the installer from `available` or `failed`, then polls its result
// every `INSTALL_POLL_MS`: a non-zero exit sets `failed` with the log's tail,
// a zero exit `none` and checks again, since the install quits the app first
// and so reports one only when it found this app not running as the installed
// one, which then still runs its old build. `dispose` stops every timer and every
// later status write.
export interface Updater {
  check(): Promise<void>;
  focused(): void;
  install(): Promise<void>;
  dispose(): void;
}

// Starts checking every `CHECK_EVERY_MS` and checks at once; a status the slot
// kept through a plugin restart stays, and an `installing` one is polled again.
// Otherwise an install this same build started in an earlier run is picked
// up: with no exit code yet (a failed swap starts this build again before the
// install's shell writes it), the status is `installing` and polled for up to
// `RESUMED_INSTALL_CAP_MS`, then dropped to `none`; with a non-zero code and
// an update the first check finds, `failed` with the log's tail, since an
// install that gave up while the app was quitting (install-app waits 15 s, and
// the app's own quit has no cap) starts nothing again. An install another
// build started, or a zero code, shows nothing.
export function createUpdater(deps: UpdaterDeps): Updater {
  const { status, timers, log } = deps;
  let isDisposed = false;
  let running: Promise<void> | null = null;
  let lastCheckAt: number | null = null;
  let checkTimer: number | null = null;
  let pollTimer: number | null = null;
  // When a resumed earlier install stops being polled; null for one this run started.
  let pollDeadline: number | null = null;

  const current = (): AppUpdateStatus => status.get() ?? { kind: 'none' };
  const isBusy = () => {
    const kind = current().kind;
    return kind === 'installing' || kind === 'failed';
  };
  const setStatus = (next: AppUpdateStatus) => {
    if (isDisposed || JSON.stringify(next) === JSON.stringify(current())) {
      return;
    }
    status.set(next);
    log(`status: ${statusText(next)}`);
  };

  const checkOnce = async () => {
    if (isBusy()) {
      log(`checked: ${statusText(current())}`);
      return;
    }
    lastCheckAt = deps.clock.now();
    const didFetchFail = await deps.git.fetch(deps.cloneDir, FETCH_TIMEOUT_MS);
    if (didFetchFail) {
      log(`fetch failed; checking the last fetched ${ORIGIN_MAIN}`);
    }
    const origin = await deps.git.resolveCommit(deps.cloneDir, ORIGIN_MAIN);
    const isOtherCommit = origin !== null && origin !== deps.installed;
    const isInstalledAncestor =
      isOtherCommit &&
      (await deps.git.isAncestor(deps.cloneDir, deps.installed, origin));
    // An install the user started while the check ran wins.
    if (!isBusy()) {
      setStatus(updateStatusOf(deps.installed, origin, isInstalledAncestor));
    }
    log(`checked: ${statusText(current())}`);
  };

  const check = (): Promise<void> => {
    running ??= checkOnce()
      .catch((error: unknown) => log(`check failed: ${errorText(error)}`))
      .finally(() => {
        running = null;
      });
    return running;
  };

  const scheduleCheck = () => {
    checkTimer = timers.set(() => {
      void check();
      scheduleCheck();
    }, CHECK_EVERY_MS);
  };

  const pollResult = async () => {
    pollTimer = null;
    try {
      const result = await deps.installer.result();
      if (isDisposed || current().kind !== 'installing') {
        return;
      }
      if (result === null) {
        if (pollDeadline !== null && deps.clock.now() >= pollDeadline) {
          pollDeadline = null;
          log(
            `earlier install gave no exit code within ${String(RESUMED_INSTALL_CAP_MS / 1000)} s: dropped`,
          );
          setStatus({ kind: 'none' });
          void check();
        } else {
          schedulePoll();
        }
      } else if (result.code === 0) {
        log('install finished');
        setStatus({ kind: 'none' });
        void check();
      } else {
        log(`install failed: exit ${String(result.code)}`);
        setStatus({ kind: 'failed', error: result.logTail });
      }
    } catch (error) {
      log(`install result unread: ${errorText(error)}`);
      schedulePoll();
    }
  };

  const schedulePoll = () => {
    if (!isDisposed) {
      pollTimer = timers.set(() => void pollResult(), INSTALL_POLL_MS);
    }
  };

  const install = async () => {
    const kind = current().kind;
    if (kind !== 'available' && kind !== 'failed') {
      log(`install skipped: ${kind}`);
      return;
    }
    setStatus({ kind: 'installing' });
    pollDeadline = null;
    try {
      await deps.installer.start();
    } catch (error) {
      setStatus({ kind: 'failed', error: errorText(error) });
      return;
    }
    log('install started');
    schedulePoll();
  };

  // Only an install this build started counts: a build installed another
  // way never shows an older build's failure.
  const resumeEarlierInstall = async () => {
    let result: Awaited<ReturnType<Installer['result']>> = null;
    try {
      if ((await deps.installer.startedFrom()) !== deps.installed) {
        await check();
        return;
      }
      result = await deps.installer.result();
    } catch (error) {
      log(`earlier install unread: ${errorText(error)}`);
      await check();
      return;
    }
    if (result === null && current().kind !== 'failed') {
      // A failed swap starts this build again before its shell writes the code.
      log('earlier install has no exit code yet: polling');
      setStatus({ kind: 'installing' });
      pollDeadline = deps.clock.now() + RESUMED_INSTALL_CAP_MS;
      schedulePoll();
      return;
    }
    await check();
    if (
      result !== null &&
      result.code !== 0 &&
      current().kind === 'available'
    ) {
      log(`earlier install failed: exit ${String(result.code)}`);
      setStatus({ kind: 'failed', error: result.logTail });
    }
  };

  scheduleCheck();
  if (current().kind === 'installing') {
    schedulePoll();
    void check();
  } else {
    void resumeEarlierInstall();
  }

  return {
    check,
    focused() {
      const isRecent =
        lastCheckAt !== null &&
        deps.clock.now() - lastCheckAt < FOCUS_CHECK_GAP_MS;
      if (!isRecent) {
        void check();
      }
    },
    install,
    dispose() {
      isDisposed = true;
      for (const handle of [checkTimer, pollTimer]) {
        if (handle !== null) {
          timers.clear(handle);
        }
      }
    },
  };
}

// The status as the log names it.
export function statusText(status: AppUpdateStatus): string {
  switch (status.kind) {
    case 'available':
      return `available ${status.sha}`;
    case 'failed':
      return 'failed';
    default:
      return status.kind;
  }
}
