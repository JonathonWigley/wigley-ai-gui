import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyNodePty,
  darwinPrebuildFolders,
  makeSpawnHelperExecutable,
  nativeBuildFolder,
} from './node-pty-files.mts';

const PREBUILD = path.join('prebuilds', 'darwin-arm64');
const BUILD_RELEASE = path.join('build', 'Release');

const folders: string[] = [];

function newFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'node-pty-files-'));
  folders.push(folder);
  return folder;
}

// A node-pty install under a temp folder holding `package.json`, `lib/` and
// each of `nativeFolders`, each with a `spawn-helper` that is not executable.
function fakeNodePty(nativeFolders: readonly string[]): string {
  const nodePtyDir = newFolder();
  writeFileSync(path.join(nodePtyDir, 'package.json'), '{}');
  mkdirSync(path.join(nodePtyDir, 'lib'));
  writeFileSync(path.join(nodePtyDir, 'lib', 'index.js'), '');
  for (const folder of nativeFolders) {
    const helper = path.join(nodePtyDir, folder, 'spawn-helper');
    mkdirSync(path.dirname(helper), { recursive: true });
    writeFileSync(helper, '');
    chmodSync(helper, 0o644);
  }
  return nodePtyDir;
}

function modeOf(file: string): number {
  return statSync(file).mode & 0o777;
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('nativeBuildFolder', () => {
  it.each([
    {
      name: 'both a prebuild and build/Release',
      present: [PREBUILD, BUILD_RELEASE],
      picked: PREBUILD,
    },
    { name: 'only a prebuild', present: [PREBUILD], picked: PREBUILD },
    {
      name: 'only build/Release',
      present: [BUILD_RELEASE],
      picked: BUILD_RELEASE,
    },
    {
      name: "another target's prebuild and build/Release",
      present: [path.join('prebuilds', 'darwin-x64'), BUILD_RELEASE],
      picked: BUILD_RELEASE,
    },
  ])(
    'GIVEN $name WHEN nativeBuildFolder runs for darwin-arm64 THEN it picks $picked',
    ({ present, picked }) => {
      expect(nativeBuildFolder(fakeNodePty(present), 'darwin', 'arm64')).toBe(
        picked,
      );
    },
  );

  it('GIVEN no native build for the target WHEN nativeBuildFolder runs THEN it throws naming the target', () => {
    const nodePtyDir = fakeNodePty([path.join('prebuilds', 'darwin-x64')]);
    expect(() => nativeBuildFolder(nodePtyDir, 'darwin', 'arm64')).toThrow(
      'node-pty has no native build for darwin-arm64',
    );
  });
});

// Windows keeps no POSIX mode bits, so the execute bit is checked elsewhere.
describe.skipIf(process.platform === 'win32')(
  'the spawn-helper execute bit',
  () => {
    it('GIVEN a prebuild and build/Release WHEN copyNodePty runs THEN it copies package.json, lib and the prebuild alone, with spawn-helper at 0o755', () => {
      const nodePtyDir = fakeNodePty([PREBUILD, BUILD_RELEASE]);
      const buildPath = newFolder();

      copyNodePty(nodePtyDir, buildPath, 'darwin', 'arm64');

      const targetDir = path.join(buildPath, 'node_modules', 'node-pty');
      expect(existsSync(path.join(targetDir, 'package.json'))).toBe(true);
      expect(existsSync(path.join(targetDir, 'lib', 'index.js'))).toBe(true);
      expect(existsSync(path.join(targetDir, BUILD_RELEASE))).toBe(false);
      expect(modeOf(path.join(targetDir, PREBUILD, 'spawn-helper'))).toBe(
        0o755,
      );
    });

    it('GIVEN a folder with a spawn-helper WHEN makeSpawnHelperExecutable runs THEN the helper is 0o755', () => {
      const nodePtyDir = fakeNodePty([PREBUILD]);
      const folder = path.join(nodePtyDir, PREBUILD);

      makeSpawnHelperExecutable(folder);

      expect(modeOf(path.join(folder, 'spawn-helper'))).toBe(0o755);
    });

    it('GIVEN a folder without a spawn-helper WHEN makeSpawnHelperExecutable runs THEN it adds none and does not throw', () => {
      const folder = newFolder();

      makeSpawnHelperExecutable(folder);

      expect(existsSync(path.join(folder, 'spawn-helper'))).toBe(false);
    });
  },
);

describe('darwinPrebuildFolders', () => {
  it('GIVEN darwin and other prebuilds WHEN darwinPrebuildFolders runs THEN it lists only the darwin ones', () => {
    const nodePtyDir = fakeNodePty([
      PREBUILD,
      path.join('prebuilds', 'darwin-x64'),
      path.join('prebuilds', 'win32-x64'),
    ]);

    expect(darwinPrebuildFolders(nodePtyDir).sort()).toEqual([
      path.join(nodePtyDir, PREBUILD),
      path.join(nodePtyDir, 'prebuilds', 'darwin-x64'),
    ]);
  });

  it('GIVEN no prebuilds folder WHEN darwinPrebuildFolders runs THEN it lists none', () => {
    expect(darwinPrebuildFolders(fakeNodePty([BUILD_RELEASE]))).toEqual([]);
  });
});
