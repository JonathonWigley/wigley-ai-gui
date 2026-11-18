import { homedir } from 'node:os';
import type { ProcessRunner } from '../../contracts/processes';
import { osPlatform } from '../../shared/os-platform';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import { fakePlatform } from '../../shared/platform.test-support';
import { createNodeFiles } from '../files/node-files';
import { createNodeProcesses, type NodeProcessesDeps } from './node-processes';

// The node adapter on this machine's OS, paths, disk and home, with no core
// program setting; `overrides` replaces any of those.
export function hostNodeProcesses(
  overrides: Partial<NodeProcessesDeps> = {},
): ProcessRunner {
  const os = osPlatform(process.platform);
  return createNodeProcesses({
    files: createNodeFiles({
      trashItem: () => Promise.reject(new Error('no process test trashes')),
      os,
    }),
    paths: os === 'windows' ? windowsPaths : posixPaths,
    os,
    homeDir: homedir(),
    programs: fakePlatform(os).programs,
    programSetting: () => '',
    ...overrides,
  });
}
