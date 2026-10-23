// `npm run selftest`: runs the app's self-test through Electron Forge, its
// output passed through, and exits 0 only when the self-test reports that all
// its steps passed.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';

const REPO_DIR = path.resolve(import.meta.dirname, '..');
const PASSED_LINE = '[selftest] all passed';

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
    if (line.includes(PASSED_LINE)) {
      hasPassed = true;
    }
  });
}
child.on('error', (error) => {
  console.error(`Could not start ${forge}: ${error.message}`);
  process.exitCode = 1;
});
child.on('close', () => {
  process.exitCode = hasPassed ? 0 : 1;
});
