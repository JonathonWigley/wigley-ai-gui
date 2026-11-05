import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Platform } from '../../../../contracts/platform';
import type { RelayEndpoint, ToolDefinition } from '../../contract';

// How a relay starts the app: `npm start` from the repo when this is the dev
// app and npm started this run, else the running executable, so a stable app
// started from under `npm run` still records its own executable.
export function launchCommand(
  env: NodeJS.ProcessEnv,
  execPath: string,
  cwd: string,
  isDev: boolean,
): RelayEndpoint['launch'] {
  const { npm_node_execpath: node, npm_execpath: npm } = env;
  if (isDev && node && npm) {
    return { command: [node, npm, 'start'], cwd: env.INIT_CWD ?? cwd };
  }
  return { command: [execPath], cwd };
}

// How a relay that finds a drive run gone "starts" it: a shell that exits 1
// with the run's home named in the command's text, which the relay reports,
// so the relay never starts the user's own app in the run's place. Runs in
// the home's filesystem root, which outlives the run.
export function endedDriveRunLaunch(
  platform: Platform,
  homeDir: string,
): RelayEndpoint['launch'] {
  const ended = `The drive run whose home is ${homeDir} has ended`;
  if (platform === 'windows') {
    // cmd reads everything after `rem` as a comment, `&` included.
    return {
      command: ['cmd.exe', '/d', '/c', `exit 1 & rem ${ended}`],
      cwd: path.win32.parse(homeDir).root,
    };
  }
  return {
    command: ['/bin/sh', '-c', 'echo "$0" >&2; exit 1', ended],
    cwd: path.posix.parse(homeDir).root,
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
