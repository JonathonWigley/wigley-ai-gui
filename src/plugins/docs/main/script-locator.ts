import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';

const SCRIPT_IN_PLUGIN = 'scripts/docs-index/docs_index.py';

// The docs_index.py to run: `scriptPath` expanded when set, else the copy in
// the app's agent plugin at `pluginDir` when that is a file; null when it is
// not.
export async function locateScript(
  files: Pick<Files, 'stat'>,
  homeDir: string,
  scriptPath: string,
  pluginDir: string,
  paths: Paths,
): Promise<string | null> {
  if (scriptPath !== '') {
    return paths.expandTilde(scriptPath, homeDir);
  }
  const script = paths.join(pluginDir, SCRIPT_IN_PLUGIN);
  const found = await files.stat(script);
  return found !== null && !found.isFolder ? script : null;
}
