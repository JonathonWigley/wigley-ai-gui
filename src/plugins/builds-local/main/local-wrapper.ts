import type { OsName } from '../../../contracts/platform';
import type { ProcessResult } from '../../../contracts/processes';

// A build kind's command, run in the game's clone.
export interface LocalTarget {
  command: string;
  args: string[];
}

// One program to run, with its args.
export interface ProgramLine {
  command: string;
  args: string[];
}

// The word each wrapper puts in its process command line, which the alive check looks for.
const WRAPPER_MARK = 'builds-local';

// `$$` is the shell's pid, and the group id of the group `startDetached` makes it lead. The temp file and `mv` make
// the exit-code file appear whole.
const POSIX_WRAPPER =
  'echo $$ > "$1"; exit_file="$2"; shift 2; "$@"; code=$?; echo "$code" > "$exit_file.tmp"; mv "$exit_file.tmp" "$exit_file"';

// PowerShell reads each of these as a single quote.
const POWERSHELL_QUOTES = /['‘’‚‛]/g;

// The line that runs `target`, writing the wrapper's pid to `files.pid` as it starts and the target's exit code to
// `files.exitCode` once it ends.
export function wrapperLine(
  os: OsName,
  files: { pid: string; exitCode: string },
  target: LocalTarget,
): ProgramLine {
  if (os === 'windows') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        windowsWrapperScript(files, target),
      ],
    };
  }
  return {
    command: '/bin/sh',
    args: [
      '-c',
      POSIX_WRAPPER,
      WRAPPER_MARK,
      files.pid,
      files.exitCode,
      target.command,
      ...target.args,
    ],
  };
}

// The line that prints the command line of the process `pid`, so `isAlive` can tell a wrapper from another program
// that took its pid after a reboot.
export function aliveCheckLine(os: OsName, pid: number): ProgramLine {
  if (os === 'windows') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
    };
  }
  return { command: 'ps', args: ['-o', 'command=', '-p', String(pid)] };
}

// Whether the alive check of `pid` found a wrapper still running. A check that timed out counts as alive, so the
// next list checks again.
export function isAlive(
  os: OsName,
  pid: number,
  result: ProcessResult,
): boolean {
  if (result.timedOut) {
    return true;
  }
  const namesWrapper = result.stdout.includes(WRAPPER_MARK);
  return os === 'windows' ? namesWrapper : result.code === 0 && namesWrapper;
}

// The line that ends the wrapper of `pid` and every process under it: on macOS and Linux its whole process group.
export function killLine(os: OsName, pid: number): ProgramLine {
  if (os === 'windows') {
    return { command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
  }
  return { command: 'kill', args: ['-TERM', '--', `-${pid}`] };
}

function windowsWrapperScript(
  files: { pid: string; exitCode: string },
  target: LocalTarget,
): string {
  const call = [target.command, ...target.args].map(quoted).join(' ');
  const exitTemp = quoted(`${files.exitCode}.tmp`);
  return [
    "$ErrorActionPreference = 'Stop'",
    `Set-Content -LiteralPath ${quoted(files.pid)} -Value $PID`,
    `try { & ${call}; $code = $LASTEXITCODE } catch { Write-Output $_; $code = 1 }`,
    'if ($null -eq $code) { $code = 0 }',
    `Set-Content -LiteralPath ${exitTemp} -Value $code`,
    `Move-Item -LiteralPath ${exitTemp} -Destination ${quoted(files.exitCode)} -Force # ${WRAPPER_MARK}`,
  ].join('; ');
}

// `text` as a PowerShell single-quoted string.
function quoted(text: string): string {
  return `'${text.replace(POWERSHELL_QUOTES, '$&$&')}'`;
}
