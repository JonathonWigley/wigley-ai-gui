import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathFromMarkedOutput, readLoginShellPath } from './login-shell-path';

const START = '__WIGLEY_LOGIN_PATH_START__';
const END = '__WIGLEY_LOGIN_PATH_END__';

describe('pathFromMarkedOutput', () => {
  it('reads the PATH between the markers, ignoring what the profile prints around it', () => {
    const output = `Welcome back\n${START}/opt/homebrew/bin:/usr/bin${END}\nbye\n`;

    expect(pathFromMarkedOutput(output)).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('reads the first marked PATH when the shell prints the markers twice', () => {
    const output = `${START}/a:/b${END}${START}/c${END}`;

    expect(pathFromMarkedOutput(output)).toBe('/a:/b');
  });

  it.each([
    ['no markers', '/usr/bin:/bin'],
    ['no end marker, as when the shell was killed', `${START}/usr/bin`],
    ['an end marker only', `/usr/bin${END}`],
    ['an end marker before the start marker', `${END}/usr/bin${START}`],
    ['nothing between the markers', `${START}  ${END}`],
    ['empty output', ''],
  ])('returns null for %s', (_case, output) => {
    expect(pathFromMarkedOutput(output)).toBeNull();
  });
});

describe('readLoginShellPath', () => {
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

  it('reads the PATH the shell prints between the markers', async () => {
    const shell = standInShell(`printf '%s' '${START}/a:/b${END}'`);

    expect(await readLoginShellPath(shell, CAP_MS)).toBe('/a:/b');
  });

  it(
    'resolves null within the cap when the shell ignores SIGTERM and never exits',
    async () => {
      const shell = standInShell(
        `trap '' TERM\nprintf '%s' '${START}/a'\nwhile :; do :; done`,
      );

      expect(await readLoginShellPath(shell, CAP_MS)).toBeNull();
    },
    SETTLE_LIMIT_MS,
  );

  it(
    'resolves null within the cap when a child the shell started holds stdout open',
    async () => {
      const shell = standInShell(`sleep 5 &\nprintf '%s' '${START}/a${END}'`);

      expect(await readLoginShellPath(shell, CAP_MS)).toBeNull();
    },
    SETTLE_LIMIT_MS,
  );

  it('resolves null when the shell fails to start', async () => {
    expect(
      await readLoginShellPath(path.join(folder, 'missing'), CAP_MS),
    ).toBeNull();
  });
});
