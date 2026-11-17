import type {
  OsName,
  Platform,
  PlatformKeys,
  PlatformLifecycle,
  PlatformPrograms,
  PlatformRelay,
} from '../contracts/platform';

export interface PlatformInputs {
  username: string;
  pid: number;
  env: NodeJS.ProcessEnv;
  execPath: string;
  cwd: string;
  isDev: boolean;
}

const DEFAULT_PROGRAMS: PlatformPrograms = { claude: '~/.local/bin/claude' };

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
  inputs: PlatformInputs,
): Platform {
  return {
    os,
    lifecycle,
    keys,
    programs: DEFAULT_PROGRAMS,
    relay: {
      username: inputs.username,
      pid: inputs.pid,
      launch: launchCommand(
        inputs.env,
        inputs.execPath,
        inputs.cwd,
        inputs.isDev,
      ),
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
