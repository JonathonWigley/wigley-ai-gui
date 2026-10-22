import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RelayEndpoint, ToolDefinition } from '../../contract';

// macOS's `sun_path` holds 104 bytes, the NUL included.
const MAX_SOCKET_PATH_BYTES = 103;

// Where the app listens for relays: a named pipe per user and home on
// Windows; elsewhere a Unix socket in the agents folder, or, when the agents
// folder's path is too long for one, a socket named per user and home in
// `tempDir` (per user on macOS), or in a folder of `/tmp` only the user can
// enter when `tempDir` is too long as well. Creates that `/tmp` folder, and
// throws when it exists but another user owns it or others can enter it.
export function channelPath(
  platform: NodeJS.Platform,
  home: string,
  username: string,
  tempDir: string = os.tmpdir(),
): string {
  const perHome = `wigley-ai-gui-${username}-${homeHash(home)}`;
  if (platform === 'win32') {
    return `\\\\.\\pipe\\${perHome}`;
  }
  const socket = path.posix.join(home, '.agents', 'wigley-ai-gui', 'app.sock');
  if (fitsSocketPath(socket)) {
    return socket;
  }
  const tempSocket = path.posix.join(tempDir, `${perHome}.sock`);
  if (fitsSocketPath(tempSocket)) {
    return tempSocket;
  }
  const privateDir = `/tmp/wigley-ai-gui-${username}`;
  makePrivateFolder(privateDir);
  return path.posix.join(privateDir, `${homeHash(home)}.sock`);
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

// How a relay starts the app: `npm start` from the repo when npm started this
// run, else the running executable.
export function launchCommand(
  env: NodeJS.ProcessEnv,
  execPath: string,
  cwd: string,
): RelayEndpoint['launch'] {
  const { npm_node_execpath: node, npm_execpath: npm } = env;
  if (node && npm) {
    return { command: [node, npm, 'start'], cwd: env.INIT_CWD ?? cwd };
  }
  return { command: [execPath], cwd };
}

// How a relay that finds a drive run gone "starts" it: a shell that exits 1
// with the run named in the command's text, which the relay reports, so the
// relay never starts the user's own app in the run's place. Runs in the run
// folder's root, which outlives the run folder.
export function endedDriveRunLaunch(
  platform: NodeJS.Platform,
  runDir: string,
): RelayEndpoint['launch'] {
  const ended = `The drive run ${runDir} has ended`;
  if (platform === 'win32') {
    // cmd reads everything after `rem` as a comment, `&` included.
    return {
      command: ['cmd.exe', '/d', '/c', `exit 1 & rem ${ended}`],
      cwd: path.win32.parse(runDir).root,
    };
  }
  return {
    command: ['/bin/sh', '-c', 'echo "$0" >&2; exit 1', ended],
    cwd: path.posix.parse(runDir).root,
  };
}

// Through a temp file and a rename, so a relay never reads half a file.
function writeJsonWhole(file: string, value: unknown) {
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}

// `endpoint.json` tells relays where the app is and how to start it;
// `tools.json` is the tool list a relay serves while the app is away.
export function writeEndpointFiles(
  dir: string,
  endpoint: RelayEndpoint,
  tools: ToolDefinition[],
) {
  mkdirSync(dir, { recursive: true });
  writeJsonWhole(path.join(dir, 'endpoint.json'), endpoint);
  writeJsonWhole(path.join(dir, 'tools.json'), { tools });
}
