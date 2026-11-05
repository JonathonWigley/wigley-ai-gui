import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Platform } from '../../contracts/platform';

// macOS's `sun_path` holds 104 bytes, the NUL included.
const MAX_SOCKET_PATH_BYTES = 103;

// Where the app instance `instanceId` listens on the channel `suffix` names (''
// for the relay's): a named pipe per instance, user and home on Windows;
// elsewhere a Unix socket in the instance's agents folder, or, when that
// folder's path is too long for one, a socket named per instance, user and home
// in `tempDir` (per user on macOS), or in a folder of `/tmp` only the user can
// enter when `tempDir` is too long as well. Creates that `/tmp` folder, and
// throws when it exists but another user owns it or others can enter it.
export function channelPath(
  platform: Platform,
  home: string,
  username: string,
  instanceId: string,
  suffix: string,
  tempDir: string = os.tmpdir(),
): string {
  const perHome = `${instanceId}-${username}-${homeHash(home)}${suffix}`;
  if (platform === 'windows') {
    return `\\\\.\\pipe\\${perHome}`;
  }
  const socket = path.posix.join(
    home,
    '.agents',
    instanceId,
    `app${suffix}.sock`,
  );
  if (fitsSocketPath(socket)) {
    return socket;
  }
  const tempSocket = path.posix.join(tempDir, `${perHome}.sock`);
  if (fitsSocketPath(tempSocket)) {
    return tempSocket;
  }
  const privateDir = `/tmp/${instanceId}-${username}`;
  makePrivateFolder(privateDir);
  return path.posix.join(privateDir, `${homeHash(home)}${suffix}.sock`);
}

function fitsSocketPath(socket: string): boolean {
  return Buffer.byteLength(socket) <= MAX_SOCKET_PATH_BYTES;
}

// Makes `dir` open to its owner alone, or checks one already there is the
// current user's and closed to others, so no other user can plant or reach
// the socket inside it.
function makePrivateFolder(dir: string) {
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
  const stat = lstatSync(dir);
  const isPrivate =
    stat.isDirectory() &&
    stat.uid === process.getuid?.() &&
    (stat.mode & 0o077) === 0;
  if (!isPrivate) {
    throw new Error(
      `${dir} must be a folder the current user owns and no one else can enter`,
    );
  }
}

// The first 8 hex digits of the home's SHA-256.
function homeHash(home: string): string {
  return createHash('sha256').update(home).digest('hex').slice(0, 8);
}
