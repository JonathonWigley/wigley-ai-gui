import { execFileSync } from 'node:child_process';
import { readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import type {
  ForgeConfig,
  ResolvedForgeConfig,
} from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { writeLoginItemPlist } from './scripts/login-item-plist.mts';
import { AD_HOC_IDENTITY, macSigningIdentity } from './scripts/mac-signing.mts';
import { copyNodePty } from './scripts/node-pty-files.mts';
import {
  copyDeclarationInputs,
  nodeDeclarationFiles,
} from './scripts/plugin-type-inputs.mts';

// `tsconfig.plugin-types.json`'s `outDir`.
const PLUGIN_TYPES_FOLDER = '.plugin-types';

const config: ForgeConfig = {
  packagerConfig: {
    // node-pty's `pty.node`, `spawn-helper` and Windows conpty files must be real
    // files; node-pty rewrites its helper's `app.asar` path to `app.asar.unpacked`.
    asar: { unpack: '**/node_modules/node-pty/**' },
    win32metadata: { ProductName: 'Auri', FileDescription: 'Auri' },
    // Packager adds `.ico` on Windows and `.icns` on macOS.
    icon: 'assets/icon/icon',
    // Without this key macOS refuses Apple Events from the app's sessions with -1743 and never prompts.
    extendInfo: {
      NSAppleEventsUsageDescription:
        "Agent sessions in Auri run tools that control other apps, such as reading and pressing a Unity editor's dialogs through System Events.",
    },
    // The plugin contract types `generateAssets` emits, copied under the same
    // name to `<Resources>/.plugin-types` outside the asar for the app to write
    // to the user's `plugins/_types/` at start. `agent-plugin` too: Claude Code
    // reads the plugin from disk through `--plugin-dir`, and Python cannot run
    // scripts inside the asar.
    extraResource: [PLUGIN_TYPES_FOLDER, 'agent-plugin'],
  },
  rebuildConfig: {},
  hooks: {
    // Emits the plugin contract types for `start`, `package` and `make`. They
    // go outside `.vite`, which the Vite plugin's own `preStart` and
    // `prePackage` hooks delete after this hook runs. A failed emit, or an
    // emitted import with no declaration, stops start and packaging rather
    // than ship stale or missing types.
    generateAssets: async () => {
      emitPluginTypes();
    },
    // The Vite plugin ships only `.vite`, and the session host's bundle keeps
    // node-pty external, so node-pty is copied in by hand. Forge's rebuild step
    // runs next and rebuilds only a module holding `binding.gyp`, which the copy
    // leaves out.
    packageAfterCopy: async (
      _forgeConfig,
      buildPath,
      _electronVersion,
      platform,
      arch,
    ) => {
      copyNodePty(
        path.join(import.meta.dirname, 'node_modules', 'node-pty'),
        buildPath,
        platform,
        arch,
      );
    },
    // @electron/packager sets CFBundleName and CFBundleDisplayName from the app name after applying
    // `extendInfo`, so the shown name is written into the packaged Info.plist here instead.
    postPackage: async (forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin') {
        return;
      }
      for (const outputPath of outputPaths) {
        showMacBundleAs('Auri', appBundleIn(outputPath), forgeConfig);
      }
    },
  },
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          entry: 'src/session-host/session-host.ts',
          config: 'vite.session-host.config.mts',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

function emitPluginTypes(): void {
  const repoDir = import.meta.dirname;
  const isWindows = process.platform === 'win32';
  const tsc = path.join(
    repoDir,
    'node_modules',
    '.bin',
    isWindows ? 'tsc.cmd' : 'tsc',
  );
  try {
    // Node refuses to spawn a `.cmd` file without a shell, and the shell
    // splits an unquoted path at a space.
    execFileSync(
      isWindows ? `"${tsc}"` : tsc,
      ['-p', 'tsconfig.plugin-types.json'],
      { cwd: repoDir, shell: isWindows, encoding: 'utf8' },
    );
  } catch (error) {
    const output = (error as { stdout?: string }).stdout ?? '';
    throw new Error(`Emitting the plugin types failed:\n${output}`, {
      cause: error,
    });
  }
  copyDeclarationInputs(
    path.join(repoDir, 'src'),
    path.join(repoDir, PLUGIN_TYPES_FOLDER),
    nodeDeclarationFiles,
  );
}

function appBundleIn(outputPath: string): string {
  const bundles = readdirSync(outputPath).filter((entry) =>
    entry.endsWith('.app'),
  );
  if (bundles.length !== 1) {
    throw new Error(
      `Expected one .app in ${outputPath}, found ${bundles.length}`,
    );
  }
  return path.join(outputPath, bundles[0]);
}

function showMacBundleAs(
  displayName: string,
  appPath: string,
  forgeConfig: ResolvedForgeConfig,
): void {
  if (forgeConfig.packagerConfig.osxSign) {
    throw new Error(
      'postPackage edits Info.plist after osxSign has signed the app; move the edit before signing',
    );
  }
  // The menu bar shows CFBundleName. Electron finds its helpers as `<CFBundleName> Helper*.app` and
  // exits at launch when none has that name, so each helper takes the shown name too. The app
  // bundle and its executable keep the packaged name.
  const packagedName = path.basename(appPath, '.app');
  const frameworks = path.join(appPath, 'Contents', 'Frameworks');
  for (const entry of readdirSync(frameworks)) {
    if (
      !entry.startsWith(`${packagedName} Helper`) ||
      !entry.endsWith('.app')
    ) {
      continue;
    }
    const helperName = path.basename(entry, '.app');
    const shownHelperName = displayName + helperName.slice(packagedName.length);
    const helperPath = path.join(frameworks, entry);
    const macOsDir = path.join(helperPath, 'Contents', 'MacOS');
    renameSync(
      path.join(macOsDir, helperName),
      path.join(macOsDir, shownHelperName),
    );
    setPlistStrings(path.join(helperPath, 'Contents', 'Info.plist'), {
      CFBundleExecutable: shownHelperName,
      CFBundleName: shownHelperName,
      CFBundleDisplayName: shownHelperName,
    });
    renameSync(helperPath, path.join(frameworks, `${shownHelperName}.app`));
  }
  setPlistStrings(path.join(appPath, 'Contents', 'Info.plist'), {
    CFBundleName: displayName,
    CFBundleDisplayName: displayName,
  });
  writeLoginItemPlist(appPath, packagedName);
  const signingIdentity = macSigningIdentity();
  if (signingIdentity === AD_HOC_IDENTITY) {
    console.warn(
      'Signing ad hoc, so this build loses macOS privacy grants; `npm run create-signing-identity` keeps them.',
    );
  }
  // Info.plist is sealed into the bundle's signature, and Apple Silicon launches only validly signed apps.
  execFileSync('codesign', [
    '--sign',
    signingIdentity,
    '--force',
    '--deep',
    '--preserve-metadata=entitlements,requirements,flags,runtime',
    appPath,
  ]);
}

function setPlistStrings(
  infoPlist: string,
  values: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(values)) {
    execFileSync('plutil', ['-replace', key, '-string', value, infoPlist]);
  }
}

export default config;
