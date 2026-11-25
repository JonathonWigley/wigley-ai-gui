// node-pty's run-time files: the ones `forge.config.mts` copies into the
// package, and the execute bit its macOS `spawn-helper` needs, which node-pty
// 1.1.0's published prebuilds lack. Without the bit every macOS pty spawn
// fails with `posix_spawnp failed`.
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SPAWN_HELPER = 'spawn-helper';
const EXECUTABLE_MODE = 0o755;

// The folder, relative to `nodePtyDir`, holding node-pty's native build for a
// platform and arch: its prebuild, else the build node-gyp made at install.
export function nativeBuildFolder(
  nodePtyDir: string,
  platform: string,
  arch: string,
): string {
  const candidates = [
    path.join('prebuilds', `${platform}-${arch}`),
    path.join('build', 'Release'),
  ];
  const found = candidates.find((candidate) =>
    existsSync(path.join(nodePtyDir, candidate)),
  );
  if (!found) {
    throw new Error(`node-pty has no native build for ${platform}-${arch}`);
  }
  return found;
}

// Copies what node-pty loads at run time — `package.json`, `lib/` and the
// target's native build — from `nodePtyDir` into
// `<buildPath>/node_modules/node-pty`, with its `spawn-helper` executable.
export function copyNodePty(
  nodePtyDir: string,
  buildPath: string,
  platform: string,
  arch: string,
): void {
  const nativeFolder = nativeBuildFolder(nodePtyDir, platform, arch);
  const targetDir = path.join(buildPath, 'node_modules', 'node-pty');
  for (const entry of ['package.json', 'lib', nativeFolder]) {
    const target = path.join(targetDir, entry);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(nodePtyDir, entry), target, { recursive: true });
  }
  makeSpawnHelperExecutable(path.join(targetDir, nativeFolder));
}

// Sets the execute bit on `folder`'s `spawn-helper`; a folder without one
// (a Windows build) is left as it is.
export function makeSpawnHelperExecutable(folder: string): void {
  const helper = path.join(folder, SPAWN_HELPER);
  if (existsSync(helper)) {
    chmodSync(helper, EXECUTABLE_MODE);
  }
}

// Each `prebuilds/darwin-*` folder of the node-pty at `nodePtyDir`; none when
// it has no prebuilds.
export function darwinPrebuildFolders(nodePtyDir: string): string[] {
  const prebuilds = path.join(nodePtyDir, 'prebuilds');
  if (!existsSync(prebuilds)) {
    return [];
  }
  return readdirSync(prebuilds)
    .filter((entry) => entry.startsWith('darwin-'))
    .map((entry) => path.join(prebuilds, entry));
}
