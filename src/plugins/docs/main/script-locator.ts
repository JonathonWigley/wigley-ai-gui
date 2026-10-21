import { type Files, isMissingFile } from '../../../contracts/files';
import { expandTilde, joinPath } from '../doc-paths';

export const WIGLEY_PLUGIN_KEY = 'wigley@wigley-ai-marketplace';
export const DEFAULT_CLAUDE_CONFIG_DIRS: readonly string[] = ['~/.claude'];

// The docs index's machine-local config, under the home folder.
export const DOCS_CONFIG_FILE = '.agents/wigley-docs/config.json';

const SCRIPT_IN_INSTALL = 'scripts/docs-index/docs_index.py';

// The file a Claude config folder lists its installed plugins in.
export function installedPluginsFile(configDir: string): string {
  return joinPath(configDir, 'plugins', 'installed_plugins.json');
}

// The text at `path`; null when nothing is there.
export async function readIfPresent(
  files: Files,
  path: string,
): Promise<string | null> {
  try {
    return await files.read(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

// Each configured Claude config folder, `~` expanded, in config order.
export async function readClaudeConfigDirs(
  files: Files,
  homeDir: string,
): Promise<string[]> {
  const config = await readJson(files, joinPath(homeDir, DOCS_CONFIG_FILE));
  const configured = isRecord(config) ? config.claudeConfigDirs : undefined;
  const isListOfStrings =
    Array.isArray(configured) &&
    configured.length > 0 &&
    configured.every((dir) => typeof dir === 'string');
  const dirs = isListOfStrings
    ? (configured as string[])
    : DEFAULT_CLAUDE_CONFIG_DIRS;
  return dirs.map((dir) => expandTilde(dir, homeDir));
}

// The docs_index.py to run, or null when none is found.
export async function locateScript(
  files: Files,
  homeDir: string,
  scriptPath: string,
): Promise<string | null> {
  if (scriptPath !== '') {
    return expandTilde(scriptPath, homeDir);
  }
  for (const dir of await readClaudeConfigDirs(files, homeDir)) {
    for (const candidate of await installedScripts(files, dir)) {
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
): Promise<string[]> {
  const installed = await readJson(files, installedPluginsFile(configDir));
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

// The JSON at `path`; undefined when the file is missing or unparsable.
async function readJson(files: Files, path: string): Promise<unknown> {
  const text = await readIfPresent(files, path);
  if (text === null) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
