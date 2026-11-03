import type { Disposable } from '../../contracts/disposable';
import type { Files } from '../../contracts/files';
import type { LayoutOwner, LayoutSet } from '../../contracts/layouts';
import type { Log } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import { errorText } from '../../shared/error-text';
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
  // The text of `src/shared/page/layout-host/kit.d.ts`.
  kitTypes: string;
  send(owner: LayoutOwner, set: LayoutSet): void;
  log: Log;
}

// The core's layouts folder, one registry per registered owner over its own
// `<folder>/<owner>/`. `register` starts the owner's registry, which writes
// the owner's `layout.d.ts`, and sends the owner's first set once it has
// listed, then each set the registry announces; it throws
// `<owner> is no layout owner` for an owner that is not lowercase letters,
// digits and `-`, and `layouts of <owner> already registered` while the owner
// holds a registration. Disposing a registration closes its watch and drops
// the owner. `names` reads `['default']` and `read` resolves null for an
// owner not registered or not yet listed. `dispose` drops every owner.
export interface LayoutService {
  register(owner: LayoutOwner, layoutTypes: string): Disposable;
  names(owner: LayoutOwner): string[];
  read(owner: LayoutOwner): Promise<LayoutSet | null>;
  dispose(): void;
}

// Lowercase letters, digits and `-`, as a plugin id is: the `wigley-layout:`
// URL host carries the owner, and Chromium lowercases a URL's host.
const OWNER = /^[a-z0-9-]+$/;
const DEFAULT_NAME = 'default';
// The log source of the service's own lines.
const LOG_SOURCE = 'layouts';

// One owner's registration: its registry once it has listed, until disposed.
interface Registration {
  registry: LayoutRegistry | null;
  isDisposed: boolean;
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

  const disposeRegistration = (owner: LayoutOwner, held: Registration) => {
    held.isDisposed = true;
    held.registry?.dispose();
    if (registrations.get(owner) === held) {
      registrations.delete(owner);
    }
  };

  return {
    register(owner, layoutTypes) {
      if (!OWNER.test(owner)) {
        throw new Error(`${owner} is no layout owner`);
      }
      if (registrations.has(owner)) {
        throw new Error(`layouts of ${owner} already registered`);
      }
      const held: Registration = { registry: null, isDisposed: false };
      registrations.set(owner, held);
      startLayoutRegistry({
        folder: scopedFiles(files, paths.join(deps.folder, owner), paths),
        defaultFolder: null,
        send: (set) => {
          if (!held.isDisposed) {
            deps.send(owner, set);
          }
        },
        log,
        logSource: owner,
        layoutTypes,
      }).then(
        (registry) => {
          if (held.isDisposed) {
            registry.dispose();
            return;
          }
          held.registry = registry;
          deps.send(owner, registry.current());
        },
        (error: unknown) =>
          log(owner, `layouts not started: ${errorText(error)}`),
      );
      return { dispose: () => disposeRegistration(owner, held) };
    },
    names: (owner) =>
      registrations.get(owner)?.registry?.names() ?? [DEFAULT_NAME],
    read: async (owner) =>
      registrations.get(owner)?.registry?.current() ?? null,
    dispose() {
      for (const [owner, held] of Array.from(registrations)) {
        disposeRegistration(owner, held);
      }
    },
  };
}
