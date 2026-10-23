// The lock dev starts take while `electron-forge start` empties and rewrites
// the shared `.vite/build`, so two starts never build over each other. The
// lock file holds its taker's pid as text.
import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

export interface StartLock {
  // Deletes the lock file on the first call only, so a later call never
  // deletes a lock another start has since taken.
  release(): void;
}

export interface StartLockOptions {
  timeoutMs: number;
  pollMs: number;
  isAlive(pid: number): boolean;
  // Called once, the first time the lock is found held by a live pid.
  onWait(holder: number): void;
}

// Takes `lockFile` for this process, waiting while a live pid holds it and
// clearing it when its holder has exited or it holds no pid; rejects once
// `options.timeoutMs` passes with the lock still held.
export async function takeStartLock(
  lockFile: string,
  options: StartLockOptions,
): Promise<StartLock> {
  mkdirSync(path.dirname(lockFile), { recursive: true });
  const deadline = Date.now() + options.timeoutMs;
  let hasWaited = false;
  while (!tryCreateLockFile(lockFile)) {
    const holder = readHolder(lockFile);
    const isHeld = holder !== null && options.isAlive(holder);
    if (!isHeld) {
      rmSync(lockFile, { force: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Another dev start (pid ${holder}) held ${lockFile} for ${options.timeoutMs / 1000} s; if no start is running, delete ${lockFile}`,
      );
    }
    if (!hasWaited) {
      options.onWait(holder);
      hasWaited = true;
    }
    await wait(options.pollMs);
  }
  let isReleased = false;
  return {
    release: () => {
      if (!isReleased) {
        isReleased = true;
        rmSync(lockFile, { force: true });
      }
    },
  };
}

// Creates `lockFile` holding this process's pid, or returns false when it
// exists. The pid goes into a temp file first and is hard-linked into place,
// so the lock file never exists without its pid.
function tryCreateLockFile(lockFile: string): boolean {
  const tempFile = `${lockFile}.${process.pid}`;
  writeFileSync(tempFile, String(process.pid));
  try {
    linkSync(tempFile, lockFile);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  } finally {
    unlinkSync(tempFile);
  }
}

// The pid in `lockFile`, or null when the file is gone or holds no pid.
function readHolder(lockFile: string): number | null {
  let text: string;
  try {
    text = readFileSync(lockFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

// Whether a process with `pid` exists.
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
