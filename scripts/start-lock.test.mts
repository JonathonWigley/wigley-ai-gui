import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mayReleaseStartLock,
  STARTUP_RELOAD_WAIT_MS,
  type StartLock,
  type StartLockOptions,
  selfTestLoadOf,
  takeStartLock,
} from './start-lock.mts';

const HOLDER_PID = 4242;

function writeHolder(lockFile: string, pid: number): void {
  mkdirSync(path.dirname(lockFile), { recursive: true });
  writeFileSync(lockFile, String(pid));
}

describe('takeStartLock', () => {
  let tempDir: string;
  let lockFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'start-lock-'));
    lockFile = path.join(tempDir, '.drive', 'start.lock');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function options(overrides: Partial<StartLockOptions>): StartLockOptions {
    return {
      timeoutMs: 1_000,
      pollMs: 5,
      isAlive: () => true,
      onWait: () => {},
      ...overrides,
    };
  }

  it('GIVEN no lock file WHEN takeStartLock runs THEN it creates the file holding the pid and release removes it', async () => {
    const lock = await takeStartLock(lockFile, options({}));

    expect(readFileSync(lockFile, 'utf8')).toBe(String(process.pid));
    lock.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it('GIVEN a lock file whose pid is alive WHEN takeStartLock runs and the holder releases after two polls THEN it calls onWait once with that pid and then takes the lock', async () => {
    writeHolder(lockFile, HOLDER_PID);
    let checks = 0;
    const onWait = vi.fn();

    await takeStartLock(
      lockFile,
      options({
        onWait,
        isAlive: () => {
          checks += 1;
          if (checks === 2) {
            rmSync(lockFile);
          }
          return true;
        },
      }),
    );

    expect(onWait.mock.calls).toEqual([[HOLDER_PID]]);
    expect(readFileSync(lockFile, 'utf8')).toBe(String(process.pid));
  });

  it('GIVEN a lock file whose pid is not alive WHEN takeStartLock runs THEN it takes the lock without waiting', async () => {
    writeHolder(lockFile, HOLDER_PID);
    const onWait = vi.fn();

    await takeStartLock(lockFile, options({ onWait, isAlive: () => false }));

    expect(onWait).not.toHaveBeenCalled();
    expect(readFileSync(lockFile, 'utf8')).toBe(String(process.pid));
  });

  it('GIVEN two takers that both read a dead holder WHEN the second clears and takes the lock before the first clears it THEN the first leaves the second its lock and takes it only once it is released', async () => {
    writeHolder(lockFile, HOLDER_PID);
    const isHolderAlive = (pid: number) => pid !== HOLDER_PID;
    let second: Promise<StartLock> | undefined;
    let isFirstTaken = false;
    const first = takeStartLock(
      lockFile,
      options({
        isAlive: (pid) => {
          // Runs the second taker's clear and take, which never await,
          // between the first taker's read of the dead pid and its clear.
          second ??= takeStartLock(
            lockFile,
            options({ isAlive: isHolderAlive }),
          );
          return isHolderAlive(pid);
        },
      }),
    ).then((lock) => {
      isFirstTaken = true;
      return lock;
    });

    const secondLock = await second!;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(isFirstTaken).toBe(false);
    expect(readFileSync(lockFile, 'utf8')).toBe(String(process.pid));

    secondLock.release();
    await first;
    expect(readdirSync(path.dirname(lockFile))).toEqual(['start.lock']);
  });

  it('GIVEN a released lock another taker has since taken WHEN the first lock is released again THEN the file still holds the second taker', async () => {
    const lock = await takeStartLock(lockFile, options({}));
    lock.release();
    writeHolder(lockFile, HOLDER_PID);

    lock.release();

    expect(readFileSync(lockFile, 'utf8')).toBe(String(HOLDER_PID));
  });

  it.each(['', 'x'])(
    'GIVEN a lock file holding %j WHEN takeStartLock runs THEN it clears the file and takes the lock without waiting',
    async (text) => {
      mkdirSync(path.dirname(lockFile), { recursive: true });
      writeFileSync(lockFile, text);
      const onWait = vi.fn();

      await takeStartLock(lockFile, options({ onWait }));

      expect(onWait).not.toHaveBeenCalled();
      expect(readFileSync(lockFile, 'utf8')).toBe(String(process.pid));
    },
  );

  it('GIVEN a lock held past timeoutMs WHEN takeStartLock runs THEN it rejects naming the holder pid', async () => {
    writeHolder(lockFile, HOLDER_PID);

    await expect(
      takeStartLock(lockFile, options({ timeoutMs: 30 })),
    ).rejects.toThrow(`pid ${HOLDER_PID}`);
  });

  it('GIVEN two takeStartLock calls started together with live pids WHEN both run THEN exactly one takes the lock and the other waits until it is released', async () => {
    const taken: string[] = [];
    const first = takeStartLock(lockFile, options({})).then((lock) => {
      taken.push('first');
      return lock;
    });
    const second = takeStartLock(lockFile, options({})).then((lock) => {
      taken.push('second');
      return lock;
    });

    const winner = await Promise.race([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(taken).toHaveLength(1);

    winner.release();
    await Promise.all([first, second]);
    expect(taken).toHaveLength(2);
  });
});

describe('mayReleaseStartLock', () => {
  it('GIVEN the first page load WHEN the reload wait has not passed THEN the lock is kept', () => {
    expect(mayReleaseStartLock(1, STARTUP_RELOAD_WAIT_MS - 1)).toBe(false);
  });

  it('GIVEN the load after the startup reload WHEN it is reported at once THEN the lock may be released', () => {
    expect(mayReleaseStartLock(2, 0)).toBe(true);
  });

  it('GIVEN the first page load WHEN the reload wait has passed THEN the lock may be released', () => {
    expect(mayReleaseStartLock(1, STARTUP_RELOAD_WAIT_MS)).toBe(true);
  });
});

describe('selfTestLoadOf', () => {
  it('GIVEN the line main prints as a load starts its run WHEN it is read THEN it gives the load', () => {
    expect(selfTestLoadOf('[selftest] page load 2 starts its run')).toBe(2);
  });

  it('GIVEN a check line WHEN it is read THEN it gives null', () => {
    expect(selfTestLoadOf('[selftest] PASS [forms] round shown')).toBeNull();
  });
});
