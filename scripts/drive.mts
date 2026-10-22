// `npm run drive -- <command>`: starts the app offscreen as a drive run in
// `.drive/<run-id>/`, sends commands to the running app over its local HTTP
// server, restarts it into the same run folder, and prints help.
// `scripts/drive-args.mts` holds the forms; the app serves the commands.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import {
  CLI_FORMS,
  type DriveHarness,
  type DriveInvocation,
  parseDriveArgs,
} from './drive-args.mts';

const REPO_DIR = path.resolve(import.meta.dirname, '..');
const DRIVE_DIR = path.join(REPO_DIR, '.drive');
const CURRENT_FILE = path.join(DRIVE_DIR, 'current');
const START_TIMEOUT_MS = 120_000;
const QUIT_TIMEOUT_MS = 15_000;
const POLL_MS = 250;
const LOG_TAIL_LINES = 30;

interface DriveFile {
  port: number;
  token: string;
  pid: number;
}

interface StartOptions {
  packaged: boolean;
  harness: DriveHarness;
  userConfig: boolean;
}

interface StartFile extends StartOptions {
  pid: number;
}

type Reply =
  | { ok: true; result: unknown }
  | { ok: false; error: string }
  | 'not running';

async function main(invocation: DriveInvocation): Promise<void> {
  if (invocation.kind === 'start') {
    await start(invocation.run ?? newRunId(), invocation, true);
  } else if (invocation.kind === 'restart') {
    await restart(currentRun(invocation.run));
  } else if (invocation.kind === 'help') {
    await printHelp(invocation.run);
  } else {
    await sendAndPrint(
      currentRun(invocation.run),
      invocation.command,
      invocation.args,
    );
  }
}

// Starts the app into `.drive/<runId>/`, reusing its home when the folder
// exists, and returns once the page is ready for keys. `copyUserConfig` false
// keeps the home's config as the run left it, on a restart.
async function start(
  runId: string,
  options: StartOptions,
  copyUserConfig: boolean,
): Promise<void> {
  const runDir = runDirOf(runId);
  const driveFile = path.join(runDir, 'drive.json');
  if ((await send(runId, 'ready', {})) !== 'not running') {
    throw new Error(`Run ${runId} is already running`);
  }
  rmSync(driveFile, { force: true });
  const homeDir = path.join(runDir, 'home');
  mkdirSync(homeDir, { recursive: true });
  if (options.userConfig && copyUserConfig) {
    copyUserConfigInto(homeDir);
  }
  writeFileSync(CURRENT_FILE, runId);
  const pid = spawnApp(runDir, options);
  const startFile: StartFile = { ...options, pid };
  writeFileSync(
    path.join(runDir, 'start.json'),
    JSON.stringify(startFile, null, 2),
  );
  await waitForDriveFile(runDir, pid);
  const ready = await send(runId, 'ready', {});
  if (ready === 'not running' || !ready.ok) {
    const why = ready === 'not running' ? 'stopped answering' : ready.error;
    throw new Error(`Run ${runId} started but ${why}`);
  }
  console.log(`run ${runId}`);
  console.log(runDir);
}

function newRunId(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${date}-${time}-${randomBytes(2).toString('hex')}`;
}

function runDirOf(runId: string): string {
  return path.join(DRIVE_DIR, runId);
}

// The `--run` id, or the newest run `.drive/current` names.
function currentRun(run: string | null): string {
  if (run !== null) {
    return run;
  }
  if (!existsSync(CURRENT_FILE)) {
    throw new Error('No drive run yet; npm run drive -- start');
  }
  return readFileSync(CURRENT_FILE, 'utf8').trim();
}

function copyUserConfigInto(homeDir: string): void {
  const userConfig = path.join(homedir(), '.config', 'wigley-ai-gui');
  if (!existsSync(userConfig)) {
    console.log(`No user config at ${userConfig}; starting with defaults`);
    return;
  }
  cpSync(userConfig, path.join(homeDir, '.config', 'wigley-ai-gui'), {
    recursive: true,
  });
}

// Spawns the app detached, its output appended to `<runDir>/app.log`, and
// returns its pid.
function spawnApp(runDir: string, options: StartOptions): number {
  const { command, args } = appCommand(options.packaged);
  const log = openSync(path.join(runDir, 'app.log'), 'a');
  const isWindows = process.platform === 'win32';
  const child = spawn(command, args, {
    cwd: REPO_DIR,
    detached: true,
    stdio: ['ignore', log, log],
    // Node refuses to spawn a `.cmd` file without a shell.
    shell: isWindows && !options.packaged,
    env: {
      ...process.env,
      WIGLEY_DRIVE_DIR: path.resolve(runDir),
      WIGLEY_DRIVE_HARNESS: options.harness,
    },
  });
  closeSync(log);
  // A failed spawn leaves `pid` undefined, handled below; this keeps its
  // later 'error' event from crashing the CLI.
  child.once('error', () => {});
  child.unref();
  if (child.pid === undefined) {
    throw new Error(`Could not start ${command}`);
  }
  return child.pid;
}

function appCommand(packaged: boolean): { command: string; args: string[] } {
  const isWindows = process.platform === 'win32';
  if (!packaged) {
    const forge = isWindows ? 'electron-forge.cmd' : 'electron-forge';
    return {
      command: path.join(REPO_DIR, 'node_modules', '.bin', forge),
      args: ['start'],
    };
  }
  const buildDir = path.join(
    REPO_DIR,
    'out',
    `wigley-ai-gui-${process.platform}-${process.arch}`,
  );
  const binaryByPlatform: Partial<Record<NodeJS.Platform, string>> = {
    darwin: 'wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui',
    win32: 'wigley-ai-gui.exe',
  };
  const binary = path.join(
    buildDir,
    binaryByPlatform[process.platform] ?? 'wigley-ai-gui',
  );
  if (!existsSync(binary)) {
    throw new Error(
      `No packaged build at ${binary}; run npm run package first`,
    );
  }
  return { command: binary, args: [] };
}

// Waits for the app to write `drive.json`; throws with the tail of `app.log`
// when the spawned process exits first or the wait runs out.
async function waitForDriveFile(runDir: string, pid: number): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (readDriveFile(runDir) === null) {
    if (!isAlive(pid)) {
      throw new Error(
        `The app exited before it was ready:\n${logTail(runDir)}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `The app (pid ${pid}) wrote no drive.json within ${START_TIMEOUT_MS / 1000} s:\n${logTail(runDir)}`,
      );
    }
    await wait(POLL_MS);
  }
}

function logTail(runDir: string): string {
  const logFile = path.join(runDir, 'app.log');
  if (!existsSync(logFile)) {
    return '(no app.log)';
  }
  const lines = readFileSync(logFile, 'utf8').trimEnd().split('\n');
  return lines.slice(-LOG_TAIL_LINES).join('\n');
}

function readDriveFile(runDir: string): DriveFile | null {
  const driveFile = path.join(runDir, 'drive.json');
  return existsSync(driveFile)
    ? (JSON.parse(readFileSync(driveFile, 'utf8')) as DriveFile)
    : null;
}

function readStartFile(runId: string): StartFile {
  const startFile = path.join(runDirOf(runId), 'start.json');
  if (!existsSync(startFile)) {
    throw new Error(`Run ${runId} has no start.json; npm run drive -- start`);
  }
  return JSON.parse(readFileSync(startFile, 'utf8')) as StartFile;
}

// Sends one command to the run's app; 'not running' when it has no
// `drive.json` or refuses the connection.
async function send(
  runId: string,
  command: string,
  args: Record<string, unknown>,
): Promise<Reply> {
  const drive = readDriveFile(runDirOf(runId));
  if (drive === null) {
    return 'not running';
  }
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${drive.port}/`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${drive.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ command, args }),
    });
  } catch (error) {
    if (isConnectionRefused(error)) {
      return 'not running';
    }
    throw error;
  }
  return (await response.json()) as Reply;
}

function isConnectionRefused(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === 'ECONNREFUSED'
  );
}

async function sendAndPrint(
  runId: string,
  command: string,
  args: Record<string, unknown>,
): Promise<void> {
  const reply = await send(runId, command, args);
  if (reply === 'not running') {
    throw new Error(`Run ${runId} is not running; npm run drive -- start`);
  }
  if (!reply.ok) {
    throw new Error(reply.error);
  }
  console.log(JSON.stringify(reply.result, null, 2));
}

// Quits the run's app, waits for its processes to exit, and starts it again
// into the same run folder with the flags its start recorded.
async function restart(runId: string): Promise<void> {
  const startFile = readStartFile(runId);
  const drive = readDriveFile(runDirOf(runId));
  await send(runId, 'quit', {});
  const pids = [startFile.pid, ...(drive === null ? [] : [drive.pid])];
  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (pids.some(isAlive)) {
    if (Date.now() > deadline) {
      throw new Error(
        `Run ${runId} did not quit within ${QUIT_TIMEOUT_MS / 1000} s`,
      );
    }
    await wait(POLL_MS);
  }
  rmSync(path.join(runDirOf(runId), 'drive.json'), { force: true });
  const { packaged, harness, userConfig } = startFile;
  await start(runId, { packaged, harness, userConfig }, false);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Prints the CLI's forms, then the live run's commands when one answers.
async function printHelp(run: string | null): Promise<void> {
  console.log(CLI_FORMS);
  const hasRun = run !== null || existsSync(CURRENT_FILE);
  if (!hasRun) {
    return;
  }
  const runId = currentRun(run);
  const reply = await send(runId, 'help', {});
  if (reply === 'not running' || !reply.ok) {
    return;
  }
  console.log(`\nCommands of run ${runId}:`);
  const commands = reply.result as {
    command: string;
    args: string;
    description: string;
  }[];
  for (const { command, args, description } of commands) {
    console.log(`  ${command} ${args} — ${description}`);
  }
}

try {
  await main(parseDriveArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
