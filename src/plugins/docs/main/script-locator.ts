import { type Files, readIfPresent } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import { expandTilde, joinPath } from '../doc-paths';

export const WIGLEY_PLUGIN_KEY = 'wigley@wigley-ai-marketplace';
export const DEFAULT_CLAUDE_CONFIG_DIRS: readonly string[] = ['~/.claude'];

// The docs index's machine-local config, under the home folder.
const DOCS_CONFIG_FILE = '.agents/wigley-docs/config.json';

const SCRIPT_IN_INSTALL = 'scripts/docs-index/docs_index.py';

// The file a Claude config folder lists its installed plugins in.
export function installedPluginsFile(configDir: string): string {
  return joinPath(configDir, 'plugins', 'installed_plugins.json');
}

// doc-files.ts and index-sources.ts import it from here.
export { readIfPresent } from '../../../contracts/files';

// Each configured Claude config folder, `~` expanded, in config order; an
// entry that is not absolute once expanded is dropped, and the default stands
// when no entry is left.
export async function readClaudeConfigDirs(
  files: Files,
  homeDir: string,
  log: Log,
): Promise<string[]> {
  const config = await readJson(
    files,
    joinPath(homeDir, DOCS_CONFIG_FILE),
    log,
  );
  const configured = isRecord(config) ? config.claudeConfigDirs : undefined;
  const isListOfStrings =
    Array.isArray(configured) &&
    configured.every((dir) => typeof dir === 'string');
  const absoluteDirs = isListOfStrings
    ? (configured as string[])
        .map((dir) => expandTilde(dir, homeDir))
        .filter((dir) => dir.startsWith('/'))
    : [];
  return absoluteDirs.length > 0
    ? absoluteDirs
    : DEFAULT_CLAUDE_CONFIG_DIRS.map((dir) => expandTilde(dir, homeDir));
}

// The docs_index.py to run, or null when none is found.
export async function locateScript(
  files: Files,
  homeDir: string,
  scriptPath: string,
  log: Log,
): Promise<string | null> {
  if (scriptPath !== '') {
    return expandTilde(scriptPath, homeDir);
  }
  for (const dir of await readClaudeConfigDirs(files, homeDir, log)) {
    for (const candidate of await installedScripts(files, dir, log)) {
      const found = await files.stat(candidate);
      if (found !== null && !found.isFolder) {
        return candidate;
      }
    }
  }
  return null;
}

// The script each wigley install `configDir` lists would hold, in list order.
async function installedScripts(
  files: Files,
  configDir: string,
  log: Log,
): Promise<string[]> {
  const installed = await readJson(files, installedPluginsFile(configDir), log);
  const plugins = isRecord(installed) ? installed.plugins : undefined;
  const records = isRecord(plugins) ? plugins[WIGLEY_PLUGIN_KEY] : undefined;
  if (!Array.isArray(records)) {
    return [];
  }
  return records
    .filter(
      (record): record is { installPath: string } =>
        isRecord(record) && typeof record.installPath === 'string',
    )
    .map((record) => joinPath(record.installPath, SCRIPT_IN_INSTALL));
}

// The JSON at `path`; undefined when the file is missing, unreadable or
// unparsable, logging every failure but a missing file.
async function readJson(
  files: Files,
  path: string,
  log: Log,
): Promise<unknown> {
  try {
    const text = await readIfPresent(files, path);
    return text === null ? undefined : JSON.parse(text);
  } catch (error) {
    log('docs', `${path} not read: ${errorText(error)}`);
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
