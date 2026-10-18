import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '../../contracts/forms';
import type { RelayEndpoint } from '../../contracts/relay';

// Where the app listens for relays: a per-user named pipe on Windows, a Unix
// socket in the agents folder elsewhere.
export function channelPath(
  platform: NodeJS.Platform,
  home: string,
  username: string,
): string {
  if (platform === 'win32') {
    return `\\\\.\\pipe\\wigley-ai-gui-${username}`;
  }
  return path.posix.join(home, '.agents', 'wigley-ai-gui', 'app.sock');
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
