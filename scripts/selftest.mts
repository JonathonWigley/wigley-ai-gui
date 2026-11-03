// `npm run selftest`: runs the app's self-test through Electron Forge, its
// output passed through, and exits 0 only when the self-test reports that all
// its steps passed. `--plugin` and `--group` narrow the run
// (`selftest-args.mts`), passed to the app in its environment. It holds
// `.drive/start.lock` from before the spawn, since every
// `electron-forge start` rewrites the shared `.vite/build` and the
// page's startup reload reads its preload from there, until the self-test
// prints that the page load after that reload starts its run, or
// `STARTUP_RELOAD_WAIT_MS` after the first load's run started when no reload
// comes, or until the self-test closes, whichever is first.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { filterEnvOf, parseSelfTestArgs } from './selftest-args.mts';
import {
  isAlive,
  mayReleaseStartLock,
  STARTUP_RELOAD_WAIT_MS,
  type StartLock,
  selfTestLoadOf,
  takeStartLock,
} from './start-lock.mts';

const REPO_DIR = path.resolve(import.meta.dirname, '..');
const START_LOCK_FILE = path.join(REPO_DIR, '.drive', 'start.lock');
const LOCK_TIMEOUT_MS = 120_000;
const LOCK_POLL_MS = 250;
const PASSED_LINE = '[selftest] all passed';

let startLock: StartLock | undefined;
try {
  const filterEnv = filterEnvOf(parseSelfTestArgs(process.argv.slice(2)));
  startLock = await takeStartLock(START_LOCK_FILE, {
    timeoutMs: LOCK_TIMEOUT_MS,
    pollMs: LOCK_POLL_MS,
    isAlive,
    onWait: (holder) =>
      console.log(`Waiting for another dev start (pid ${holder}) to finish`),
  });
  runSelfTest(startLock, filterEnv);
} catch (error) {
  startLock?.release();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

// Spawns the self-test and releases `startLock` once `mayReleaseStartLock`
// holds for the page loads its lines report, or when it closes or fails to
// start. `filterEnv` joins the self-test's environment.
function runSelfTest(
  startLock: StartLock,
  filterEnv: Record<string, string>,
): void {
  const isWindows = process.platform === 'win32';
  const forge = path.join(
    REPO_DIR,
    'node_modules',
    '.bin',
    isWindows ? 'electron-forge.cmd' : 'electron-forge',
  );
  // Node refuses to spawn a `.cmd` file without a shell, and the shell splits
  // an unquoted path at a space.
  const child = spawn(isWindows ? `"${forge}"` : forge, ['start'], {
    cwd: REPO_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
    env: { ...process.env, ...filterEnv, PROOF_SELFTEST: '1' },
  });

  let hasPassed = false;
  let firstLoadAt: number | null = null;
  let reloadWait: NodeJS.Timeout | undefined;
  const releaseOnLoad = (load: number) => {
    if (firstLoadAt === null) {
      firstLoadAt = Date.now();
      reloadWait = setTimeout(
        () => startLock.release(),
        STARTUP_RELOAD_WAIT_MS,
      );
    }
    if (mayReleaseStartLock(load, Date.now() - firstLoadAt)) {
      startLock.release();
    }
  };
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      process.stdout.write(`${line}\n`);
      if (line.includes(PASSED_LINE)) {
        hasPassed = true;
      }
      const load = selfTestLoadOf(line);
      if (load !== null) {
        releaseOnLoad(load);
      }
    });
  }
  child.on('error', (error) => {
    clearTimeout(reloadWait);
    startLock.release();
    console.error(`Could not start ${forge}: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', () => {
    clearTimeout(reloadWait);
    startLock.release();
    process.exitCode = hasPassed ? 0 : 1;
  });
}
