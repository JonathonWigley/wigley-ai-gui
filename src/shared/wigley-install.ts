import type { Files } from '../contracts/files';
import type { Paths } from '../contracts/paths';
import type { HarnessFolders } from './harness-folders';

export const WIGLEY_PLUGIN_KEY = 'wigley@wigley-ai-marketplace';

// `pathInInstall` (`/`-separated, from the plugin's root) in the first wigley
// install, among the registered profiles' installs, where it is a file; null
// when none holds it.
export async function locateWigleyFile(
  files: Pick<Files, 'stat'>,
  folders: Pick<HarnessFolders, 'installedPlugins'>,
  paths: Pick<Paths, 'join'>,
  pathInInstall: string,
): Promise<string | null> {
  for (const { plugin } of await folders.installedPlugins()) {
    if (plugin.key !== WIGLEY_PLUGIN_KEY) {
      continue;
    }
    const candidate = paths.join(plugin.installDir, pathInInstall);
    const found = await files.stat(candidate);
    if (found !== null && !found.isFolder) {
      return candidate;
    }
  }
  return null;
}
