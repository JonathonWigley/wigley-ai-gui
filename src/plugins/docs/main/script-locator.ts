import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { HarnessFolders } from '../../../shared/harness-folders';
import { locateWigleyFile } from '../../../shared/wigley-install';

const SCRIPT_IN_INSTALL = 'scripts/docs-index/docs_index.py';

// The docs_index.py to run: `scriptPath` expanded when set, else the first
// wigley install, among the registered profiles' installs, whose script is a
// file; null when none is.
export async function locateScript(
  files: Files,
  homeDir: string,
  scriptPath: string,
  folders: Pick<HarnessFolders, 'installedPlugins'>,
  paths: Paths,
): Promise<string | null> {
  if (scriptPath !== '') {
    return paths.expandTilde(scriptPath, homeDir);
  }
  return locateWigleyFile(files, folders, paths, SCRIPT_IN_INSTALL);
}
