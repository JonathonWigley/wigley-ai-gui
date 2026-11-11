// `npm run install-app -- [--ref <ref>]`: packages a committed ref in a
// build-only worktree beside the repo and installs it as the stable app: it
// copies the app beside the install while the stable app still runs, then quits
// that app, moves the copy in, and starts the app again when it was running,
// even after a failed move, on whichever version is then installed. On macOS the
// copy swaps in for the installed bundle; on Windows each commit keeps its own
// `app-<short sha>` folder, since a running session host locks its exe's folder.
// The build bakes in this clone's path, never the build worktree's, so the
// stable app reads each live default layout from this clone.
// `scripts/install-steps.mts` holds the decisions made from inputs alone.
import { type SpawnSyncOptions, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import {
  type InstallPaths,
  installPaths,
  installRootCleanup,
  isInstallDue,
  isStableAppProcess,
  type ListedProcess,
  parseInstallArgs,
  parseMacProcessList,
  parseWindowsProcessList,
  processesToQuit,
  type StableProcess,
} from './install-steps.mts';

const REPO_DIR = path.resolve(import.meta.dirname, '..');
const LOCK_HASH_FILE = '.install-app-lock-hash';
const QUIT_TIMEOUT_MS = 15_000;
const POLL_MS = 500;
// Windows refuses a rename or a delete with these codes for a moment after the
// app's processes exit, while their handles release.
const RENAME_RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const RENAME_ATTEMPTS = 10;
const RENAME_RETRY_MS = 250;
const IS_WINDOWS = process.platform === 'win32';

async function main(ref: string): Promise<void> {
  const commit = resolveCommit(ref);
  const paths = installPaths(
    process.platform,
    process.arch,
    REPO_DIR,
    process.env,
    commit,
  );
  if (IS_WINDOWS) {
    await installOnWindows(paths, ref, commit);
  } else {
    await installOnMac(paths, commit);
  }
  console.log(`Installed ${ref} (${commit})`);
  console.log(paths.installDir);
}

async function installOnMac(
  paths: InstallPaths,
  commit: string,
): Promise<void> {
  packageApp(paths, commit);
  stageInstall(paths);
  const running = stableProcessesToQuit(paths);
  const wasRunning = running.length > 0;
  if (wasRunning) {
    await quitStableApp(paths, running);
  }
  try {
    try {
      await swapInStagedInstall(paths);
    } catch (error) {
      throw new Error(
        `Replacing ${paths.installDir} failed: ${errorMessage(error)}`,
      );
    }
  } finally {
    if (wasRunning) {
      startMacApp(paths.installDir);
    }
  }
}

// A folder reaches installDir only through the rename out of staging, so one
// that exists is complete and is reused without packaging. The app starts again
// before the root is cleaned, because deleting older folders can take seconds
// and a relay holding a call is waiting on the app's channel.
async function installOnWindows(
  paths: InstallPaths,
  ref: string,
  commit: string,
): Promise<void> {
  const isAlreadyInstalled = existsSync(paths.installDir);
  if (isAlreadyInstalled) {
    console.log(
      `${ref} (${commit}) is already installed; reusing ${paths.installDir}`,
    );
  } else {
    packageApp(paths, commit);
    stageInstall(paths);
  }
  const toQuit = stableProcessesToQuit(paths);
  if (toQuit.length > 0) {
    await quitStableApp(paths, toQuit);
  }
  try {
    if (!isAlreadyInstalled) {
      await moveStagedInstall(paths);
    }
    const now = new Date();
    utimesSync(paths.installDir, now, now);
    writeShortcut(paths);
  } finally {
    if (toQuit.length > 0) {
      startWindowsApp(
        existsSync(paths.binary) ? paths.binary : toQuit[0].executable,
      );
    }
  }
  await cleanInstallRoot(paths);
}

// Checks out `commit` in the build worktree and packages it there, baking in
// this clone's path and the commit, which the app's update check compares
// against origin's main.
function packageApp(paths: InstallPaths, commit: string): void {
  checkOutBuildWorktree(paths.buildDir, commit);
  installDependenciesWhenDue(paths.buildDir);
  runNpmStep('npm run package', paths.buildDir, {
    ...process.env,
    WIGLEY_CLONE_DIR: REPO_DIR,
    WIGLEY_BUILD_COMMIT: commit,
  });
  if (!existsSync(paths.packagedApp)) {
    throw new Error(`npm run package left no app at ${paths.packagedApp}`);
  }
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
// when a shell spawn is handed args. `env`, when given, is the command's whole
// environment; else it inherits this script's.
function runNpmStep(
  commandLine: string,
  cwd: string,
  env?: NodeJS.ProcessEnv,
): void {
  runStep(commandLine, commandLine, [], {
    cwd,
    env,
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

// The processes of the stable app: never a session host, and never a packaged
// drive run from `out/`. On Windows every Electron process of the app runs the
// exe, so a running app has several; on macOS the helpers run from their own
// bundles, so only the main process matches, and waiting on it is enough.
function runningStableProcesses(paths: InstallPaths): StableProcess[] {
  const listed = IS_WINDOWS ? listWindowsProcesses() : listMacProcesses();
  return listed.filter((listedProcess) =>
    isStableAppProcess(
      process.platform,
      paths,
      listedProcess.executable,
      listedProcess.commandLine,
    ),
  );
}

function stableProcessesToQuit(paths: InstallPaths): StableProcess[] {
  return processesToQuit(
    process.platform,
    paths,
    runningStableProcesses(paths),
  );
}

// Every running wigley-ai-gui.exe. PowerShell writes UTF-8 with no byte order
// mark because Node reads the paths it prints.
function listWindowsProcesses(): ListedProcess[] {
  const output = runStep('Finding the stable app', 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Get-CimInstance Win32_Process -Filter ${powerShellString("Name = 'wigley-ai-gui.exe'")} | ForEach-Object { ($_.ProcessId, $_.ExecutablePath, $_.CommandLine) -join [char]9 }`,
  ]);
  return parseWindowsProcessList(output);
}

// Every running process; `ww` keeps `ps` from cutting the command line.
function listMacProcesses(): ListedProcess[] {
  const output = runStep('Finding the stable app', 'ps', [
    '-axww',
    '-o',
    'pid=,args=',
  ]);
  return parseMacProcessList(output);
}

// Asks the stable app's `processes` to quit and waits for them to exit. Never
// force-kills: the app holds the user's open rounds.
async function quitStableApp(
  paths: InstallPaths,
  processes: readonly StableProcess[],
): Promise<void> {
  if (IS_WINDOWS) {
    // Only the main process has a window; closing it quits the app. A pid that
    // exited before this script reads it is not a failure, nor is one that
    // exits before its close call, which throws there.
    const pids = processes.map(({ pid }) => pid).join(',');
    runStep('Quitting the stable app', 'powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-Process -Id ${pids} -ErrorAction SilentlyContinue | ForEach-Object { try { [void]$_.CloseMainWindow() } catch {} }; exit 0`,
    ]);
  } else {
    runStep('Quitting the stable app', 'osascript', [
      '-e',
      `tell application "${paths.installDir}" to quit`,
    ]);
  }
  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (stableProcessesToQuit(paths).length > 0) {
    if (Date.now() > deadline) {
      throw new Error(
        `The stable app did not quit within ${QUIT_TIMEOUT_MS / 1000} s; quit it and run install-app again. Nothing was installed.`,
      );
    }
    await wait(POLL_MS);
  }
}

// Copies the packaged app to `stagingDir`, leaving the installed app untouched,
// so it may still be running. A copy, or on macOS a `.old`, left by an earlier
// failed run is deleted first.
function stageInstall(paths: InstallPaths): void {
  try {
    rmSync(paths.stagingDir, { recursive: true, force: true });
    mkdirSync(path.dirname(paths.stagingDir), { recursive: true });
    if (IS_WINDOWS) {
      cpSync(paths.packagedApp, paths.stagingDir, { recursive: true });
    } else {
      rmSync(`${paths.installDir}.old`, { recursive: true, force: true });
      // ditto keeps the bundle's symlinks.
      runStep('Copying the app', 'ditto', [
        paths.packagedApp,
        paths.stagingDir,
      ]);
    }
  } catch (error) {
    throw new Error(
      `Staging the app at ${paths.stagingDir} failed: ${errorMessage(error)}`,
    );
  }
}

// Renames the staged app to installDir; a failure leaves the previous version
// installed.
async function moveStagedInstall(paths: InstallPaths): Promise<void> {
  try {
    await renameRetrying(paths.stagingDir, paths.installDir);
  } catch (error) {
    throw new Error(
      `Moving the staged app to ${paths.installDir} failed: ${errorMessage(error)}`,
    );
  }
}

// Deletes what the install root holds beyond installDir, and the flat scheme's
// `.new` and `.old` siblings. Leftovers go first, so an old `deleting-*` folder
// cannot block the rename of the `app-*` folder it came from. The install is
// done by now, so every failure only warns.
async function cleanInstallRoot(paths: InstallPaths): Promise<void> {
  const installRoot = paths.installRoot ?? '';
  try {
    const { olderAppFolders, leftovers } = installRootCleanup(
      readdirSync(installRoot),
      path.basename(paths.installDir),
    );
    for (const leftover of [
      ...leftovers.map((name) => path.join(installRoot, name)),
      `${installRoot}.new`,
      `${installRoot}.old`,
    ]) {
      removeOrWarn(leftover);
    }
    for (const name of olderAppFolders) {
      await deleteOlderAppFolder(installRoot, name);
    }
  } catch (error) {
    console.warn(`Cleaning ${installRoot} failed: ${errorMessage(error)}`);
  }
}

// Windows refuses to rename a folder holding a running exe, so the rename is the
// lock check; a partial rmSync could delete files a running host still loads.
async function deleteOlderAppFolder(
  installRoot: string,
  name: string,
): Promise<void> {
  const folder = path.join(installRoot, name);
  const deleting = path.join(installRoot, `deleting-${name}`);
  try {
    await renameRetrying(folder, deleting);
  } catch (error) {
    console.warn(
      `Keeping ${folder}: a running process holds it, most likely the session host of that version; the next install-app run deletes it (${errorMessage(error)})`,
    );
    return;
  }
  if (removeOrWarn(deleting)) {
    console.log(`Deleted ${name}`);
  }
}

// Whether `target` is gone; a failure names the path and the next run retries it.
function removeOrWarn(target: string): boolean {
  try {
    rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: RENAME_ATTEMPTS - 1,
      retryDelay: RENAME_RETRY_MS,
    });
    return true;
  } catch (error) {
    console.warn(
      `Deleting ${target} failed; the next install-app run deletes it: ${errorMessage(error)}`,
    );
    return false;
  }
}

// Swaps the app `stageInstall` left at `stagingDir` in for the installed one,
// which must no longer be running: renames the installed app to `.old`, the
// staged one into its place, then deletes `.old`. When the staged app cannot
// move in, the installed one is renamed back before the error is rethrown. A
// `.old` that cannot be deleted only warns, since the swap is done and the next
// run's `stageInstall` deletes it.
async function swapInStagedInstall(paths: InstallPaths): Promise<void> {
  const { installDir, stagingDir } = paths;
  const oldDir = `${installDir}.old`;
  const hadInstall = existsSync(installDir);
  if (hadInstall) {
    await renameRetrying(installDir, oldDir);
  }
  try {
    await renameRetrying(stagingDir, installDir);
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
      `Deleting the previous app at ${oldDir} failed, so it is left there for the next install-app run to delete: ${errorMessage(error)}`,
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
      `${errorMessage(swapError)}; renaming the previous app back also failed, so it is at ${oldDir}: ${errorMessage(restoreError)}`,
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

// macOS's `open` hands the launch to LaunchServices, which sets the app's working
// folder itself. A failed start is printed and fails the run's exit code but is
// never thrown, so it cannot hide a failed swap's error.
function startMacApp(installDir: string): void {
  try {
    runStep('Starting the stable app', 'open', [installDir]);
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}

// Starts `binary` detached from this script, in its own folder as the Start menu
// shortcut does. A failed start is printed and fails the run's exit code but is
// never thrown, so it cannot hide a failed move's error.
function startWindowsApp(binary: string): void {
  const child = spawn(binary, [], {
    cwd: path.dirname(binary),
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

// A PowerShell single-quoted string, which expands nothing; `'` doubles.
function powerShellString(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

try {
  await main(parseInstallArgs(process.argv.slice(2)).ref);
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
