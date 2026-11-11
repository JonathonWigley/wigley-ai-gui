import { spawn } from 'node:child_process';

// An app started from Finder or the Dock inherits launchd's environment, not
// the one the user's shell profile builds. Its bare PATH resolves a program
// name such as `python3` to the system's copy instead of the user's. Its
// SSH_AUTH_SOCK is launchd's agent, not the one a profile exports (such as
// 1Password's), so an ssh host whose config reads `IdentityAgent
// SSH_AUTH_SOCK` gets no key and `git fetch` over ssh is denied. An app
// started from a terminal inherits what that terminal built (nvm, a venv),
// which the login shell's would undo.

const START_MARKER = '__WIGLEY_LOGIN_ENV_START__';
const SEPARATOR = '__WIGLEY_LOGIN_ENV_SEP__';
const END_MARKER = '__WIGLEY_LOGIN_ENV_END__';
const READ_TIMEOUT_MS = 3000;

// What the login shell runs: its PATH and SSH_AUTH_SOCK between the markers,
// so whatever its profile prints around them is ignored.
const PRINT_ENV = `printf '%s%s%s%s%s' '${START_MARKER}' "$PATH" '${SEPARATOR}' "$SSH_AUTH_SOCK" '${END_MARKER}'`;

// The variables main takes from the login shell; each null when the shell
// set none, so the inherited one stays.
export interface LoginShellEnv {
  path: string | null;
  sshAuthSock: string | null;
}

const NO_ENV: LoginShellEnv = { path: null, sshAuthSock: null };

// The variables between the markers in the shell's `output`; both null when
// a marker or the separator is missing, and each null when it is empty.
export function envFromMarkedOutput(output: string): LoginShellEnv {
  const start = output.indexOf(START_MARKER);
  if (start === -1) {
    return NO_ENV;
  }
  const valueStart = start + START_MARKER.length;
  const end = output.indexOf(END_MARKER, valueStart);
  if (end === -1) {
    return NO_ENV;
  }
  const values = output.slice(valueStart, end);
  const separator = values.indexOf(SEPARATOR);
  if (separator === -1) {
    return NO_ENV;
  }
  return {
    path: nonEmpty(values.slice(0, separator)),
    sshAuthSock: nonEmpty(values.slice(separator + SEPARATOR.length)),
  };
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// The parent pid of an app launchd started: Finder, the Dock, `open`, a
// LaunchAgent.
const LAUNCHD_PID = 1;

// Whether main swaps in the login shell's variables: only for an app launchd
// started, whose inherited ones are launchd's. A terminal start (`npm start`
// spawns Electron from the terminal's process tree), the self-test and a drive
// run keep the ones they inherited.
export function shouldReadLoginShellEnv(start: {
  isLive: boolean;
  parentPid: number;
}): boolean {
  return start.isLive && start.parentPid === LAUNCHD_PID;
}

// The PATH and SSH_AUTH_SOCK an interactive login run of `shell` builds;
// both null when `shell` is unset (as on Windows), fails to start, or closes
// its output without marked variables within `timeoutMs`. Settles within
// `timeoutMs` and never rejects.
export function readLoginShellEnv(
  shell: string | undefined,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<LoginShellEnv> {
  if (!shell) {
    return Promise.resolve(NO_ENV);
  }
  return new Promise((resolve) => {
    // Detached, the shell leads its own process group, so the cap can kill
    // whatever its profile started along with it.
    const child = spawn(shell, ['-ilc', PRINT_ENV], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // The output pipe alone keeps the read alive; the shell's handle never
    // holds the app open.
    child.unref();
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.on('error', () => {
      clearTimeout(cap);
      resolve(NO_ENV);
    });
    // `close` waits for stdout to close, which a process the profile started
    // can hold open after the shell exits. A profile that errors after
    // printing still printed the variables, so the output is read whatever
    // the exit.
    child.on('close', () => {
      clearTimeout(cap);
      resolve(envFromMarkedOutput(output));
    });
    // An interactive shell ignores SIGTERM, so the group gets SIGKILL. The
    // read settles before the kill, so a kill that fails cannot hold it open.
    const cap = setTimeout(() => {
      resolve(NO_ENV);
      if (child.pid !== undefined) {
        killProcessGroup(child.pid);
      }
    }, timeoutMs);
  });
}

// SIGKILL to the process group `leaderPid` leads. Every kill error is
// swallowed: ESRCH (the group already gone) is expected, and any other, such
// as EPERM, leaves a stray shell rather than crashing main.
function killProcessGroup(leaderPid: number): void {
  try {
    process.kill(-leaderPid, 'SIGKILL');
  } catch {
    // Nothing left to do.
  }
}
