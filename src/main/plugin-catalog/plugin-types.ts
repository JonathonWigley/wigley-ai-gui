import type { Files } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import { errorText } from '../../shared/error-text';
import { manifestSchema } from '../../shared/plugin-catalog/manifest-schema';

export interface PluginTypesDeps {
  files: Files; // takes absolute paths
  typesFolder: string; // <config folder>/plugins/_types
  emittedFolder: string; // what emittedTypesFolder returns
  paths: Paths;
  log: Log;
}

const LOG_SOURCE = 'plugins';
const DECLARATION_SUFFIX = '.d.ts';
// The one entry a user file imports its plugin types from: a protocol the
// user's tsc parses, so its text stays exactly this.
const PLUGIN_DTS_FILE = 'plugin.d.ts';
const PLUGIN_DTS_TEXT = "export type * from './contracts/user-plugin';\n";
const SCHEMA_FILE = 'manifest.schema.json';
// The folder the build emits the types to, beside the app (dev) or in the
// app's resources (packaged): `tsconfig.plugin-types.json`'s `outDir`, and
// what `packagerConfig.extraResource` copies it to.
const DEV_EMITTED_FOLDER = '.plugin-types';
const PACKAGED_EMITTED_FOLDER = 'plugin-types';

// Writes the plugin contract types to `typesFolder`, so a user plugin's plain
// JS can type itself with `// @ts-check`: every `.d.ts` the build emitted, at
// its path relative to `emittedFolder`, plus `plugin.d.ts` and
// `manifest.schema.json`. From `plugins/<id>/main.js` or `page.js`:
//   /** @import { UserMainApi, UserMainStart } from '../_types/plugin' */
//   /** @import { ChatMainExports } from '../_types/plugins/chat/contract' */
//   /** @import { PluginManifest } from '../_types/contracts/plugin' */
// and in `manifest.json`: "$schema": "../_types/manifest.schema.json".
// Overwrites the files it writes and deletes none a newer build stops
// emitting. Never rejects: a missing `emittedFolder` logs and still writes
// the two files; any other failure logs and stops.
export async function writePluginTypes(deps: PluginTypesDeps): Promise<void> {
  const { files, typesFolder, emittedFolder, paths, log } = deps;
  try {
    const emitted = await files.stat(emittedFolder);
    if (emitted?.isFolder) {
      await copyDeclarations(files, emittedFolder, typesFolder, paths);
    } else {
      log(LOG_SOURCE, `plugin types not written: ${emittedFolder} is missing`);
    }
    await files.write(
      paths.join(typesFolder, PLUGIN_DTS_FILE),
      PLUGIN_DTS_TEXT,
    );
    await files.write(
      paths.join(typesFolder, SCHEMA_FILE),
      `${JSON.stringify(manifestSchema, null, 2)}\n`,
    );
  } catch (error) {
    log(LOG_SOURCE, `plugin types not written: ${errorText(error)}`);
  }
}

// Where the build put the emitted `.d.ts` tree.
export function emittedTypesFolder(app: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string {
  return app.isPackaged
    ? `${app.resourcesPath}/${PACKAGED_EMITTED_FOLDER}`
    : `${app.appPath}/${DEV_EMITTED_FOLDER}`;
}

async function copyDeclarations(
  files: Files,
  fromFolder: string,
  toFolder: string,
  paths: Paths,
): Promise<void> {
  const entries = await files.list(fromFolder, { recursive: true });
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.endsWith(DECLARATION_SUFFIX)) {
      continue;
    }
    const text = await files.read(paths.join(fromFolder, entry.path));
    await files.write(paths.join(toFolder, entry.path), text);
  }
}
