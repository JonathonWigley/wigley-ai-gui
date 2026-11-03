import { execFile, type ExecFileException } from 'node:child_process';

const REPORT_LIMIT_MS = 5000;
const PS_LINE = /^(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/;

// What the OS says of a running process. Two reports of one process are equal, whichever host asked.
export interface ProcessReport {
  startedAt: string;
  command: string;
}

// The processes of this machine, by pid. `signal` reaches any pid it is given: `host-children` alone calls it, each
// time on a pid it has just compared with its record.
export interface OsProcesses {
  // Null when no process has that pid. Rejects when the OS could not be asked.
  report(pid: number): Promise<ProcessReport | null>;
  // Throws as `process.kill` does. On Windows either signal ends the process at once.
  signal(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void;
}

// A line of `ps -o lstart= -o comm=`.
export function parsePsReport(stdout: string): ProcessReport | null {
  const match = PS_LINE.exec(stdout.trim());
  return match === null ? null : { startedAt: match[1], command: match[2] };
}

// The line of `windowsReportScript`: start time and executable path, tab separated.
export function parseWindowsReport(stdout: string): ProcessReport | null {
  const [startedAt, command] = stdout.trim().split('\t');
  return startedAt && command ? { startedAt, command } : null;
}

function windowsReportScript(pid: number): string {
  return `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | ForEach-Object { ($_.CreationDate.ToUniversalTime().ToString('o'), $_.ExecutablePath) -join [char]9 }`;
}

function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; error: ExecFileException | null }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { env, timeout: REPORT_LIMIT_MS, windowsHide: true },
      (error, stdout) => resolve({ stdout, error }),
    );
  });
}

async function reportFromPs(pid: number): Promise<ProcessReport | null> {
  // The fixed locale and zone keep `lstart` one string across hosts. `comm` is the path the process was started by.
  const { stdout, error } = await run(
    '/bin/ps',
    ['-ww', '-o', 'lstart=', '-o', 'comm=', '-p', String(pid)],
    { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
  );
  // `ps` exits with a status when it finds no such pid; any other failure has no numeric code.
  if (error !== null && typeof error.code !== 'number') {
    throw error;
  }
  return error === null ? parsePsReport(stdout) : null;
}

async function reportFromPowerShell(
  pid: number,
): Promise<ProcessReport | null> {
  const { stdout, error } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', windowsReportScript(pid)],
    process.env,
  );
  if (error !== null) {
    throw error;
  }
  return parseWindowsReport(stdout);
}

export function createOsProcesses(platform: NodeJS.Platform): OsProcesses {
  return {
    report: platform === 'win32' ? reportFromPowerShell : reportFromPs,
    signal(pid, signal) {
      process.kill(pid, signal);
    },
  };
}
