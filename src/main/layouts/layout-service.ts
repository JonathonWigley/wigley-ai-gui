import type { Disposable } from '../../contracts/disposable';
import type { Files } from '../../contracts/files';
import type { LayoutOwner, LayoutSet } from '../../contracts/layouts';
import type { Log } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import { PLUGIN_ID_PATTERN } from '../../shared/define-plugin';
import { errorText } from '../../shared/error-text';
import { isSameJson } from '../../shared/json';
import {
  type LayoutRegistry,
  startLayoutRegistry,
} from '../../shared/layouts/layout-registry';
import { scopedFiles } from '../../shared/scoped-files';

export interface LayoutServiceDeps {
  // Takes absolute paths.
  files: Files;
  paths: Paths;
  // The absolute `layouts` folder in the user config folder.
  folder: string;
  // The absolute repo clone each owner's live `default` is read from; null
  // when the clone is missing.
  repoDir: string | null;
  // The user plugin's folder (`<config folder>/plugins/<id>`) for an owner the
  // catalog holds as a user plugin; null otherwise.
  userPluginFolder(owner: LayoutOwner): string | null;
  // The text of `src/shared/page/layout-host/kit.d.ts`.
  kitTypes: string;
  send(owner: LayoutOwner, set: LayoutSet): void;
  // Runs when a set an owner sends holds other layout names than the last it
  // sent, and when a registration is disposed; not on `register` or `dispose`.
  namesChanged(): void;
  log: Log;
}

// The core's layouts folder, one registry per registered owner over its own
// `<folder>/<owner>/`. `register` starts the owner's registry, which writes
// the owner's `layout.d.ts` and also watches the owner's default folder for a
// live `default`, and sends the owner's first set once it has listed, then
// each set the registry announces. The default folder is read at `register`:
// `<userPluginFolder(owner)>/layouts/default` for a user plugin, made first
// when missing so a `layout.js` written there later is watched, clone or no
// clone; else `defaultFolder` (relative to `repoDir`, `/`-separated), and with
// no `repoDir` the `default` stays built in. It throws
// `<owner> is no layout owner` for an owner that is not lowercase letters,
// digits and `-`, and `layouts of <owner> already registered` while the owner
// holds a registration. Disposing a registration closes its watches and drops
// the owner; disposing it again, or after `dispose`, does nothing. `names` reads `['default']` and `read` resolves null for an
// owner not registered or not yet listed. `defaultFolderPath` is the absolute
// default folder of a registered owner, listed or not; null for an owner not
// registered, or for one that is no user plugin with no `repoDir`.
// `namesByOwner` holds `names` of every registered owner, listed or not.
// `dispose` drops every owner.
export interface LayoutService {
  register(
    owner: LayoutOwner,
    layoutTypes: string,
    defaultFolder: string,
  ): Disposable;
  names(owner: LayoutOwner): string[];
  namesByOwner(): Record<LayoutOwner, string[]>;
  defaultFolderPath(owner: LayoutOwner): string | null;
  read(owner: LayoutOwner): Promise<LayoutSet | null>;
  dispose(): void;
}

// Lowercase letters, digits and `-`, as a plugin id is: the `wigley-layout:`
// URL host carries the owner, and Chromium lowercases a URL's host.
const OWNER = new RegExp(PLUGIN_ID_PATTERN);
const DEFAULT_NAME = 'default';
// The log source of the service's own lines.
const LOG_SOURCE = 'layouts';

// One owner's registration: its registry once it has listed, until disposed,
// its absolute default folder, null for a built-in with no clone, and the
// layout names of the last set it sent, `default` alone before the first.
interface Registration {
  registry: LayoutRegistry | null;
  isDisposed: boolean;
  defaultFolderPath: string | null;
  toldNames: readonly string[];
}

// Writes `kitTypes` to `<folder>/kit.d.ts` at once; a failed write is logged
// under source `layouts` and changes nothing else.
export function createLayoutService(deps: LayoutServiceDeps): LayoutService {
  const { files, paths, log } = deps;
  const registrations = new Map<LayoutOwner, Registration>();
  const kitPath = paths.join(deps.folder, 'kit.d.ts');
  files
    .write(kitPath, deps.kitTypes)
    .catch((error: unknown) =>
      log(LOG_SOURCE, `${kitPath} not written: ${errorText(error)}`),
    );

  // Whether this call disposed `held`: false when it already was.
  const disposeRegistration = (
    owner: LayoutOwner,
    held: Registration,
  ): boolean => {
    if (held.isDisposed) {
      return false;
    }
    held.isDisposed = true;
    held.registry?.dispose();
    if (registrations.get(owner) === held) {
      registrations.delete(owner);
    }
    return true;
  };

  // Sends `set`, telling `namesChanged` when its names differ from the last
  // set `held` sent.
  const sendSet = (owner: LayoutOwner, held: Registration, set: LayoutSet) => {
    deps.send(owner, set);
    const names = set.layouts.map((entry) => entry.name);
    if (!isSameJson(names, held.toldNames)) {
      held.toldNames = names;
      deps.namesChanged();
    }
  };

  return {
    register(owner, layoutTypes, defaultFolder) {
      if (!OWNER.test(owner)) {
        throw new Error(`${owner} is no layout owner`);
      }
      if (registrations.has(owner)) {
        throw new Error(`layouts of ${owner} already registered`);
      }
      const userFolder = deps.userPluginFolder(owner);
      const userDefault =
        userFolder === null
          ? null
          : paths.join(userFolder, 'layouts', DEFAULT_NAME);
      const defaultFolderPath =
        userDefault ??
        (deps.repoDir === null
          ? null
          : paths.join(deps.repoDir, defaultFolder));
      const held: Registration = {
        registry: null,
        isDisposed: false,
        defaultFolderPath,
        toldNames: [DEFAULT_NAME],
      };
      registrations.set(owner, held);
      // The registry leaves a default folder missing at its start unwatched,
      // so a user plugin's is made first; a failed make is logged and the
      // registry starts anyway.
      const folderMade =
        userDefault === null
          ? Promise.resolve()
          : files
              .makeFolder(userDefault)
              .catch((error: unknown) =>
                log(owner, `${userDefault} not made: ${errorText(error)}`),
              );
      const started = folderMade.then(() =>
        startLayoutRegistry({
          folder: scopedFiles(files, paths.join(deps.folder, owner), paths),
          defaultFolder:
            defaultFolderPath === null
              ? null
              : scopedFiles(files, defaultFolderPath, paths),
          send: (set) => {
            if (!held.isDisposed) {
              sendSet(owner, held, set);
            }
          },
          log,
          logSource: owner,
          layoutTypes,
        }),
      );
      started.then(
        (registry) => {
          if (held.isDisposed) {
            registry.dispose();
            return;
          }
          held.registry = registry;
          sendSet(owner, held, registry.current());
        },
        (error: unknown) =>
          log(owner, `layouts not started: ${errorText(error)}`),
      );
      return {
        dispose: () => {
          if (disposeRegistration(owner, held)) {
            deps.namesChanged();
          }
        },
      };
    },
    names: (owner) =>
      registrations.get(owner)?.registry?.names() ?? [DEFAULT_NAME],
    namesByOwner() {
      const byOwner: Record<LayoutOwner, string[]> = {};
      for (const [owner, held] of registrations) {
        byOwner[owner] = held.registry?.names() ?? [DEFAULT_NAME];
      }
      return byOwner;
    },
    defaultFolderPath: (owner) =>
      registrations.get(owner)?.defaultFolderPath ?? null,
    read: async (owner) =>
      registrations.get(owner)?.registry?.current() ?? null,
    dispose() {
      for (const [owner, held] of Array.from(registrations)) {
        disposeRegistration(owner, held);
      }
    },
  };
}
