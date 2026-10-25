// `npm run install-app -- [--ref <ref>]`: packages a committed ref in a
// build-only worktree beside the repo and installs it as the stable app: it
// copies the app beside the install while the stable app still runs, then
// quits that app, swaps the copy in, and starts the app again when it was
// running, even after a failed swap, on whichever version is then installed.
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
// Windows refuses a rename with these codes for a moment after the app's
// processes exit, while their handles release.
const RENAME_RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const RENAME_ATTEMPTS = 10;
const RENAME_RETRY_MS = 250;
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
  runNpmStep('npm run package', paths.buildDir);
  if (!existsSync(paths.packagedApp)) {
    throw new Error(`npm run package left no app at ${paths.packagedApp}`);
  }
  try {
    stageInstall(paths.packagedApp, paths.installDir);
  } catch (error) {
    throw new Error(
      `Staging the app beside ${paths.installDir} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const wasRunning = runningStablePids(paths.binary).length > 0;
  if (wasRunning) {
    await quitStableApp(paths);
  }
  try {
    try {
      await swapInStagedInstall(paths.installDir);
    } catch (error) {
      throw new Error(
        `Replacing ${paths.installDir} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (paths.shortcut !== null) {
      writeShortcut(paths);
    }
  } finally {
    if (wasRunning) {
      startStableApp(paths);
    }
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

// Runs an npm command line through the shell, as one string with no args:
// Node spawns npm's Windows `.cmd` only through a shell, and warns (DEP0190)
// when a shell spawn is handed args.
function runNpmStep(commandLine: string, cwd: string): void {
  runStep(commandLine, commandLine, [], {
    cwd,
    stdio: 'inherit',
    shell: true,
  });
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
  runNpmStep('npm ci', buildDir);
  writeFileSync(hashFile, lockHash);
}

// The pids running the installed binary. Matched by path, not by name, so a
// packaged drive run from `out/` is left alone. On Windows every Electron
// process of the app runs from that path, so a running app has several; on
// macOS the helpers run from their own bundles, so only the main process
// matches, and waiting on it is enough.
function runningStablePids(binary: string): number[] {
  if (IS_WINDOWS) {
    const output = runStep('Finding the stable app', 'powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `${stableProcessesScript(binary)} | ForEach-Object { $_.Id }`,
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
    // Only the main process has a window; closing it quits the app. A process
    // that exits before its close call throws there, so the call is caught.
    runStep('Quitting the stable app', 'powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `${stableProcessesScript(paths.binary)} | ForEach-Object { try { [void]$_.CloseMainWindow() } catch {} }`,
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

// Copies the packaged app beside the install as `<installDir>.new`, leaving
// the installed app untouched, so it may still be running. A `.new` or `.old`
// left by an earlier failed run is deleted first.
function stageInstall(packagedApp: string, installDir: string): void {
  const newDir = `${installDir}.new`;
  rmSync(newDir, { recursive: true, force: true });
  rmSync(`${installDir}.old`, { recursive: true, force: true });
  mkdirSync(path.dirname(installDir), { recursive: true });
  if (IS_WINDOWS) {
    cpSync(packagedApp, newDir, { recursive: true });
  } else {
    // ditto keeps the bundle's symlinks.
    runStep('Copying the app', 'ditto', [packagedApp, newDir]);
  }
}

// Swaps the app `stageInstall` left at `<installDir>.new` in for the installed
// one, which must no longer be running: renames the installed app to `.old`,
// the staged one into its place, then deletes `.old`. When the staged app
// cannot move in, the installed one is renamed back before the error is
// rethrown. A `.old` that cannot be deleted only warns, since the swap is done
// and the next run's `stageInstall` deletes it.
async function swapInStagedInstall(installDir: string): Promise<void> {
  const newDir = `${installDir}.new`;
  const oldDir = `${installDir}.old`;
  const hadInstall = existsSync(installDir);
  if (hadInstall) {
    await renameRetrying(installDir, oldDir);
  }
  try {
    await renameRetrying(newDir, installDir);
  } catch (error) {
    if (hadInstall) {
      await restoreOldInstall(oldDir, installDir, error);
    }
    throw error;
  }
  try {
    rmSync(oldDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `Deleting the previous app at ${oldDir} failed, so it is left there for the next install-app run to delete: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Renames the installed app back from `.old` after the staged app failed to
// move in. Throws naming both failures and where the app now sits when the
// rename back fails too.
async function restoreOldInstall(
  oldDir: string,
  installDir: string,
  swapError: unknown,
): Promise<void> {
  try {
    await renameRetrying(oldDir, installDir);
  } catch (restoreError) {
    throw new Error(
      `${swapError instanceof Error ? swapError.message : String(swapError)}; renaming the previous app back also failed, so it is at ${oldDir}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
    );
  }
}

// renameSync, tried again for a few seconds while it fails with a code in
// RENAME_RETRY_CODES; any other failure, or the last attempt's, throws.
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const isRetryable = code !== undefined && RENAME_RETRY_CODES.has(code);
      if (!isRetryable || attempt === RENAME_ATTEMPTS) {
        throw error;
      }
      await wait(RENAME_RETRY_MS);
    }
  }
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

// Starts the installed app detached from this script, in the install folder
// as the Start menu shortcut does; macOS's `open` hands the launch to
// LaunchServices, which sets the app's working folder itself. A failed start
// is printed and fails the run's exit code but is never thrown, so it cannot
// hide a failed swap's error.
function startStableApp(paths: InstallPaths): void {
  if (!IS_WINDOWS) {
    try {
      runStep('Starting the stable app', 'open', [paths.installDir]);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }
  const child = spawn(paths.binary, [], {
    cwd: paths.installDir,
    detached: true,
    stdio: 'ignore',
  });
  // A failed start surfaces on 'error', after this function returns.
  child.once('error', (error) => {
    console.error(`Starting the stable app failed: ${error.message}`);
    process.exitCode = 1;
  });
  child.unref();
}

// PowerShell that pipes out the processes running `binary`, none when no
// wigley-ai-gui process runs. Get-Process throws ProcessCommandException when
// the name matches nothing, which reads as none; under `Stop` any other error
// ends the script with exit code 1.
function stableProcessesScript(binary: string): string {
  return `$ErrorActionPreference = 'Stop'; $found = try { Get-Process -Name wigley-ai-gui } catch [Microsoft.PowerShell.Commands.ProcessCommandException] { @() }; $found | Where-Object Path -eq ${powerShellString(binary)}`;
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
