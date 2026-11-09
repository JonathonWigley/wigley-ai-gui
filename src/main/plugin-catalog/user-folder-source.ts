import type { Files, FileWatch } from '../../contracts/files';
import { readIfPresent } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import type { MainPart } from '../../contracts/plugin';
import type { PluginSource, SourceLoad } from '../../contracts/plugin-catalog';
import type { UserMainModule } from '../../contracts/user-plugin';
import { pluginIdProblem } from '../../shared/define-plugin';
import { errorText } from '../../shared/error-text';
import { isLayoutFileName } from '../../shared/layouts/layout-registry';
import { validateManifest } from '../../shared/plugin-catalog/validate-manifest';
import { pluginUrl } from '../../shared/plugin-url';

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
export function createUserFolderSource(
  deps: UserFolderSourceDeps,
): PluginSource {
  const { pluginsFolder, codeFolder, paths, log } = deps;
  // The last revision each id took, kept for the life of the process.
  const revisions = new Map<string, number>();
  // The ids whose last load was `loaded` or `failed`.
  const held = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  // Runs `work` after every earlier queued load, so two loads never
  // interleave.
  const serially = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };

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

  // Copies every file of the plugin folder but those under a name starting
  // with `.`, and resolves the copied paths, relative to the copy.
  const copyRevision = async (
    id: string,
    revision: number,
  ): Promise<Set<string>> => {
    const copied = new Set<string>();
    const files = (await pluginsFolder.list(id, { recursive: true })).filter(
      (entry) =>
        entry.kind === 'file' &&
        !entry.path.split('/').some((segment) => segment.startsWith('.')),
    );
    for (const file of files) {
      const bytes = await pluginsFolder.readBytes(`${id}/${file.path}`);
      await codeFolder.writeBytes(`${id}/${revision}/${file.path}`, bytes);
      copied.add(file.path);
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

  // Loads the id in turn with every other load, and notes whether the
  // source holds it now. A problem `load` did not foresee fails the load.
  const loadInTurn = (id: string): Promise<TrackedLoad> =>
    serially(async () => {
      let result: SourceLoad;
      try {
        result = await load(id);
      } catch (error) {
        result = failed(id, errorText(error));
      }
      const announced = result.kind !== 'gone' || held.has(id);
      if (result.kind === 'gone') {
        held.delete(id);
      } else {
        held.add(id);
      }
      return { load: result, announced };
    });

  const watch = (listener: (load: SourceLoad) => void) => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let disposed = false;

    const loadSettled = (id: string) => {
      timers.delete(id);
      void loadInTurn(id).then(({ load: settled, announced }) => {
        if (!disposed && announced) {
          listener(settled);
        }
      });
    };

    // The first segment is the plugin's id; a path of one segment is the
    // plugin folder itself, made, renamed or deleted.
    const onChange = (changed: string) => {
      const segments = changed.split('/');
      const id = segments[0];
      if (id.startsWith('_') || id.startsWith('.')) {
        return;
      }
      const isDeeper = segments.length > 1;
      const isLayoutSave = isDeeper && segments[1] === LAYOUTS_FOLDER;
      const isIgnoredFile =
        isDeeper && !isLayoutFileName(segments[segments.length - 1]);
      if (isLayoutSave || isIgnoredFile) {
        return;
      }
      clearTimeout(timers.get(id));
      timers.set(
        id,
        setTimeout(() => loadSettled(id), PLUGIN_SETTLE_MS),
      );
    };

    const logWatchFailed = (error: unknown) =>
      log(LOG_SOURCE, `plugins watch failed: ${errorText(error)}`);

    let fileWatch: FileWatch | null = null;
    try {
      fileWatch = pluginsFolder.watch(ROOT, onChange, {
        onError: logWatchFailed,
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
      },
    };
  };

  return {
    loadAll: async () => {
      const names = (await pluginsFolder.list(ROOT))
        .map((entry) => entry.path)
        .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
        .sort((a, b) => a.localeCompare(b));
      const loads: SourceLoad[] = [];
      for (const name of names) {
        const { load: loaded } = await loadInTurn(name);
        if (loaded.kind !== 'gone') {
          loads.push(loaded);
        }
      }
      return loads;
    },
    watch,
    reload: async (id) => (await loadInTurn(id)).load,
  };
}
