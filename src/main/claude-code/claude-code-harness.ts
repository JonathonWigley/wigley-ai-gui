import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  AccountStatus,
  AgentHarness,
  AgentProcess,
  AgentProcessEvents,
  AgentStart,
  LogInEvents,
  LogInProcess,
  ProcessActivity,
  SessionControl,
} from '../../contracts/agent';
import type { Clock } from '../../contracts/ambient';
import type { Files } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import { errorText } from '../../shared/error-text';
import { readAccountStatus, signInLink } from './claude-auth';
import { claudeConfigFolder, claudeEnv, claudeLaunch } from './claude-launch';
import {
  CLAUDE_CONTROLS,
  type ClaudeControlId,
  controlMessage,
  controlValue,
  userMessage,
} from './claude-controls';
import { createEntryStamp, type EntryDraft } from './entry-stamp';
import {
  listPastSessions,
  listProjectFolders,
  readHistory,
} from './past-sessions';
import { createStreamDecoder, type DecodedLine } from './stream-decoder';
import { projectFolderName } from './transcripts';

export type ClaudeSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

// `command` reads the `claude` binary's path, once per spawned session;
// `permissionTool` the MCP tool Claude asks what auto mode would still prompt;
// `env` the environment the process inherits; `files` reads saved transcripts,
// `homeDir` holds the default config folder `.claude`, is what a `~` profile
// folder resolves against and is where `claude auth` runs, and `paths` joins
// and compares paths by the rules of the OS `claude` runs on; `clock` stamps
// each live entry's `at`.
export interface ClaudeCodeHarnessDeps {
  command(): string;
  permissionTool: string;
  env: NodeJS.ProcessEnv;
  log: Log;
  spawn: ClaudeSpawn;
  files: Files;
  homeDir: string;
  paths: Paths;
  clock: Clock;
}

// How long `end` waits after closing stdin before SIGTERM, and again before
// SIGKILL.
const END_GRACE_MS = 3000;
// A typed `/effort <value>` or `/model <value>` sets that control.
const CONTROL_COMMAND = /^\/(effort|model) (\S+)$/;

type PendingRequest = { kind: 'mode'; value: string } | { kind: 'interrupt' };
interface ControlCommand {
  id: 'effort' | 'model';
  value: string;
}

function controlOf(id: string) {
  return CLAUDE_CONTROLS.find((control) => control.id === id);
}

function isChoice(id: ClaudeControlId, value: string): boolean {
  const choices = controlOf(id)?.choices ?? [];
  return choices.some((choice) => choice.value === value);
}

function exitText(code: number | null, signal: NodeJS.Signals | null): string {
  return code === null ? `signal ${signal}` : `code ${code}`;
}

function exitError(
  code: number | null,
  signal: NodeJS.Signals | null,
  lastStderr: string | null,
): string {
  const how = exitText(code, signal);
  const why = lastStderr === null ? '' : `: ${lastStderr}`;
  return `claude exited with ${how}${why}`;
}

// Spawn reports a missing `cwd` as ENOENT just as it does a missing binary,
// so the hint names both causes.
function spawnError(error: Error, command: string, cwd: string): string {
  const isMissing = (error as NodeJS.ErrnoException).code === 'ENOENT';
  return isMissing
    ? `claude was not found at ${command}, or the project folder ${cwd} does not exist; set claude.command`
    : error.message;
}

// One `claude` process in stream-json mode. Events a call causes are emitted
// in a microtask, never inside the call, as the fake harness does.
function startClaudeProcess(
  deps: ClaudeCodeHarnessDeps,
  request: AgentStart,
  events: AgentProcessEvents,
): AgentProcess {
  const launch = claudeLaunch(
    request,
    deps.permissionTool,
    deps.env,
    deps.homeDir,
    deps.paths,
  );
  const command = deps.command();
  const child = deps.spawn(command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
  });
  const decoder = createStreamDecoder();
  const stamp = createEntryStamp(deps.clock);
  let controls: SessionControl[] = CLAUDE_CONTROLS.map((control) => ({
    ...control,
    value: null,
  }));
  let activity: ProcessActivity = 'idle';
  let sendCount = 0;
  let requestCount = 0;
  let noticeCount = 0;
  const pendingRequests = new Map<string, PendingRequest>();
  // One item per message written and not yet answered by a `result`, in
  // write order: Claude queues a message sent mid-turn and answers each with
  // its own `result`. The item is the effort or model command the message
  // carries, or null.
  const pendingTurns: (ControlCommand | null)[] = [];
  let lastStderr: string | null = null;
  let isEndCalled = false;
  let hasClosed = false;
  let hasEmittedEnded = false;
  let endPromise: Promise<void> | null = null;
  const closeWaiters: (() => void)[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];

  // Every emission goes through the microtask queue, so events keep the
  // order of the calls and lines that caused them.
  const emit = (emission: () => void) => queueMicrotask(emission);

  const emitControls = () => {
    const reported = controls.map((control) => ({ ...control }));
    emit(() => events.controls(reported));
  };

  const setActivity = (next: ProcessActivity) => {
    activity = next;
    emit(() => events.activity(next));
  };

  const emitEntry = (draft: EntryDraft) => {
    const entry = stamp(draft);
    emit(() => events.entry(entry));
  };

  const harnessNotice = (
    text: string,
    tone: 'info' | 'error',
    raw: unknown,
  ) => {
    noticeCount += 1;
    emitEntry({
      kind: 'notice',
      id: `control-notice-${noticeCount}`,
      text,
      tone,
      raw: [raw],
    });
  };

  // True when the value changed.
  const setValue = (id: ClaudeControlId, value: string | null): boolean => {
    const current = controls.find((control) => control.id === id);
    if (current?.value === value) {
      return false;
    }
    controls = controls.map((control) =>
      control.id === id ? { ...control, value } : control,
    );
    return true;
  };

  const write = (message: object) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const nextRequestId = () => {
    requestCount += 1;
    return `wigley-${requestCount}`;
  };

  const requireRunning = () => {
    if (isEndCalled || hasClosed) {
      throw new Error('Claude Code process has ended');
    }
  };

  const emitEnded = (end: { code: number | null; error: string | null }) => {
    if (hasEmittedEnded) {
      return;
    }
    hasEmittedEnded = true;
    emit(() => events.ended(end));
  };

  // `end()` resolves after the `ended` emission it follows.
  const markClosed = () => {
    hasClosed = true;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    const waiters = closeWaiters.splice(0);
    emit(() => {
      for (const resolve of waiters) {
        resolve();
      }
    });
  };

  const answerControlResponse = (
    response: NonNullable<DecodedLine['controlResponse']>,
  ) => {
    const pending = pendingRequests.get(response.requestId);
    if (pending === undefined) {
      return;
    }
    pendingRequests.delete(response.requestId);
    if (pending.kind === 'interrupt') {
      if (response.error !== null) {
        harnessNotice(
          `Could not interrupt: ${response.error}`,
          'error',
          response,
        );
      }
      return;
    }
    if (response.error !== null) {
      harnessNotice(
        `Could not set Mode to ${pending.value}: ${response.error}`,
        'error',
        response,
      );
      return;
    }
    if (setValue('mode', pending.value)) {
      emitControls();
    }
  };

  const refuseHostRequest = (
    hostRequest: NonNullable<DecodedLine['hostRequest']>,
  ) => {
    write({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: hostRequest.requestId,
        error: `wigley-ai-gui answers no ${hostRequest.subtype} requests`,
      },
    });
  };

  // A control command's own result entry is not shown; its success sets the
  // control, since the turn's init still reports the value from before. A
  // value that is not among the control's choices leaves the control unknown.
  const handleLine = (line: string) => {
    const decoded = decoder.decode(line);
    const command = decoded.turnEnded ? (pendingTurns.shift() ?? null) : null;
    for (const entry of decoded.entries) {
      const isCommandResult = command !== null && entry.kind === 'result';
      if (!isCommandResult) {
        emitEntry(entry);
      }
    }
    let hasChanged = false;
    for (const [id, value] of Object.entries(decoded.reported)) {
      const controlId = id as ClaudeControlId;
      hasChanged =
        setValue(controlId, controlValue(controlId, value)) || hasChanged;
    }
    if (command !== null && !decoded.turnFailed) {
      const value = controlValue(command.id, command.value);
      const known = isChoice(command.id, value) ? value : null;
      hasChanged = setValue(command.id, known) || hasChanged;
    }
    if (hasChanged) {
      emitControls();
    }
    const { commands } = decoded;
    if (commands !== null) {
      emit(() => events.commands(commands));
    }
    if (decoded.controlResponse !== null) {
      answerControlResponse(decoded.controlResponse);
    }
    if (decoded.hostRequest !== null) {
      refuseHostRequest(decoded.hostRequest);
    }
    if (decoded.turnEnded && pendingTurns.length === 0) {
      setActivity('idle');
    }
  };

  createInterface({ input: child.stdout }).on('line', handleLine);
  createInterface({ input: child.stderr }).on('line', (line) => {
    deps.log('claude', line);
    lastStderr = line;
  });
  child.stdin.on('error', (error) => deps.log('claude', errorText(error)));
  child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    pendingTurns.length = 0;
    if (activity === 'working') {
      setActivity('idle');
    }
    const isCleanExit = code === 0 || isEndCalled;
    emitEnded({
      code,
      error: isCleanExit ? null : exitError(code, signal, lastStderr),
    });
    markClosed();
  });
  child.on('error', (error: Error) => {
    emitEnded({
      code: null,
      error: spawnError(error, command, launch.cwd),
    });
    // A child that never spawned has no pid and sends no `close` to wait for.
    if (child.pid === undefined) {
      markClosed();
    }
  });

  emitControls();
  setActivity('idle');

  return {
    send(userInput) {
      requireRunning();
      const message = userMessage(userInput);
      write(message);
      sendCount += 1;
      emitEntry({
        kind: 'user',
        id: `user-${sendCount}`,
        text: userInput.text,
        images: userInput.images,
        raw: [message],
      });
      const typed = CONTROL_COMMAND.exec(userInput.text);
      pendingTurns.push(
        typed === null
          ? null
          : { id: typed[1] as ControlCommand['id'], value: typed[2] },
      );
      setActivity('working');
    },
    interrupt() {
      requireRunning();
      if (activity !== 'working') {
        return;
      }
      const requestId = nextRequestId();
      const message = {
        type: 'control_request',
        request_id: requestId,
        request: { subtype: 'interrupt' },
      };
      pendingRequests.set(requestId, { kind: 'interrupt' });
      write(message);
      harnessNotice('Interrupted', 'info', message);
    },
    setControl(id, value) {
      requireRunning();
      const control = controlOf(id);
      if (control === undefined) {
        throw new Error(`Claude Code has no control ${id}`);
      }
      if (!isChoice(control.id, value)) {
        throw new Error(`Claude Code control ${id} has no choice ${value}`);
      }
      if (control.id === 'mode') {
        const requestId = nextRequestId();
        pendingRequests.set(requestId, { kind: 'mode', value });
        write(controlMessage('mode', value, requestId));
        return;
      }
      if (activity === 'working') {
        throw new Error(
          `Claude is working; change ${control.label} when the turn ends`,
        );
      }
      // A slash command carries no request id.
      write(controlMessage(control.id, value, ''));
      pendingTurns.push({ id: control.id, value });
      setActivity('working');
    },
    end() {
      if (endPromise !== null) {
        return endPromise;
      }
      isEndCalled = true;
      if (hasClosed) {
        endPromise = Promise.resolve();
        return endPromise;
      }
      endPromise = new Promise<void>((resolve) => closeWaiters.push(resolve));
      child.stdin.end();
      timers.push(
        setTimeout(() => {
          child.kill('SIGTERM');
          timers.push(setTimeout(() => child.kill('SIGKILL'), END_GRACE_MS));
        }, END_GRACE_MS),
      );
      return endPromise;
    },
    kill() {
      if (hasClosed) {
        return;
      }
      isEndCalled = true;
      child.kill('SIGTERM');
    },
  };
}

// A finished `claude auth` run: its exit code and what it printed, stderr
// trimmed.
interface AuthRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

// The auth commands run in the home folder, so ENOENT names the binary alone.
function authSpawnError(error: Error, command: string): string {
  const isMissing = (error as NodeJS.ErrnoException).code === 'ENOENT';
  return isMissing
    ? `claude was not found at ${command}; set claude.command`
    : error.message;
}

function withStderr(message: string, stderr: string): string {
  return stderr === '' ? message : `${message}: ${stderr}`;
}

// `claude auth <args>` for `profileDir`, in the home folder with the session
// launch's environment.
function spawnAuth(
  deps: ClaudeCodeHarnessDeps,
  args: readonly string[],
  profileDir: string | null,
): { command: string; child: ChildProcessWithoutNullStreams } {
  const command = deps.command();
  const child = deps.spawn(command, ['auth', ...args], {
    cwd: deps.homeDir,
    env: claudeEnv(deps.env, profileDir, deps.homeDir, deps.paths),
  });
  child.stdin.on('error', (error) => deps.log('claude', errorText(error)));
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return { command, child };
}

// Runs `claude auth <args>` to its exit, stdin closed. Rejects with the
// `claude.command` hint when the process cannot start.
function runAuth(
  deps: ClaudeCodeHarnessDeps,
  args: readonly string[],
  profileDir: string | null,
): Promise<AuthRun> {
  const { command, child } = spawnAuth(deps, args, profileDir);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end();
  return new Promise((resolve, reject) => {
    child.on('error', (error: Error) =>
      reject(new Error(authSpawnError(error, command))),
    );
    child.on('close', (code: number | null) =>
      resolve({ code, stdout, stderr: stderr.trim() }),
    );
  });
}

async function readAuthStatus(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): Promise<AccountStatus> {
  const run = await runAuth(deps, ['status', '--json'], profileDir);
  if (run.code !== 0) {
    throw new Error(
      withStderr(`claude auth status exited with code ${run.code}`, run.stderr),
    );
  }
  try {
    return readAccountStatus(run.stdout);
  } catch (error) {
    throw new Error(withStderr(errorText(error), run.stderr));
  }
}

async function logOut(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): Promise<void> {
  const run = await runAuth(deps, ['logout'], profileDir);
  if (run.code !== 0) {
    throw new Error(
      withStderr(`claude auth logout exited with code ${run.code}`, run.stderr),
    );
  }
}

// Whether the status `after` a login that exited with `code` is a sign-in
// that login made, given the status `before` it (null when unknown).
function isNewSignIn(
  before: AccountStatus | null,
  after: AccountStatus,
  code: number | null,
): boolean {
  const wasSignedIn = before?.signedIn === true;
  const isOtherAccount = before?.account !== after.account;
  return after.signedIn && (code === 0 || !wasSignedIn || isOtherAccount);
}

// `claude auth login` with stdin a pipe for the pasted code. Its exit code
// after a finished sign-in is unmeasured, so every exit reads the status, and
// a status read as the login starts tells a new sign-in from the profile's
// old one: a signed-in status ends the sign-in finished when the login exited
// 0, the profile was signed out before, or the account changed.
function startLogIn(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
  events: LogInEvents,
): LogInProcess {
  // A failed read leaves the earlier status unknown, read as signed out.
  const statusBefore = readAuthStatus(deps, profileDir).catch(() => null);
  const { command, child } = spawnAuth(deps, ['login'], profileDir);
  let stdout = '';
  let stderr = '';
  let hasLink = false;
  let hasEnded = false;

  const end = (status: AccountStatus | null, error: string | null) => {
    if (hasEnded) {
      return;
    }
    hasEnded = true;
    queueMicrotask(() => events.ended({ status, error }));
  };

  // The link line may arrive on either stream, split across chunks; each
  // stream is searched alone, so the other's chunks cannot split the line.
  const findLink = (output: string) => {
    if (hasLink) {
      return;
    }
    const url = signInLink(output);
    if (url !== null) {
      hasLink = true;
      queueMicrotask(() => events.link(url));
    }
  };

  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    findLink(stdout);
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
    findLink(stderr);
  });
  child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    if (hasEnded) {
      return;
    }
    const lastStderr = stderr.trim().split('\n').at(-1) ?? '';
    const failure =
      lastStderr === ''
        ? `claude auth login exited with ${exitText(code, signal)}`
        : lastStderr;
    Promise.all([statusBefore, readAuthStatus(deps, profileDir)]).then(
      ([before, after]) =>
        end(after, isNewSignIn(before, after, code) ? null : failure),
      (error: unknown) => end(null, errorText(error)),
    );
  });
  child.on('error', (error: Error) =>
    end(null, authSpawnError(error, command)),
  );

  return {
    sendCode(code) {
      if (hasEnded) {
        return;
      }
      child.stdin.write(`${code}\n`);
    },
    cancel() {
      if (hasEnded) {
        return;
      }
      child.kill();
      end(null, 'Sign-in cancelled');
    },
  };
}

// Where Claude saves every project's transcripts: `projects` in the
// session's config folder.
function projectsRoot(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): string {
  return deps.paths.join(
    claudeConfigFolder(profileDir, deps.env, deps.homeDir, deps.paths),
    'projects',
  );
}

// Where Claude saves `projectDir`'s transcripts.
function projectsFolder(
  deps: ClaudeCodeHarnessDeps,
  projectDir: string,
  profileDir: string | null,
): string {
  return deps.paths.join(
    projectsRoot(deps, profileDir),
    projectFolderName(projectDir),
  );
}

// The Claude Code CLI behind `AgentHarness`: one `claude` process per
// session, the only place the app spawns it, the sessions and project folders
// it saved, and its `claude auth` sign-in.
export function createClaudeCodeHarness(
  deps: ClaudeCodeHarnessDeps,
): AgentHarness {
  return {
    id: 'claude',
    start: (request, events) => startClaudeProcess(deps, request, events),
    listSessions: (projectDir, profileDir) =>
      listPastSessions(
        { files: deps.files, paths: deps.paths, log: deps.log },
        projectsFolder(deps, projectDir, profileDir),
        projectDir,
      ),
    history: (sessionId, projectDir, profileDir) =>
      readHistory(
        deps.files,
        deps.paths,
        projectsFolder(deps, projectDir, profileDir),
        sessionId,
      ),
    accountStatus: (profileDir) => readAuthStatus(deps, profileDir),
    logIn: (profileDir, events) => startLogIn(deps, profileDir, events),
    logOut: (profileDir) => logOut(deps, profileDir),
    listProjects: (profileDir) =>
      listProjectFolders(
        { files: deps.files, paths: deps.paths, log: deps.log },
        projectsRoot(deps, profileDir),
      ),
  };
}
