import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { HarnessFolders } from './harness-folders';

export const WIGLEY_PLUGIN_KEY = 'wigley@wigley-ai-marketplace';

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
  for (const { plugin } of await folders.installedPlugins()) {
    if (plugin.key !== WIGLEY_PLUGIN_KEY) {
      continue;
    }
    const candidate = paths.join(plugin.installDir, SCRIPT_IN_INSTALL);
    const found = await files.stat(candidate);
    if (found !== null && !found.isFolder) {
      return candidate;
    }
  }
  return null;
}
