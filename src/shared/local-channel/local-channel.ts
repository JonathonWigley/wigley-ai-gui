import {
  closeSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { connect, createServer, type Socket } from 'node:net';
import { uptime } from 'node:os';
import path from 'node:path';

const PIPE_PREFIX = '\\\\.\\pipe\\';

// `connected` adds the socket's `error` listener; this module adds none.
export interface ChannelHandlers {
  connected(socket: Socket): void;
  failed(error: Error): void;
}

export interface ChannelServer {
  // True once listening; false when listen failed (after `failed`) or `close`
  // came first. Never rejects.
  listening: Promise<boolean>;
  // Destroys every open socket, closes the server, then releases the channel's
  // lock.
  close(): Promise<void>;
}

// Rejects with the connect error.
export function connectToChannel(channel: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(channel);
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.off('error', reject);
      resolve(socket);
    });
  });
}

// Whether a `connectToChannel` rejection proves no listener. Any other code, such as EACCES or EAGAIN, leaves one
// possible, so its socket file or record must stay.
export function connectFoundNoListener(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'ECONNREFUSED' || code === 'ENOENT';
}

function isSocketFile(channel: string): boolean {
  const file = lstatSync(channel, { throwIfNoEntry: false });
  return file?.isSocket() ?? false;
}

async function channelMayHaveListener(channel: string): Promise<boolean> {
  try {
    const socket = await connectToChannel(channel);
    socket.destroy();
    return true;
  } catch (error) {
    return !connectFoundNoListener(error);
  }
}

function channelInUse(channel: string): Error {
  return Object.assign(new Error(`channel ${channel} is in use`), {
    code: 'EADDRINUSE',
  });
}

// The lock file as read through one descriptor, so its inode, time and text
// are of the same file.
export interface LockFile {
  ino: number;
  mtimeMs: number;
  text: string;
}

function readLock(lock: string): LockFile | null {
  let descriptor: number;
  try {
    descriptor = openSync(lock, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  try {
    const { ino, mtimeMs } = fstatSync(descriptor);
    return { ino, mtimeMs, text: readFileSync(descriptor, 'utf8') };
  } finally {
    closeSync(descriptor);
  }
}

// The locks this process's servers hold.
const heldLocks = new Set<string>();
let releasesHeldLocksAtExit = false;

// `os.uptime` counts from the kernel's boot time, sleep included.
function bootTimeMs(): number {
  return Date.now() - uptime() * 1000;
}

// `kill(pid, 0)` sends no signal; EPERM means the pid runs as another user.
function pidRuns(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

// A pid in a lock from an earlier boot may name another process by now.
function lockIsHeld(lock: string, held: LockFile): boolean {
  const pid = Number(held.text);
  const namesAPid = Number.isInteger(pid) && pid > 0;
  const writtenThisBoot = held.mtimeMs >= bootTimeMs();
  if (!namesAPid || !writtenThisBoot) {
    return false;
  }
  return pid === process.pid ? heldLocks.has(lock) : pidRuns(pid);
}

// An `exit` listener runs on `process.exit` and on a natural exit, never on a
// signal's default action.
function markLockHeld(lock: string) {
  heldLocks.add(lock);
  if (!releasesHeldLocksAtExit) {
    releasesHeldLocksAtExit = true;
    process.on('exit', () => {
      for (const held of heldLocks) {
        releaseChannelLock(held);
      }
    });
  }
}

// False when a lock is already there.
function createLock(lock: string): boolean {
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

let movedLockCount = 0;

// Moves the stale lock `held` out of the way. Two takers can judge one lock
// stale together, and a delete by the slower would remove the lock the faster
// has just created: a rename hands the file at the path to one taker alone,
// whose read of it shows whether it is still `held`.
function takeOverStaleLock(lock: string, held: LockFile): boolean {
  movedLockCount += 1;
  const moved = `${lock}.${process.pid}-${movedLockCount}`;
  try {
    renameSync(lock, moved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  return settleMovedLock(lock, moved, held);
}

// The take-over's step after its rename of `lock` to `moved`: true when the
// moved lock is `held`. A newer lock moved by mistake is linked back, unless a
// lock is at the path again by then. Removes `moved` either way.
export function settleMovedLock(
  lock: string,
  moved: string,
  held: LockFile,
): boolean {
  const movedLock = readLock(moved);
  const movedTheStaleLock =
    movedLock?.ino === held.ino && movedLock.text === held.text;
  if (!movedTheStaleLock) {
    try {
      linkSync(moved, lock);
    } catch {
      // A lock is at the path again, and it stays the one there.
    }
  }
  rmSync(moved, { force: true });
  return movedTheStaleLock;
}

// Takes `lock` for this process, or throws the error `channelInUse` makes while
// the lock is held: written this boot by a pid that runs, or by this process
// for a server of its own that has not closed.
function takeChannelLock(channel: string, lock: string) {
  if (!createLock(lock)) {
    const held = readLock(lock);
    const isFree =
      held === null ||
      (!lockIsHeld(lock, held) && takeOverStaleLock(lock, held));
    if (!isFree || !createLock(lock)) {
      throw channelInUse(channel);
    }
  }
  markLockHeld(lock);
}

// Leaves a lock another process has taken since.
function releaseChannelLock(lock: string) {
  heldLocks.delete(lock);
  if (readLock(lock)?.text === String(process.pid)) {
    rmSync(lock, { force: true });
  }
}

// Listens on `channel`. On a socket path it makes the folder, takes
// `<channel>.lock` for the server's life or until the process exits, and
// removes a stale socket file first. A held lock, or a socket file that may
// have a live listener, fails with `EADDRINUSE`, as `listen` on a pipe in use
// does.
export function listenOnChannel(
  channel: string,
  handlers: ChannelHandlers,
): ChannelServer {
  const lock = `${channel}.lock`;
  let holdsLock = false;
  const releaseLock = () => {
    if (holdsLock) {
      holdsLock = false;
      releaseChannelLock(lock);
    }
  };
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    handlers.connected(socket);
  });
  const listening = new Promise<boolean>((resolve) => {
    server.on('listening', () => resolve(true));
    server.on('error', (error) => {
      handlers.failed(error);
      resolve(false);
    });
    server.once('close', () => resolve(false));
  });
  void listening.then((isListening) => {
    if (!isListening) {
      releaseLock();
    }
  });
  let closing = false;

  // Runs synchronously up to its first await: with no socket file at the path,
  // `listen` is called before `listenOnChannel` returns.
  const listenOnceFree = async () => {
    try {
      if (!channel.startsWith(PIPE_PREFIX)) {
        mkdirSync(path.dirname(channel), { recursive: true });
        takeChannelLock(channel, lock);
        holdsLock = true;
        // Only a socket file can have a listener.
        const isLive =
          isSocketFile(channel) && (await channelMayHaveListener(channel));
        if (closing) {
          return;
        }
        if (isLive) {
          throw channelInUse(channel);
        }
        // A crashed run leaves its socket file behind, and listen fails on it.
        rmSync(channel, { force: true });
      }
      server.listen(channel);
    } catch (error) {
      // Deferred so `failed` never runs before `listenOnChannel` has returned.
      process.nextTick(() => server.emit('error', error));
    }
  };
  void listenOnceFree();

  return {
    listening,
    close: () =>
      new Promise((resolve) => {
        closing = true;
        for (const socket of sockets) {
          socket.destroy();
        }
        // By its callback, `close` has unlinked a listening socket's file.
        server.close(() => {
          releaseLock();
          resolve();
        });
      }),
  };
}
