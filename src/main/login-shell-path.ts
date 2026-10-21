import { execFile } from 'node:child_process';

// An app started from Finder or the Dock inherits launchd's bare PATH, not the
// one the user's shell profile builds, so a bare program name such as
// `python3` resolves to the system's copy instead of the user's.

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

// The PATH an interactive login run of `shell` builds, or null when `shell`
// is unset (as on Windows), fails to start, or prints no marked PATH within
// `timeoutMs`. Settles within `timeoutMs` and never rejects.
export function readLoginShellPath(
  shell: string | undefined,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<string | null> {
  if (!shell) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    // An interactive shell ignores SIGTERM, so a profile that blocks is
    // killed with SIGKILL.
    const child = execFile(
      shell,
      ['-ilc', PRINT_PATH],
      { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' },
      // A profile that errors after printing still printed the PATH, so the
      // output is read whatever the exit.
      (_error, stdout) => {
        clearTimeout(cap);
        resolve(pathFromMarkedOutput(stdout ?? ''));
      },
    );
    // The callback waits for stdout to close, which a process the profile
    // started can hold open after the shell exits.
    const cap = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);
  });
}
