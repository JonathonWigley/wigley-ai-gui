import type { InstalledPlugin } from '../../../contracts/agent';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import { asArray, asJson, asString, parsed } from './json-fields';

// One install `installed_plugins.json` lists. `scope` is Claude's install scope
// (`user`, `project`, `local`) and `projectPath` the folder a project or local
// install belongs to; each null when the record names none.
export interface PluginInstallRecord extends InstalledPlugin {
  scope: string | null;
  projectPath: string | null;
}

function stringOrNull(value: unknown): string | null {
  const text = asString(value);
  return text === '' ? null : text;
}

// The 1-based line of `text`'s first line holding `"<key>"`; null when none does.
function keyLine(text: string, key: string): number | null {
  const quoted = `"${key}"`;
  const index = text.split('\n').findIndex((line) => line.includes(quoted));
  return index === -1 ? null : index + 1;
}

// Every install `<configDir>/plugins/installed_plugins.json` lists, in file
// order: each plugin key in order, each key's installs in order. An install with
// no `installPath` is left out. [] when the file is missing, and when it cannot
// be read or is not JSON, which it logs; it never rejects.
export async function readInstalledPlugins(
  deps: { files: Files; paths: Paths; log: Log },
  configDir: string,
): Promise<PluginInstallRecord[]> {
  const path = deps.paths.join(configDir, 'plugins', 'installed_plugins.json');
  let text: string | null;
  try {
    text = await readIfPresent(deps.files, path);
  } catch (error) {
    deps.log('claude', `installed plugins not read: ${errorText(error)}`);
    return [];
  }
  if (text === null) {
    return [];
  }
  const json = parsed(text);
  if (!json.ok) {
    deps.log('claude', `installed plugins not read: ${path} is not JSON`);
    return [];
  }
  const records: PluginInstallRecord[] = [];
  for (const [key, installs] of Object.entries(
    asJson(asJson(json.value).plugins),
  )) {
    const line = keyLine(text, key);
    for (const install of asArray(installs).map(asJson)) {
      const installDir = asString(install.installPath);
      if (installDir === '') {
        continue;
      }
      records.push({
        key,
        installDir,
        version: stringOrNull(install.version),
        listedAt: line === null ? null : { path, line },
        scope: stringOrNull(install.scope),
        projectPath: stringOrNull(install.projectPath),
      });
    }
  }
  return records;
}
