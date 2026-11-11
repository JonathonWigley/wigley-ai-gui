import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  envFromMarkedOutput,
  readLoginShellEnv,
  shouldReadLoginShellEnv,
} from './login-shell-env';

const START = '__WIGLEY_LOGIN_ENV_START__';
const SEP = '__WIGLEY_LOGIN_ENV_SEP__';
const END = '__WIGLEY_LOGIN_ENV_END__';
const NONE = { path: null, sshAuthSock: null };

// The shell stand-ins below are `#!/bin/sh` scripts, which only a machine
// with that shell can run.
const hasPosixShell = existsSync('/bin/sh');

describe('envFromMarkedOutput', () => {
  it('reads PATH and SSH_AUTH_SOCK between the markers, ignoring what the profile prints around them', () => {
    const output = `Welcome back\n${START}/opt/homebrew/bin:/usr/bin${SEP}/Users/u/agent.sock${END}\nbye\n`;

    expect(envFromMarkedOutput(output)).toEqual({
      path: '/opt/homebrew/bin:/usr/bin',
      sshAuthSock: '/Users/u/agent.sock',
    });
  });

  it('reads the first marked variables when the shell prints the markers twice', () => {
    const output = `${START}/a:/b${SEP}/s${END}${START}/c${SEP}/t${END}`;

    expect(envFromMarkedOutput(output)).toEqual({
      path: '/a:/b',
      sshAuthSock: '/s',
    });
  });

  it.each([
    [
      'an empty SSH_AUTH_SOCK',
      `${START}/a${SEP}${END}`,
      { path: '/a', sshAuthSock: null },
    ],
    [
      'an empty PATH',
      `${START} ${SEP}/s${END}`,
      { path: null, sshAuthSock: '/s' },
    ],
  ])('keeps the inherited variable for %s', (_case, output, env) => {
    expect(envFromMarkedOutput(output)).toEqual(env);
  });

  it.each([
    ['no markers', '/usr/bin:/bin'],
    ['no end marker, as when the shell was killed', `${START}/usr/bin${SEP}/s`],
    ['an end marker only', `/usr/bin${SEP}/s${END}`],
    ['an end marker before the start marker', `${END}/usr/bin${START}`],
    ['no separator', `${START}/usr/bin${END}`],
    ['nothing between the markers', `${START}  ${SEP} ${END}`],
    ['empty output', ''],
  ])('returns no variables for %s', (_case, output) => {
    expect(envFromMarkedOutput(output)).toEqual(NONE);
  });
});

describe('shouldReadLoginShellEnv', () => {
  it('reads for an app launchd started', () => {
    expect(shouldReadLoginShellEnv({ isLive: true, parentPid: 1 })).toBe(true);
  });

  it.each([
    ['a terminal start, whose parent is the terminal process tree', true, 4321],
    ['a self-test or drive run, even when launchd started it', false, 1],
    ['a self-test or drive run from a terminal', false, 4321],
  ])('keeps the inherited PATH for %s', (_case, isLive, parentPid) => {
    expect(shouldReadLoginShellEnv({ isLive, parentPid })).toBe(false);
  });
});

// Whether a process with `pid` still runs, polled up to `limitMs` so a
// killed process has time to be reaped.
async function isRunningAfter(pid: number, limitMs: number): Promise<boolean> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        return false;
      }
      throw error;
    }
    if (Date.now() >= deadline) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('readLoginShellEnv', () => {
  const CAP_MS = 1000;
  // Well short of how long each stand-in holds the read open without the cap.
  const SETTLE_LIMIT_MS = 3000;
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'wigley-login-shell-'));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  // A shell stand-in at a new path in `folder` that runs `body` and ignores
  // its arguments.
  function standInShell(body: string): string {
    const shell = path.join(folder, 'shell');
    writeFileSync(shell, `#!/bin/sh\n${body}\n`);
    chmodSync(shell, 0o755);
    return shell;
  }

  it.skipIf(!hasPosixShell)(
    'reads the variables the shell prints between the markers',
    async () => {
      const shell = standInShell(`printf '%s' '${START}/a:/b${SEP}/s${END}'`);

      expect(await readLoginShellEnv(shell, CAP_MS)).toEqual({
        path: '/a:/b',
        sshAuthSock: '/s',
      });
    },
  );

  it.skipIf(!hasPosixShell)(
    'resolves null within the cap when the shell ignores SIGTERM and never exits',
    async () => {
      const shell = standInShell(
        `trap '' TERM\nprintf '%s' '${START}/a'\nwhile :; do :; done`,
      );

      expect(await readLoginShellEnv(shell, CAP_MS)).toEqual(NONE);
    },
    SETTLE_LIMIT_MS,
  );

  it.skipIf(!hasPosixShell)(
    'reads the variables at the end marker while a child holds stdout open, then kills the child',
    async () => {
      const pidFile = path.join(folder, 'child.pid');
      const shell = standInShell(
        `sleep 5 &\necho $! > '${pidFile}'\nprintf '%s' '${START}/a${SEP}/s${END}'`,
      );
      const startedAt = Date.now();

      expect(await readLoginShellEnv(shell, CAP_MS)).toEqual({
        path: '/a',
        sshAuthSock: '/s',
      });
      expect(Date.now() - startedAt).toBeLessThan(CAP_MS);
      const childPid = Number(readFileSync(pidFile, 'utf8'));
      expect(await isRunningAfter(childPid, 500)).toBe(false);
    },
    SETTLE_LIMIT_MS,
  );

  it.skipIf(!hasPosixShell)(
    'resolves no variables within the cap when a child holds stdout open with no end marker',
    async () => {
      const pidFile = path.join(folder, 'child.pid');
      const shell = standInShell(
        `sleep 5 &\necho $! > '${pidFile}'\nprintf '%s' '${START}/a${SEP}/s'`,
      );

      expect(await readLoginShellEnv(shell, CAP_MS)).toEqual(NONE);
      const childPid = Number(readFileSync(pidFile, 'utf8'));
      expect(await isRunningAfter(childPid, 500)).toBe(false);
    },
    SETTLE_LIMIT_MS,
  );

  it.skipIf(!hasPosixShell)(
    'resolves null within the cap when killing the group fails with EPERM',
    async () => {
      const pidFile = path.join(folder, 'shell.pid');
      const shell = standInShell(
        `echo $$ > '${pidFile}'\nprintf '%s' '${START}/a'\nexec sleep 5`,
      );
      const realKill = process.kill.bind(process);
      const kill = vi
        .spyOn(process, 'kill')
        .mockImplementation((pid: number, signal?: string | number) => {
          if (pid < 0) {
            throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
          }
          return realKill(pid, signal);
        });

      try {
        expect(await readLoginShellEnv(shell, CAP_MS)).toEqual(NONE);
      } finally {
        kill.mockRestore();
        process.kill(-Number(readFileSync(pidFile, 'utf8')), 'SIGKILL');
      }
    },
    SETTLE_LIMIT_MS,
  );

  it('resolves null when the shell fails to start', async () => {
    expect(
      await readLoginShellEnv(path.join(folder, 'missing'), CAP_MS),
    ).toEqual(NONE);
  });
});
