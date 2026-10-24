// The lock dev starts take while `electron-forge start` empties and rewrites
// the shared `.vite/build`, so two starts never build over each other, and
// when a start may release it. The lock file holds its taker's pid as text.
import { randomUUID } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
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
      clearDeadLock(lockFile, holder);
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
// so the lock file never exists without its pid. The write, link and unlink
// must stay synchronous: two takers in one process share the temp file's name.
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

// Deletes `lockFile` when it still holds `deadHolder`. The file is first
// renamed to a name only this call uses, and a rename is atomic, so of two
// takers that read the same dead holder only one moves the file; the other's
// rename fails with ENOENT. A file that no longer holds `deadHolder` is a
// lock another taker has since taken, and is linked back into place.
function clearDeadLock(lockFile: string, deadHolder: number | null): void {
  const movedFile = `${lockFile}.clearing-${randomUUID()}`;
  try {
    renameSync(lockFile, movedFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  try {
    if (readHolder(movedFile) !== deadHolder) {
      linkSync(movedFile, lockFile);
    }
  } catch (error) {
    // EEXIST: a third taker created the lock while it was moved aside. The
    // live holder and that taker then both hold it; the window is the few
    // microseconds between the rename and the link, and is accepted.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  } finally {
    unlinkSync(movedFile);
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

// The page load a dev start's app is on once the dev server's startup reload,
// which re-reads `preload.cjs` from `.vite/build`, has landed.
export const RELOADED_LOAD = 2;
// How long a dev start keeps the lock after its app first reports a page load,
// waiting for a startup reload: the dev server reloads the page when a build
// lands after the page has connected, which no code guarantees.
export const STARTUP_RELOAD_WAIT_MS = 10_000;

// Whether a dev start may release its start lock, given the page load its app
// last reported and the time since it first reported one: once that load is
// past the startup reload, or once `STARTUP_RELOAD_WAIT_MS` has passed without
// one.
export function mayReleaseStartLock(
  load: number,
  msSinceFirstLoad: number,
): boolean {
  return load >= RELOADED_LOAD || msSinceFirstLoad >= STARTUP_RELOAD_WAIT_MS;
}

// The page load a self-test line says starts its run, or null for any other
// line; main prints `[selftest] page load <n> starts its run`.
export function selfTestLoadOf(line: string): number | null {
  const match = /\[selftest\] page load (\d+) starts its run/.exec(line);
  return match === null ? null : Number(match[1]);
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
