// `npm run install-app -- [--ref <ref>]`: packages a committed ref in a
// build-only worktree beside the repo and installs it as the stable app,
// quitting the running stable app first and starting it again after.
// `scripts/install-steps.mts` holds the paths and the argument parsing.
import { type SpawnSyncOptions, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import {
  type InstallPaths,
  installPaths,
  isInstallDue,
  parseInstallArgs,
} from './install-steps.mts';

const REPO_DIR = path.resolve(import.meta.dirname, '..');
const LOCK_HASH_FILE = '.install-app-lock-hash';
const QUIT_TIMEOUT_MS = 15_000;
const POLL_MS = 500;
const IS_WINDOWS = process.platform === 'win32';

async function main(ref: string): Promise<void> {
  const paths = installPaths(
    process.platform,
    process.arch,
    REPO_DIR,
    process.env,
  );
  const commit = resolveCommit(ref);
  checkOutBuildWorktree(paths.buildDir, commit);
  installDependenciesWhenDue(paths.buildDir);
  runStep('npm run package', 'npm', ['run', 'package'], {
    cwd: paths.buildDir,
    stdio: 'inherit',
    // Node refuses to spawn npm's `.cmd` without a shell.
    shell: IS_WINDOWS,
  });
  const packagedApp = packagedAppOf(paths.packagedDir);
  if (!existsSync(packagedApp)) {
    throw new Error(`npm run package left no app at ${packagedApp}`);
  }
  const wasRunning = runningStablePids(paths.binary).length > 0;
  if (wasRunning) {
    await quitStableApp(paths);
  }
  try {
    replaceInstall(packagedApp, paths.installDir);
  } catch (error) {
    throw new Error(
      `Replacing ${paths.installDir} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (paths.shortcut !== null) {
    writeShortcut(paths);
  }
  if (wasRunning) {
    startStableApp(paths);
  }
  console.log(`Installed ${ref} (${commit})`);
  console.log(paths.installDir);
}

// Runs one step's command and returns its output; throws naming the step and
// its output when it fails to start or exits non-zero. A step run with
// inherited stdio has already printed its output.
function runStep(
  step: string,
  command: string,
  args: string[],
  options: SpawnSyncOptions = {},
): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error !== undefined) {
    throw new Error(`${step} failed to start: ${result.error.message}`);
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) {
    const shown = output === '' ? '(its output is above)' : output;
    throw new Error(`${step} exited ${result.status}:\n${shown}`);
  }
  return String(result.stdout ?? '');
}

function resolveCommit(ref: string): string {
  return runStep(
    `Resolving ${ref}`,
    'git',
    ['rev-parse', '--verify', `${ref}^{commit}`],
    { cwd: REPO_DIR },
  ).trim();
}

// The worktree holds only builds, so a forced checkout loses nothing; its
// git-ignored `node_modules`, `out` and `.vite` survive it.
function checkOutBuildWorktree(buildDir: string, commit: string): void {
  if (!existsSync(buildDir)) {
    runStep(
      'git worktree add',
      'git',
      ['worktree', 'add', '--detach', buildDir, commit],
      { cwd: REPO_DIR },
    );
    return;
  }
  runStep('git checkout', 'git', [
    '-C',
    buildDir,
    'checkout',
    '--detach',
    '--force',
    commit,
  ]);
}

// Runs `npm ci` when `node_modules` is missing or the lockfile changed since
// the last one, then stores the lockfile's hash in `node_modules`.
function installDependenciesWhenDue(buildDir: string): void {
  const nodeModules = path.join(buildDir, 'node_modules');
  const hashFile = path.join(nodeModules, LOCK_HASH_FILE);
  const lockHash = createHash('sha256')
    .update(readFileSync(path.join(buildDir, 'package-lock.json')))
    .digest('hex');
  const storedHash = existsSync(hashFile)
    ? readFileSync(hashFile, 'utf8').trim()
    : null;
  const isDue = !existsSync(nodeModules) || isInstallDue(lockHash, storedHash);
  if (!isDue) {
    return;
  }
  runStep('npm ci', 'npm', ['ci'], {
    cwd: buildDir,
    stdio: 'inherit',
    shell: IS_WINDOWS,
  });
  writeFileSync(hashFile, lockHash);
}

// What gets installed: the packaged folder on Windows, the bundle inside it on
// macOS.
function packagedAppOf(packagedDir: string): string {
  return IS_WINDOWS ? packagedDir : path.join(packagedDir, 'wigley-ai-gui.app');
}

// The pids running the installed binary. Matched by path, not by name, so a
// packaged drive run from `out/` is left alone; every Electron process of the
// app runs from that path, so a running app has several.
function runningStablePids(binary: string): number[] {
  if (IS_WINDOWS) {
    const output = runStep('Finding the stable app', 'powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-Process wigley-ai-gui -ErrorAction SilentlyContinue | Where-Object Path -eq ${powerShellString(binary)} | ForEach-Object { $_.Id }`,
    ]);
    return pidsOf(output);
  }
  const result = spawnSync('pgrep', ['-f', `^${escapeRegExp(binary)}`], {
    encoding: 'utf8',
  });
  // pgrep exits 1 when nothing matches.
  if (result.status === 1) {
    return [];
  }
  if (result.status !== 0) {
    throw new Error(
      `Finding the stable app exited ${result.status}:\n${result.stderr}`,
    );
  }
  return pidsOf(result.stdout);
}

// Asks the stable app to quit and waits for every process of it to exit.
// Never force-kills: the app holds the user's open rounds.
async function quitStableApp(paths: InstallPaths): Promise<void> {
  if (IS_WINDOWS) {
    // Only the main process has a window; closing it quits the app.
    runStep('Quitting the stable app', 'powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-Process wigley-ai-gui -ErrorAction SilentlyContinue | Where-Object Path -eq ${powerShellString(paths.binary)} | ForEach-Object { [void]$_.CloseMainWindow() }`,
    ]);
  } else {
    runStep('Quitting the stable app', 'osascript', [
      '-e',
      `tell application "${paths.installDir}" to quit`,
    ]);
  }
  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (runningStablePids(paths.binary).length > 0) {
    if (Date.now() > deadline) {
      throw new Error(
        `The stable app did not quit within ${QUIT_TIMEOUT_MS / 1000} s; quit it and run install-app again. Nothing was installed.`,
      );
    }
    await wait(POLL_MS);
  }
}

// Copies the packaged app beside the install as `.new`, then swaps it in for
// the old one. A `.new` or `.old` left by an earlier failed run goes first.
function replaceInstall(packagedApp: string, installDir: string): void {
  const newDir = `${installDir}.new`;
  const oldDir = `${installDir}.old`;
  rmSync(newDir, { recursive: true, force: true });
  rmSync(oldDir, { recursive: true, force: true });
  mkdirSync(path.dirname(installDir), { recursive: true });
  if (IS_WINDOWS) {
    cpSync(packagedApp, newDir, { recursive: true });
  } else {
    // ditto keeps the bundle's symlinks.
    runStep('Copying the app', 'ditto', [packagedApp, newDir]);
  }
  if (existsSync(installDir)) {
    renameSync(installDir, oldDir);
  }
  renameSync(newDir, installDir);
  rmSync(oldDir, { recursive: true, force: true });
}

function writeShortcut(paths: InstallPaths): void {
  const script = [
    `$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut(${powerShellString(paths.shortcut ?? '')})`,
    `$shortcut.TargetPath = ${powerShellString(paths.binary)}`,
    `$shortcut.WorkingDirectory = ${powerShellString(paths.installDir)}`,
    `$shortcut.Description = 'Auri'`,
    '$shortcut.Save()',
  ].join('; ');
  runStep('Writing the Start menu shortcut', 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
}

function startStableApp(paths: InstallPaths): void {
  if (!IS_WINDOWS) {
    runStep('Starting the stable app', 'open', [paths.installDir]);
    return;
  }
  const child = spawn(paths.binary, [], { detached: true, stdio: 'ignore' });
  // A failed start surfaces on 'error'; the install is done either way.
  child.once('error', (error) =>
    console.error(`Starting the stable app failed: ${error.message}`),
  );
  child.unref();
}

// A PowerShell single-quoted string, which expands nothing; `'` doubles.
function powerShellString(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pidsOf(output: string): number[] {
  return output
    .split(/\s+/)
    .filter((line) => line !== '')
    .map(Number);
}

try {
  await main(parseInstallArgs(process.argv.slice(2)).ref);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
