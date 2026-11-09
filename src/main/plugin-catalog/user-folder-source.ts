import type { Files, FileWatch } from '../../contracts/files';
import { readIfPresent } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import type { MainPart } from '../../contracts/plugin';
import type {
  SourceLoad,
  WatchedPluginSource,
} from '../../contracts/plugin-catalog';
import type { UserMainModule } from '../../contracts/user-plugin';
import { pluginIdProblem } from '../../shared/define-plugin';
import { errorText } from '../../shared/error-text';
import { validateManifest } from '../../shared/plugin-catalog/validate-manifest';
import { pluginUrl } from '../../shared/plugin-url';
import { createSerialQueue } from '../../shared/serial-queue';

// How long after the last change under a plugin's folder its load runs, so a
// save that writes several files loads once.
export const PLUGIN_SETTLE_MS = 300;
// How long a `main.js` import may take before its load fails.
export const PLUGIN_IMPORT_TIMEOUT_MS = 5000;

export interface UserFolderSourceDeps {
  pluginsFolder: Files; // scoped to <config folder>/plugins
  userRoot: string; // the absolute path of <config folder>/plugins
  codeFolder: Files; // scoped to <user data>/plugin-code
  codeRoot: string; // the absolute path of <user data>/plugin-code
  paths: Paths;
  importModule: (filePath: string) => Promise<Record<string, unknown>>;
  log: Log;
}

const LOG_SOURCE = 'plugin-catalog';
const ROOT = '';
const MAIN_FILE = 'main.js';
const PAGE_FILE = 'page.js';
const MANIFEST_FILE = 'manifest.json';
// Written over each copy, so Node reads every `.js` in it as an ES module.
const MODULE_PACKAGE = 'package.json';
const MODULE_PACKAGE_TEXT = '{"type":"module"}';
// The folder a plugin keeps its own layouts in, which the layout registry
// reloads without restarting the plugin.
const LAYOUTS_FOLDER = 'layouts';
const REVISION_NAME = /^\d+$/;
// The names editors give swap, backup and temporary files.
const EDITOR_TEMP_FILE = /(~|\.swp|\.swx|\.tmp)$/;

// Whether `name`, in the plugins folder, can name a plugin: names starting
// with `_` or `.` hold shared files instead.
function isPluginName(name: string): boolean {
  return !name.startsWith('_') && !name.startsWith('.');
}

// Whether `path`, in a plugin folder, lies under a name starting with `.`,
// which a load leaves out of its copy.
function isHidden(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.'));
}

// A load and whether the watch sends it: a `gone` goes out only for an id the
// source loaded or failed before.
interface TrackedLoad {
  load: SourceLoad;
  announced: boolean;
}

type MainImport = { module: Record<string, unknown> } | { problem: string };

// The user's plugin folders, `<config folder>/plugins/<id>/`. Each load copies
// the folder to `<user data>/plugin-code/<id>/<revision>/` and imports the
// copy's `main.js`, so every load, its relative imports included, is a new
// module. A load never throws: a problem resolves `failed` with its message.
// When the watch may have dropped changes (`onMissed`), each folder that came,
// went, or whose files' paths or modified times differ from its last load
// loads as a reported change would.
export function createUserFolderSource(
  deps: UserFolderSourceDeps,
): WatchedPluginSource {
  const { pluginsFolder, codeFolder, paths, log } = deps;
  // The last revision each id took, kept for the life of the process.
  const revisions = new Map<string, number>();
  // The ids whose last load was `loaded` or `failed`.
  const held = new Set<string>();
  // Each held id's files as `fingerprintOf` read them just before its last
  // load.
  const fingerprints = new Map<string, string | null>();
  // Whether `loadAll` ran, which loads every folder it finds.
  let hasLoadedAll = false;
  // Two loads never interleave.
  const loads = createSerialQueue();

  const failed = (id: string, message: string): SourceLoad => {
    log(LOG_SOURCE, `plugin ${id} failed: ${message}`);
    return { kind: 'failed', id, message };
  };

  // One above the highest revision folder an earlier launch left on disk
  // for the id's first load in this launch; one above the last after that.
  const nextRevision = async (id: string): Promise<number> => {
    let last = revisions.get(id);
    if (last === undefined) {
      const onDisk = (await codeFolder.list(id))
        .filter((entry) => entry.kind === 'folder')
        .map((entry) => entry.path)
        .filter((name) => REVISION_NAME.test(name))
        .map(Number);
      last = Math.max(0, ...onDisk);
    }
    const revision = last + 1;
    revisions.set(id, revision);
    return revision;
  };

  // The files of the plugin folder a load copies, relative to it: every file
  // not hidden, a link to a folder taken as that folder, each real folder
  // listed once.
  const filesToCopy = async (id: string): Promise<string[]> => {
    const inPlugin = (path: string) => (path === ROOT ? id : `${id}/${path}`);
    const found: string[] = [];
    const listedFolders = new Set([await pluginsFolder.realPath(id)]);
    const pending = [ROOT];
    let folder: string | undefined;
    while ((folder = pending.pop()) !== undefined) {
      const entries = await pluginsFolder.list(inPlugin(folder), {
        recursive: true,
      });
      for (const entry of entries) {
        const path = folder === ROOT ? entry.path : `${folder}/${entry.path}`;
        if (entry.kind !== 'file' || isHidden(path)) {
          continue;
        }
        // A link to a folder lists as a file.
        if ((await pluginsFolder.stat(inPlugin(path)))?.isFolder !== true) {
          found.push(path);
          continue;
        }
        const realFolder = await pluginsFolder.realPath(inPlugin(path));
        if (!listedFolders.has(realFolder)) {
          listedFolders.add(realFolder);
          pending.push(path);
        }
      }
    }
    return found;
  };

  // The files a load of `id` copies, each with its modified time, as one
  // string; null when they cannot be listed or read.
  const fingerprintOf = async (id: string): Promise<string | null> => {
    try {
      const stamps: string[] = [];
      for (const path of (await filesToCopy(id)).sort()) {
        const modified = await pluginsFolder.modified(`${id}/${path}`);
        stamps.push(`${path}\t${modified}`);
      }
      return stamps.join('\n');
    } catch {
      return null;
    }
  };

  // Copies `filesToCopy` and resolves the copied paths, relative to the copy.
  const copyRevision = async (
    id: string,
    revision: number,
  ): Promise<Set<string>> => {
    const copied = new Set<string>();
    for (const path of await filesToCopy(id)) {
      const bytes = await pluginsFolder.readBytes(`${id}/${path}`);
      await codeFolder.writeBytes(`${id}/${revision}/${path}`, bytes);
      copied.add(path);
    }
    await codeFolder.write(
      `${id}/${revision}/${MODULE_PACKAGE}`,
      MODULE_PACKAGE_TEXT,
    );
    return copied;
  };

  // Imports the copy's `main.js`, failing once `PLUGIN_IMPORT_TIMEOUT_MS`
  // pass unsettled; Node cannot cancel an import, so one that settles later
  // is ignored.
  const importMain = (filePath: string): Promise<MainImport> =>
    new Promise((resolve) => {
      const timer = setTimeout(
        () =>
          resolve({
            problem: `${MAIN_FILE} did not finish importing in ${PLUGIN_IMPORT_TIMEOUT_MS} ms`,
          }),
        PLUGIN_IMPORT_TIMEOUT_MS,
      );
      Promise.resolve()
        .then(() => deps.importModule(filePath))
        .then(
          (module) => resolve({ module }),
          (error: unknown) =>
            resolve({
              problem: `${MAIN_FILE} failed to import: ${errorText(error)}`,
            }),
        )
        .finally(() => clearTimeout(timer));
    });

  const load = async (id: string): Promise<SourceLoad> => {
    const found = await pluginsFolder.stat(id);
    if (found === null || !found.isFolder) {
      return { kind: 'gone', id };
    }
    const idProblem = pluginIdProblem(id);
    if (idProblem !== null) {
      return failed(id, idProblem);
    }
    const manifestPath = `${id}/${MANIFEST_FILE}`;
    const text = await readIfPresent(pluginsFolder, manifestPath);
    if (text === null) {
      return failed(id, `plugins/${manifestPath} is missing`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return failed(
        id,
        `plugins/${manifestPath} is not valid JSON: ${errorText(error)}`,
      );
    }
    const check = validateManifest(raw);
    if (!check.ok) {
      return failed(id, check.problems.join('; '));
    }
    const { manifest } = check;
    if (manifest.id !== id) {
      return failed(
        id,
        `manifest id "${manifest.id}" does not match its folder "${id}"`,
      );
    }
    const revision = await nextRevision(id);
    let copied: Set<string>;
    try {
      copied = await copyRevision(id, revision);
    } catch (error) {
      return failed(
        id,
        `plugins/${id} could not be copied: ${errorText(error)}`,
      );
    }
    let main: MainPart | null = null;
    if (copied.has(MAIN_FILE)) {
      const imported = await importMain(
        paths.join(deps.codeRoot, id, String(revision), MAIN_FILE),
      );
      if ('problem' in imported) {
        return failed(id, imported.problem);
      }
      if (typeof imported.module.start !== 'function') {
        return failed(id, `${MAIN_FILE} must export a start function`);
      }
      const module = imported.module as unknown as UserMainModule;
      main = { manifest, start: (api) => module.start(api) };
    }
    const pageUrl = copied.has(PAGE_FILE)
      ? pluginUrl(id, revision, PAGE_FILE)
      : null;
    log(LOG_SOURCE, `plugin ${id} loaded at revision ${revision}`);
    return {
      kind: 'loaded',
      entry: {
        manifest,
        revision,
        main,
        pageUrl,
        folder: paths.join(deps.userRoot, id),
      },
    };
  };

  // Loads the id and notes whether the source holds it now. A problem `load`
  // did not foresee fails the load.
  const trackedLoad = async (id: string): Promise<TrackedLoad> => {
    // Read before the load copies, so a save during the load differs from it.
    const fingerprint = await fingerprintOf(id);
    let result: SourceLoad;
    try {
      result = await load(id);
    } catch (error) {
      result = failed(id, errorText(error));
    }
    const announced = result.kind !== 'gone' || held.has(id);
    if (result.kind === 'gone') {
      held.delete(id);
      fingerprints.delete(id);
    } else {
      held.add(id);
      fingerprints.set(id, fingerprint);
    }
    return { load: result, announced };
  };

  // `trackedLoad` in turn with every other load.
  const loadInTurn = (id: string): Promise<TrackedLoad> =>
    loads.run(() => trackedLoad(id));

  // `loadInTurn` when the id's folder has come or gone since the source last
  // loaded it; null when the source's hold of the id already matches it.
  const loadWhenPresenceChanged = (id: string): Promise<TrackedLoad | null> =>
    loads.run(async () => {
      let isPresent: boolean;
      try {
        isPresent = (await pluginsFolder.stat(id))?.isFolder === true;
      } catch {
        return trackedLoad(id);
      }
      return isPresent === held.has(id) ? null : trackedLoad(id);
    });

  const listPluginNames = async (): Promise<string[]> =>
    (await pluginsFolder.list(ROOT))
      .map((entry) => entry.path)
      .filter(isPluginName);

  // The ids whose folder came or went since the source last loaded them
  // (`isSave` false), and the held ids whose files differ from their last
  // load (`isSave` true). A folder no load has seen counts as come only once
  // `loadAll` ran.
  const changedSinceLoad = async (): Promise<
    { id: string; isSave: boolean }[]
  > => {
    const names = await listPluginNames();
    const changed: { id: string; isSave: boolean }[] = [];
    for (const id of new Set([...names, ...held])) {
      const isPresent = (await pluginsFolder.stat(id))?.isFolder === true;
      const isHeld = held.has(id);
      if (isPresent !== isHeld) {
        if (isHeld || hasLoadedAll) {
          changed.push({ id, isSave: false });
        }
      } else if (
        isPresent &&
        (await fingerprintOf(id)) !== fingerprints.get(id)
      ) {
        changed.push({ id, isSave: true });
      }
    }
    return changed;
  };

  const watch = (listener: (load: SourceLoad) => void) => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    // The ids with a save under their folder since their last settle.
    const savedIds = new Set<string>();
    let disposed = false;

    const loadSettled = (id: string) => {
      timers.delete(id);
      const loading = savedIds.delete(id)
        ? loadInTurn(id)
        : loadWhenPresenceChanged(id);
      void loading.then((tracked) => {
        if (!disposed && tracked !== null && tracked.announced) {
          listener(tracked.load);
        }
      });
    };

    // The first segment is the plugin's id; a path of one segment is the
    // plugin folder itself: made, renamed or deleted, or on macOS a change
    // inside it, so that alone loads only when the folder came or went.
    const onChange = (changed: string) => {
      const segments = changed.split('/');
      const id = segments[0];
      if (!isPluginName(id)) {
        return;
      }
      const isSave = segments.length > 1;
      const isLayoutSave = isSave && segments[1] === LAYOUTS_FOLDER;
      const isSkippedSave =
        isSave &&
        (isHidden(changed) ||
          EDITOR_TEMP_FILE.test(segments[segments.length - 1]));
      if (isLayoutSave || isSkippedSave) {
        return;
      }
      settleLater(id, isSave);
    };

    // Loads `id` once `PLUGIN_SETTLE_MS` pass with no other change to it: as
    // a save when `isSave`, else only when its folder came or went.
    const settleLater = (id: string, isSave: boolean) => {
      if (isSave) {
        savedIds.add(id);
      }
      clearTimeout(timers.get(id));
      timers.set(
        id,
        setTimeout(() => loadSettled(id), PLUGIN_SETTLE_MS),
      );
    };

    // The watch may have dropped changes, so each id that changed since its
    // last load settles as a change the watch reported would.
    const rescan = () => {
      void loads
        .run(changedSinceLoad)
        .then((changed) => {
          if (disposed) {
            return;
          }
          for (const { id, isSave } of changed) {
            settleLater(id, isSave);
          }
        })
        .catch((error: unknown) =>
          log(LOG_SOURCE, `plugins rescan failed: ${errorText(error)}`),
        );
    };

    const logWatchFailed = (error: unknown) =>
      log(LOG_SOURCE, `plugins watch failed: ${errorText(error)}`);

    let fileWatch: FileWatch | null = null;
    try {
      fileWatch = pluginsFolder.watch(ROOT, onChange, {
        onError: logWatchFailed,
        onMissed: rescan,
      });
    } catch (error) {
      logWatchFailed(error);
    }

    return {
      dispose: () => {
        disposed = true;
        fileWatch?.dispose();
        for (const timer of timers.values()) {
          clearTimeout(timer);
        }
        timers.clear();
        savedIds.clear();
      },
    };
  };

  return {
    loadAll: async () => {
      const names = (await listPluginNames()).sort((a, b) =>
        a.localeCompare(b),
      );
      const loads: SourceLoad[] = [];
      for (const name of names) {
        const { load: loaded } = await loadInTurn(name);
        if (loaded.kind !== 'gone') {
          loads.push(loaded);
        }
      }
      hasLoadedAll = true;
      return loads;
    },
    watch,
    reload: async (id) => (await loadInTurn(id)).load,
  };
}
