// The decisions `npm run install-app` makes from its inputs alone: the ref its
// arguments name, where it builds, what it installs from the build and where on
// each OS, and whether the build worktree needs `npm ci`. `scripts/install-app.mts` runs the steps.
import path from 'node:path';

export interface InstallPaths {
  buildDir: string;
  packagedDir: string;
  // What gets copied to installDir: packagedDir itself on Windows, the bundle
  // inside it on macOS.
  packagedApp: string;
  installDir: string;
  binary: string;
  shortcut: string | null;
}

const DEFAULT_REF = 'main';

const USAGE = 'usage: npm run install-app -- [--ref <ref>]';

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
// installed app, its binary and its Start menu shortcut sit. Built with the target platform's path module, so
// the result is the same whichever OS computes it. Throws on a platform other
// than Windows or macOS, and on Windows without LOCALAPPDATA and APPDATA.
export function installPaths(
  platform: NodeJS.Platform,
  arch: string,
  repoRoot: string,
  env: NodeJS.ProcessEnv,
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
      installDir,
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
  const installDir = paths.join(localAppData, 'Programs', 'wigley-ai-gui');
  return {
    buildDir,
    packagedDir,
    packagedApp: packagedDir,
    installDir,
    binary: paths.join(installDir, 'wigley-ai-gui.exe'),
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
