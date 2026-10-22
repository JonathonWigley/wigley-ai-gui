import { spawn } from 'node:child_process';

// An app started from Finder or the Dock inherits launchd's bare PATH, not the
// one the user's shell profile builds, so a bare program name such as
// `python3` resolves to the system's copy instead of the user's. An app
// started from a terminal inherits the PATH that terminal built (nvm, a
// venv), which the login shell's PATH would undo.

const START_MARKER = '__WIGLEY_LOGIN_PATH_START__';
const END_MARKER = '__WIGLEY_LOGIN_PATH_END__';
const READ_TIMEOUT_MS = 3000;

// What the login shell runs: its PATH between the markers, so whatever its
// profile prints around it is ignored.
const PRINT_PATH = `printf '%s%s%s' '${START_MARKER}' "$PATH" '${END_MARKER}'`;

// The PATH between the markers in the shell's `output`, or null when either
// marker is missing or nothing sits between them.
export function pathFromMarkedOutput(output: string): string | null {
  const start = output.indexOf(START_MARKER);
  if (start === -1) {
    return null;
  }
  const valueStart = start + START_MARKER.length;
  const end = output.indexOf(END_MARKER, valueStart);
  if (end === -1) {
    return null;
  }
  const path = output.slice(valueStart, end).trim();
  return path === '' ? null : path;
}

// The parent pid of an app launchd started: Finder, the Dock, `open`, a
// LaunchAgent.
const LAUNCHD_PID = 1;

// Whether main swaps in the login shell's PATH: only for an app launchd
// started, whose inherited PATH is launchd's bare one. A terminal start
// (`npm start` spawns Electron from the terminal's process tree), the
// self-test and a drive run keep the PATH they inherited.
export function shouldReadLoginShellPath(start: {
  isLive: boolean;
  parentPid: number;
}): boolean {
  return start.isLive && start.parentPid === LAUNCHD_PID;
}

// The PATH an interactive login run of `shell` builds, or null when `shell`
// is unset (as on Windows), fails to start, or closes its output without a
// marked PATH within `timeoutMs`. Settles within `timeoutMs` and never
// rejects.
export function readLoginShellPath(
  shell: string | undefined,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<string | null> {
  if (!shell) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    // Detached, the shell leads its own process group, so the cap can kill
    // whatever its profile started along with it.
    const child = spawn(shell, ['-ilc', PRINT_PATH], {
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
      resolve(null);
    });
    // `close` waits for stdout to close, which a process the profile started
    // can hold open after the shell exits. A profile that errors after
    // printing still printed the PATH, so the output is read whatever the
    // exit.
    child.on('close', () => {
      clearTimeout(cap);
      resolve(pathFromMarkedOutput(output));
    });
    // An interactive shell ignores SIGTERM, so the group gets SIGKILL. The
    // read settles before the kill, so a kill that fails cannot hold it open.
    const cap = setTimeout(() => {
      resolve(null);
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
