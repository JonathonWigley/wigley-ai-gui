// What a drive run leaves behind, and the rules that follow from it: `quit`
// deletes a run's scratch folders and keeps its captures, `quit --keep-sessions`
// keeps them with its session host, a `start` of a kept run takes the flags it
// recorded, every `start` deletes the run folders gone idle, and what `quit` and
// `start` refuse.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import type { DriveHarness } from './drive-args.mts';

// The run folder's entries `quit` deletes: the app's home, which holds the
// fixtures' test repos, and Chromium's profile. Captures and `app.log` stay.
export const QUIT_REMOVED_ENTRIES: readonly string[] = ['home', 'user-data'];

// How long a run folder may go untouched before a `start` deletes it.
export const RUN_IDLE_MS = 24 * 60 * 60 * 1000;

// `scripts/` cannot import `src/`: `hostRecordFile` names these files, and the
// test builds its records with it.
const HOST_RECORD_NAME = /^host-v\d+\.json$/;

export interface RunFolder {
  id: string;
  // The newest modification time of the folder or any entry directly in it.
  lastUsedMs: number;
  // Whether an app process the run recorded is still running.
  isLive: boolean;
}

export interface StartOptions {
  packaged: boolean;
  harness: DriveHarness;
  userConfig: boolean;
}

// The ids of `runs` a start of `startingRun` deletes: each other run with no
// live app, untouched for longer than `RUN_IDLE_MS`.
export function idleRunIds(
  runs: readonly RunFolder[],
  startingRun: string,
  nowMs: number,
): string[] {
  return runs
    .filter((run) => {
      const isIdle = nowMs - run.lastUsedMs > RUN_IDLE_MS;
      return run.id !== startingRun && !run.isLive && isIdle;
    })
    .map((run) => run.id);
}

// What a `start` runs with. `kept` is what the run recorded when its folder
// still holds its home, null otherwise: a command line naming no flag takes it,
// and a kept home's config is never copied over, so `userConfig` stays what the
// home holds and a named `--user-config` is a skipped copy.
export function startPlanOf(
  named: StartOptions & { namesFlags: boolean },
  kept: StartOptions | null,
): {
  options: StartOptions;
  copiesUserConfig: boolean;
  skipsUserConfigCopy: boolean;
} {
  const { packaged, harness, userConfig, namesFlags } = named;
  if (kept === null) {
    return {
      options: { packaged, harness, userConfig },
      copiesUserConfig: true,
      skipsUserConfigCopy: false,
    };
  }
  return {
    options: namesFlags
      ? { packaged, harness, userConfig: kept.userConfig }
      : kept,
    copiesUserConfig: false,
    skipsUserConfigCopy: userConfig,
  };
}

// Why a `start` of the run cannot go ahead: an app it recorded is still alive,
// though it did not answer, and a second one would share its home.
export function startRefusal(
  runId: string,
  liveAppPids: readonly number[],
): string | null {
  if (liveAppPids.length === 0) {
    return null;
  }
  const pids = liveAppPids.join(' ');
  return `Run ${runId} still has an app running, pids ${pids}, and a second one would share its home; npm run drive -- quit --run ${runId}, and if that fails, kill -9 ${pids}`;
}

// Why a plain `quit` of the run cannot go ahead: no app is left to end its
// sessions, so deleting its folders would leave its host running under them.
export function quitRefusal(
  runId: string,
  run: { liveAppPids: readonly number[]; hostMayBeRunning: boolean },
): string | null {
  const isKeptUnderItsHost =
    run.liveAppPids.length === 0 && run.hostMayBeRunning;
  return isKeptUnderItsHost
    ? `Run ${runId} has no app and its session host still runs, so quit deleted nothing; to end it, npm run drive -- start --run ${runId}, then npm run drive -- quit --run ${runId}`
    : null;
}

// Whether a session host of the run in `runDir`, of any protocol, may still be
// listening: only a connect that proves no listener says it is not, and a
// record that cannot be read names no host. A bare connect is no client to the
// host, so it moves neither its idle window nor its exit rule.
export async function hostMayBeRunning(runDir: string): Promise<boolean> {
  const folder = path.join(runDir, 'user-data', 'session-host');
  if (!existsSync(folder)) {
    return false;
  }
  const answers = await Promise.all(
    readdirSync(folder)
      .filter((name) => HOST_RECORD_NAME.test(name))
      .map((name) => {
        const channel = recordedChannel(path.join(folder, name));
        return channel === null ? false : channelMayHaveListener(channel);
      }),
  );
  return answers.includes(true);
}

function recordedChannel(file: string): string | null {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { channel: string })
      .channel;
  } catch {
    return null;
  }
}

function channelMayHaveListener(channel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(channel);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code !== 'ECONNREFUSED' && error.code !== 'ENOENT');
    });
  });
}
