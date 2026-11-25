import type {
  OsName,
  Platform,
  PlatformKeys,
  PlatformLifecycle,
  PlatformPrograms,
  PlatformRelay,
} from '../contracts/platform';
import { AGENT_SERVER_NAME } from './agent-plugin';

export interface PlatformInputs {
  username: string;
  pid: number;
  env: NodeJS.ProcessEnv;
  execPath: string;
  cwd: string;
  isDev: boolean;
}

// Windows names `claude.exe` with its extension, so the lookup never picks an npm `claude.cmd` shim.
const WINDOWS_PROGRAMS: PlatformPrograms = {
  python: [
    { command: 'py', args: ['-3'] },
    { command: 'python', args: [] },
    { command: 'python3', args: [] },
  ],
  claude: [
    { command: 'claude.exe', args: [] },
    { command: '~/.local/bin/claude.exe', args: [] },
  ],
  unity: [
    { command: 'unity', args: [] },
    { command: '~/.unity/bin/unity', args: [] },
  ],
  shell: [
    { command: 'pwsh', args: ['-NoLogo'] },
    { command: 'powershell.exe', args: ['-NoLogo'] },
  ],
};

const ZSH_LOGIN = { command: '/bin/zsh', args: ['-l'] };

// `$SHELL` as a login shell, then `/bin/zsh`, which still finds a shell when
// `$SHELL` names a path that no longer exists.
function posixPrograms(env: NodeJS.ProcessEnv): PlatformPrograms {
  const userShell = env.SHELL;
  const hasOtherShell =
    userShell !== undefined &&
    userShell !== '' &&
    userShell !== ZSH_LOGIN.command;
  return {
    python: [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ],
    claude: [
      { command: 'claude', args: [] },
      { command: '~/.local/bin/claude', args: [] },
    ],
    unity: [
      { command: 'unity', args: [] },
      { command: '~/.unity/bin/unity', args: [] },
    ],
    shell: hasOtherShell
      ? [{ command: userShell, args: ['-l'] }, ZSH_LOGIN]
      : [ZSH_LOGIN],
  };
}

// The server key of the `auri` plugin's manifests, which the app's MCP server
// also gives as its name.
export const RELAY_SERVER_NAME = AGENT_SERVER_NAME;

// How a relay starts the app: `npm start` from the repo when this is the dev
// app and npm started this run, else the running executable, so a stable app
// started from under `npm run` still records its own executable.
export function launchCommand(
  env: NodeJS.ProcessEnv,
  execPath: string,
  cwd: string,
  isDev: boolean,
): PlatformRelay['launch'] {
  const { npm_node_execpath: node, npm_execpath: npm } = env;
  if (isDev && node && npm) {
    return { command: [node, npm, 'start'], cwd: env.INIT_CWD ?? cwd };
  }
  return { command: [execPath], cwd };
}

function platformRecord(
  os: OsName,
  lifecycle: PlatformLifecycle,
  keys: PlatformKeys,
  programs: PlatformPrograms,
  inputs: PlatformInputs,
): Platform {
  return {
    os,
    lifecycle,
    keys,
    programs,
    relay: {
      username: inputs.username,
      pid: inputs.pid,
      launch: launchCommand(
        inputs.env,
        inputs.execPath,
        inputs.cwd,
        inputs.isDev,
      ),
      serverName: RELAY_SERVER_NAME,
    },
  };
}

export function createMacPlatform(inputs: PlatformInputs): Platform {
  return platformRecord(
    'macos',
    {
      closeHidesWindow: true,
      toastsNeedAppUserModelId: false,
      hidesFromDockBesideApp: true,
    },
    { optionMatchesByCode: true, altGraphTypes: false },
    posixPrograms(inputs.env),
    inputs,
  );
}

export function createWindowsPlatform(inputs: PlatformInputs): Platform {
  return platformRecord(
    'windows',
    {
      closeHidesWindow: false,
      toastsNeedAppUserModelId: true,
      hidesFromDockBesideApp: false,
    },
    { optionMatchesByCode: false, altGraphTypes: true },
    WINDOWS_PROGRAMS,
    inputs,
  );
}

export function createLinuxPlatform(inputs: PlatformInputs): Platform {
  return platformRecord(
    'linux',
    {
      closeHidesWindow: false,
      toastsNeedAppUserModelId: false,
      hidesFromDockBesideApp: false,
    },
    { optionMatchesByCode: false, altGraphTypes: true },
    posixPrograms(inputs.env),
    inputs,
  );
}

export function platformFor(os: OsName, inputs: PlatformInputs): Platform {
  if (os === 'macos') {
    return createMacPlatform(inputs);
  }
  return os === 'windows'
    ? createWindowsPlatform(inputs)
    : createLinuxPlatform(inputs);
}
