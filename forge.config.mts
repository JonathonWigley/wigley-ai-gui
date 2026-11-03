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

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    win32metadata: { ProductName: 'Auri', FileDescription: 'Auri' },
    // Packager adds `.ico` on Windows and `.icns` on macOS.
    icon: 'assets/icon/icon',
  },
  rebuildConfig: {},
  hooks: {
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
  // Info.plist is sealed into the bundle's signature, and Apple Silicon launches only validly signed apps.
  execFileSync('codesign', [
    '--sign',
    '-',
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
