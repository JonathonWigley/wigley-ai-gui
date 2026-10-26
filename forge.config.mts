import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
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
    // @electron/packager sets CFBundleDisplayName from the app name after applying `extendInfo`, so
    // the shown name is written into the packaged Info.plist here instead.
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
      [FuseV1Options.RunAsNode]: false,
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
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
  // CFBundleName stays the packaged name: Electron finds `<CFBundleName> Helper.app` by it, and
  // exits at launch when no helper has that name.
  execFileSync('plutil', [
    '-replace',
    'CFBundleDisplayName',
    '-string',
    displayName,
    infoPlist,
  ]);
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

export default config;
