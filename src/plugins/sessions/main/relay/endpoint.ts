import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RelayEndpoint, ToolDefinition } from '../../contract';

// macOS's `sun_path` holds 104 bytes, the NUL included.
const MAX_SOCKET_PATH_BYTES = 103;

// Where the app listens for relays: a named pipe per user and home on
// Windows; elsewhere a Unix socket in the agents folder, or a socket in `/tmp`
// named per user and home when the agents folder's path is too long for one.
export function channelPath(
  platform: NodeJS.Platform,
  home: string,
  username: string,
): string {
  const perHome = `wigley-ai-gui-${username}-${homeHash(home)}`;
  if (platform === 'win32') {
    return `\\\\.\\pipe\\${perHome}`;
  }
  const socket = path.posix.join(home, '.agents', 'wigley-ai-gui', 'app.sock');
  if (Buffer.byteLength(socket) <= MAX_SOCKET_PATH_BYTES) {
    return socket;
  }
  return `/tmp/${perHome}.sock`;
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
