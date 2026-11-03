// The decisions `npm run install-app` makes from its inputs alone: the ref its
// arguments name, where it builds, what it installs from the build and where on
// each OS, whether the build worktree needs `npm ci`, what each OS's process
// list says, which processes are the stable app and which of them the run quits,
// and what cleaning the Windows install root deletes.
// `scripts/install-app.mts` runs the steps.
import path from 'node:path';

export interface InstallPaths {
  buildDir: string;
  packagedDir: string;
  // What gets copied to installDir: packagedDir itself on Windows, the bundle
  // inside it on macOS.
  packagedApp: string;
  // The folder holding every installed version on Windows; null on macOS, which
  // installs one bundle in place.
  installRoot: string | null;
  installDir: string;
  // Where the app is copied before it moves to installDir.
  stagingDir: string;
  binary: string;
  shortcut: string | null;
}

export interface StableProcess {
  pid: number;
  executable: string;
}

export interface ListedProcess extends StableProcess {
  commandLine: string;
}

const DEFAULT_REF = 'main';

const USAGE = 'usage: npm run install-app -- [--ref <ref>]';

const SHORT_SHA_LENGTH = 12;

const APP_FOLDER_PREFIX = 'app-';

const WINDOWS_EXE_NAME = 'wigley-ai-gui.exe';

const SESSION_HOST_SCRIPT = 'session-host.js';

// The ref `argv` (the arguments after `npm run install-app --`) names, `main`
// when none. Throws the usage line naming the wrong argument: `--ref` with no
// value, `--ref=<x>`, or any other argument.
export function parseInstallArgs(argv: readonly string[]): { ref: string } {
  let ref = DEFAULT_REF;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument !== '--ref') {
      throw new Error(`install-app does not take ${argument}; ${USAGE}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`--ref takes a value; ${USAGE}`);
    }
    ref = value;
    index++;
  }
  return { ref };
}

// Where the build worktree, its packaged output and the app in it, the
// installed app, its staged copy, its binary and its Start menu shortcut sit. On
// Windows each `commit` installs into its own `app-<short sha>` folder; macOS
// ignores `commit`. Built with the target platform's path module, so the result
// is the same whichever OS computes it. Throws on a platform other than Windows
// or macOS, and on Windows without LOCALAPPDATA and APPDATA.
export function installPaths(
  platform: NodeJS.Platform,
  arch: string,
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  commit: string,
): InstallPaths {
  const isWindows = platform === 'win32';
  if (!isWindows && platform !== 'darwin') {
    throw new Error(`install-app supports Windows and macOS, not ${platform}`);
  }
  const paths = isWindows ? path.win32 : path.posix;
  const buildDir = paths.join(paths.dirname(repoRoot), '.wigley-ai-gui-build');
  const packagedDir = paths.join(
    buildDir,
    'out',
    `wigley-ai-gui-${platform}-${arch}`,
  );
  if (!isWindows) {
    const installDir = '/Applications/wigley-ai-gui.app';
    return {
      buildDir,
      packagedDir,
      packagedApp: paths.join(packagedDir, 'wigley-ai-gui.app'),
      installRoot: null,
      installDir,
      stagingDir: `${installDir}.new`,
      binary: paths.join(installDir, 'Contents', 'MacOS', 'wigley-ai-gui'),
      shortcut: null,
    };
  }
  const localAppData = env.LOCALAPPDATA;
  const appData = env.APPDATA;
  // An empty value would build a relative path.
  if (!localAppData || !appData) {
    throw new Error('install-app needs LOCALAPPDATA and APPDATA set');
  }
  const installRoot = paths.join(localAppData, 'Programs', 'wigley-ai-gui');
  const installDir = paths.join(
    installRoot,
    `${APP_FOLDER_PREFIX}${commit.slice(0, SHORT_SHA_LENGTH)}`,
  );
  return {
    buildDir,
    packagedDir,
    packagedApp: packagedDir,
    installRoot,
    installDir,
    // Named outside `app-*`: the relay starts the newest `app-*` folder.
    stagingDir: paths.join(installRoot, 'staging'),
    binary: paths.join(installDir, WINDOWS_EXE_NAME),
    shortcut: paths.join(
      appData,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Auri.lnk',
    ),
  };
}

// Whether the build worktree's `node_modules` needs `npm ci`: the lockfile's
// hash differs from the one stored after the last `npm ci`, or none is stored.
export function isInstallDue(
  lockHash: string,
  storedHash: string | null,
): boolean {
  return lockHash !== storedHash;
}

// Sorts the names in the Windows install root: the `app-*` folders other than
// `current`, and every name outside `app-*`.
export function installRootCleanup(
  entries: readonly string[],
  current: string,
): { olderAppFolders: string[]; leftovers: string[] } {
  const appFolders = entries.filter((entry) =>
    entry.startsWith(APP_FOLDER_PREFIX),
  );
  return {
    olderAppFolders: appFolders.filter((entry) => entry !== current).sort(),
    leftovers: entries
      .filter((entry) => !entry.startsWith(APP_FOLDER_PREFIX))
      .sort(),
  };
}

// Whether a process is the stable app, which install-app quits. A session host
// runs the same binary and outlives the app, so it never counts. On Windows an
// app of any installed version counts; a packaged drive run elsewhere does not.
export function isStableAppProcess(
  platform: NodeJS.Platform,
  paths: InstallPaths,
  executable: string,
  commandLine: string,
): boolean {
  if (commandLine.includes(SESSION_HOST_SCRIPT)) {
    return false;
  }
  if (platform !== 'win32' || paths.installRoot === null) {
    return executable === paths.binary;
  }
  // Windows paths compare without case.
  const installRoot = paths.installRoot.toLowerCase();
  const { dir: folder, base: fileName } = path.win32.parse(
    executable.toLowerCase(),
  );
  const isFlatInstall = folder === installRoot;
  const isVersionFolder =
    path.win32.dirname(folder) === installRoot &&
    path.win32.basename(folder).startsWith(APP_FOLDER_PREFIX);
  return fileName === WINDOWS_EXE_NAME && (isFlatInstall || isVersionFolder);
}

// The stable app's `running` processes this install ends. On Windows an app
// already running from installDir is the build this run installs, so it keeps
// running; macOS replaces the bundle, so every match goes.
export function processesToQuit(
  platform: NodeJS.Platform,
  paths: InstallPaths,
  running: readonly StableProcess[],
): StableProcess[] {
  if (platform !== 'win32') {
    return [...running];
  }
  const installDir = paths.installDir.toLowerCase();
  return running.filter(
    ({ executable }) =>
      path.win32.dirname(executable).toLowerCase() !== installDir,
  );
}

// The processes in the listing PowerShell prints: one line each of pid,
// ExecutablePath and CommandLine joined by tabs. A process whose path Windows
// hides has no ExecutablePath, and is left out.
export function parseWindowsProcessList(output: string): ListedProcess[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const [pid, executable, ...commandLine] = line.split('\t');
    return executable
      ? [
          {
            pid: Number(pid),
            executable,
            commandLine: commandLine.join('\t'),
          },
        ]
      : [];
  });
}

// The processes in `ps -o pid=,args=` output. The executable is the first token
// of the command line, as the installed binary's path holds no space.
export function parseMacProcessList(output: string): ListedProcess[] {
  return output.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match === null
      ? []
      : [
          {
            pid: Number(match[1]),
            executable: match[2].split(' ')[0],
            commandLine: match[2],
          },
        ];
  });
}
