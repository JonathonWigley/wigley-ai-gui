// `npm run selftest`: runs the app's self-test through Electron Forge, its
// output passed through, and exits 0 only when the self-test reports that all
// its steps passed. It holds `.drive/start.lock` from before the spawn until
// the self-test first prints, since every `electron-forge start` rewrites the
// shared `.vite/build`.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { isAlive, type StartLock, takeStartLock } from './start-lock.mts';

const REPO_DIR = path.resolve(import.meta.dirname, '..');
const START_LOCK_FILE = path.join(REPO_DIR, '.drive', 'start.lock');
const LOCK_TIMEOUT_MS = 120_000;
const LOCK_POLL_MS = 250;
const SELFTEST_PREFIX = '[selftest]';
const PASSED_LINE = '[selftest] all passed';

try {
  const startLock = await takeStartLock(START_LOCK_FILE, {
    timeoutMs: LOCK_TIMEOUT_MS,
    pollMs: LOCK_POLL_MS,
    isAlive,
    onWait: (holder) =>
      console.log(`Waiting for another dev start (pid ${holder}) to finish`),
  });
  runSelfTest(startLock);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

// Spawns the self-test and releases `startLock` at its first `[selftest]`
// line, or when it closes or fails to start.
function runSelfTest(startLock: StartLock): void {
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
    env: { ...process.env, PROOF_SELFTEST: '1' },
  });

  let hasPassed = false;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      process.stdout.write(`${line}\n`);
      if (line.includes(SELFTEST_PREFIX)) {
        startLock.release();
      }
      if (line.includes(PASSED_LINE)) {
        hasPassed = true;
      }
    });
  }
  child.on('error', (error) => {
    startLock.release();
    console.error(`Could not start ${forge}: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', () => {
    startLock.release();
    process.exitCode = hasPassed ? 0 : 1;
  });
}
