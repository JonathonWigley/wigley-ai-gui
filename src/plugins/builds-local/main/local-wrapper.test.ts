import { describe, expect, it } from 'vitest';
import type { OsName } from '../../../contracts/platform';
import type { ProcessResult } from '../../../contracts/processes';
import {
  aliveCheckLine,
  isAlive,
  killLine,
  type LocalTarget,
  type ProgramLine,
  wrapperLine,
} from './local-wrapper';

// Written out, not imported, so a changed script turns its rows red.
const POSIX_WRAPPER =
  'echo $$ > "$1"; exit_file="$2"; shift 2; "$@"; code=$?; echo "$code" > "$exit_file.tmp"; mv "$exit_file.tmp" "$exit_file"';

const POSIX_FILES = {
  pid: '/data/runs/r1/pid',
  exitCode: '/data/runs/r1/exit-code',
};
const WINDOWS_FILES = {
  pid: 'C:\\data\\runs\\r1\\pid',
  exitCode: 'C:\\data\\runs\\r1\\exit-code',
};
const BUILD: LocalTarget = { command: './build.sh', args: ['--env', 'dev'] };
const POSIX_LINE: ProgramLine = {
  command: '/bin/sh',
  args: [
    '-c',
    POSIX_WRAPPER,
    'builds-local',
    '/data/runs/r1/pid',
    '/data/runs/r1/exit-code',
    './build.sh',
    '--env',
    'dev',
  ],
};
const WINDOWS_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
];

function result(fields: Partial<ProcessResult>): ProcessResult {
  return { code: 0, stdout: '', stderr: '', timedOut: false, ...fields };
}

const ALIVE = result({
  stdout:
    '/bin/sh -c sh-script builds-local /data/runs/demo/ok/1000000/pid /data/runs/demo/ok/1000000/exit-code ./build.sh --env dev\n',
});
const ANOTHER_PROGRAM = result({ stdout: '/usr/bin/vim notes.txt\n' });
const ANOTHER_RUN = result({
  stdout:
    '/bin/sh -c sh-script builds-local /data/runs/demo/qa/900000/pid /data/runs/demo/qa/900000/exit-code ./build.sh\n',
});
const POSIX_PID_FILE = '/data/runs/demo/ok/1000000/pid';
// Its quote is doubled in the wrapper's command line.
const WINDOWS_PID_FILE = "C:\\data\\runs\\demo's\\ok\\1000000\\pid";
const GONE = result({ code: 1 });
const TIMED_OUT = result({ code: -1, timedOut: true });
const PS_LINE: ProgramLine = {
  command: 'ps',
  args: ['-o', 'command=', '-p', '4321'],
};
const WINDOWS_CHECK_LINE: ProgramLine = {
  command: 'powershell.exe',
  args: [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-CimInstance Win32_Process -Filter "ProcessId=4321").CommandLine',
  ],
};

describe('wrapperLine', () => {
  it.each<{
    os: OsName;
    files: { pid: string; exitCode: string };
    target: LocalTarget;
    expected: ProgramLine;
  }>([
    { os: 'macos', files: POSIX_FILES, target: BUILD, expected: POSIX_LINE },
    { os: 'linux', files: POSIX_FILES, target: BUILD, expected: POSIX_LINE },
    {
      os: 'windows',
      files: WINDOWS_FILES,
      target: { command: 'build.cmd', args: ['--env', "it's"] },
      expected: {
        command: 'powershell.exe',
        args: [
          ...WINDOWS_ARGS,
          "Set-Content -LiteralPath 'C:\\data\\runs\\r1\\pid' -Value $PID -ErrorAction Stop; try { & 'build.cmd' '--env' 'it''s'; $code = $LASTEXITCODE } catch { Write-Output $_; $code = 1 }; if ($null -eq $code) { $code = 0 }; Set-Content -LiteralPath 'C:\\data\\runs\\r1\\exit-code.tmp' -Value $code -ErrorAction Stop; Move-Item -LiteralPath 'C:\\data\\runs\\r1\\exit-code.tmp' -Destination 'C:\\data\\runs\\r1\\exit-code' -Force -ErrorAction Stop # builds-local",
        ],
      },
    },
  ])('$os', ({ os, files, target, expected }) => {
    expect(wrapperLine(os, files, target)).toEqual(expected);
  });

  it.each([
    {
      name: 'no args',
      target: { command: 'build.cmd', args: [] },
      call: "& 'build.cmd'; $code = $LASTEXITCODE",
    },
    {
      name: 'a typographic quote',
      target: { command: 'build.cmd', args: ['--name', 'it\u2019s'] },
      call: "& 'build.cmd' '--name' 'it\u2019\u2019s'; $code = $LASTEXITCODE",
    },
  ])('windows with $name', ({ target, call }) => {
    const line = wrapperLine('windows', WINDOWS_FILES, target);

    expect(line.args.slice(0, -1)).toEqual(WINDOWS_ARGS);
    expect(line.args.at(-1)).toContain(call);
  });
});

describe('aliveCheckLine and isAlive', () => {
  it.each<{
    os: OsName;
    line: ProgramLine;
    name: string;
    answer: ProcessResult;
    alive: boolean;
  }>([
    { os: 'macos', line: PS_LINE, name: 'alive', answer: ALIVE, alive: true },
    {
      os: 'macos',
      line: PS_LINE,
      name: 'another program',
      answer: ANOTHER_PROGRAM,
      alive: false,
    },
    { os: 'macos', line: PS_LINE, name: 'gone', answer: GONE, alive: false },
    {
      os: 'macos',
      line: PS_LINE,
      name: "another run's wrapper",
      answer: ANOTHER_RUN,
      alive: false,
    },
    {
      os: 'macos',
      line: PS_LINE,
      name: 'timed out',
      answer: TIMED_OUT,
      alive: true,
    },
    { os: 'linux', line: PS_LINE, name: 'alive', answer: ALIVE, alive: true },
    {
      os: 'linux',
      line: PS_LINE,
      name: 'another program',
      answer: ANOTHER_PROGRAM,
      alive: false,
    },
    {
      os: 'linux',
      line: PS_LINE,
      name: 'timed out',
      answer: TIMED_OUT,
      alive: true,
    },
    {
      os: 'windows',
      line: WINDOWS_CHECK_LINE,
      name: 'the wrapper',
      answer: result({
        stdout:
          "powershell.exe -NoProfile -Command Set-Content -LiteralPath 'C:\\data\\runs\\demo''s\\ok\\1000000\\pid' -Value $PID; ps-script # builds-local\r\n",
      }),
      alive: true,
    },
    {
      os: 'windows',
      line: WINDOWS_CHECK_LINE,
      name: "another run's wrapper",
      answer: result({
        stdout:
          "powershell.exe -NoProfile -Command Set-Content -LiteralPath 'C:\\data\\runs\\demo''s\\qa\\900000\\pid' -Value $PID; ps-script # builds-local\r\n",
      }),
      alive: false,
    },
    {
      os: 'windows',
      line: WINDOWS_CHECK_LINE,
      name: 'another program',
      answer: result({ stdout: 'C:\\Windows\\notepad.exe\r\n' }),
      alive: false,
    },
    {
      os: 'windows',
      line: WINDOWS_CHECK_LINE,
      name: 'no process',
      answer: result({ stdout: '' }),
      alive: false,
    },
    {
      os: 'windows',
      line: WINDOWS_CHECK_LINE,
      name: 'timed out',
      answer: TIMED_OUT,
      alive: true,
    },
  ])('$os, $name → $alive', ({ os, line, answer, alive }) => {
    expect(aliveCheckLine(os, 4321)).toEqual(line);
    const pidFile = os === 'windows' ? WINDOWS_PID_FILE : POSIX_PID_FILE;
    expect(isAlive(os, pidFile, answer)).toBe(alive);
  });
});

describe('killLine', () => {
  it.each<{ os: OsName; expected: ProgramLine }>([
    {
      os: 'macos',
      expected: { command: 'kill', args: ['-TERM', '--', '-4321'] },
    },
    {
      os: 'windows',
      expected: { command: 'taskkill', args: ['/PID', '4321', '/T', '/F'] },
    },
  ])('$os', ({ os, expected }) => {
    expect(killLine(os, 4321)).toEqual(expected);
  });
});
