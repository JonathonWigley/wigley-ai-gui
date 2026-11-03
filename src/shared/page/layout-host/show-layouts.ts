import type { Bridge } from '../../../contracts/bridge';
import type { Disposable } from '../../../contracts/disposable';
import type { LayoutOwner, LayoutSet } from '../../../contracts/layouts';
import type { Log } from '../../../contracts/log';
import type {
  LayoutShow,
  ShowLayoutOptions,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../error-text';
import { layoutUrl } from '../../layout-url';
import { createLayoutLoader, type LayoutLoader } from './layout-loader';

// `importModule` imports a layout's script by URL; `head` holds the layouts'
// stylesheet links; `onConfigChanged` hears each new config until its
// dispose.
export interface PageLayoutsDeps {
  bridge: Pick<Bridge, 'layouts' | 'onLayouts'>;
  importModule(url: string): Promise<unknown>;
  head: HTMLElement;
  log: Log;
  toast(text: string, tone: ToastTone): void;
  onConfigChanged(listener: () => void): Disposable;
}

// Shows each owner's layouts on the page, from main's sets for that owner.
export interface PageLayouts {
  show<L>(owner: LayoutOwner, options: ShowLayoutOptions<L>): LayoutShow;
}

const DEFAULT_NAME = 'default';

// What a load was queued for: the set, the names to load, and the setting's
// name when the set lists it, else null.
interface QueuedLoad {
  set: LayoutSet;
  names: string[];
  listedUser: string | null;
}

// Page layouts over one bridge listener, which hands each set to the live
// shows of its owner.
export function createPageLayouts(deps: PageLayoutsDeps): PageLayouts {
  const hearers = new Map<LayoutOwner, Set<(set: LayoutSet) => void>>();
  deps.bridge.onLayouts((owner, set) => {
    for (const hear of Array.from(hearers.get(owner) ?? [])) {
      hear(set);
    }
  });
  const hear = (owner: LayoutOwner, listener: (set: LayoutSet) => void) => {
    const owned = hearers.get(owner) ?? new Set();
    hearers.set(owner, owned);
    owned.add(listener);
    return () => owned.delete(listener);
  };
  return {
    show: (owner, options) => showLayouts(owner, options, deps, hear),
  };
}

// Loads the user's layout and the layouts in use from main's latest set for
// `owner`, and hands the owner the loaded layouts whenever a load changes them.
// Every set, every config change and every `refresh()` that changes what to
// load queues a load; loads run one at a time in order. A setting naming a
// layout the set lacks draws `default` and is logged once, until the setting
// changes or a set lists it. A set heard before main answers `layouts` is
// newer, so the answer is then dropped; an answer of null waits for the
// owner's first set. Each log line carries the owner as its source.
function showLayouts<L>(
  owner: LayoutOwner,
  options: ShowLayoutOptions<L>,
  deps: PageLayoutsDeps,
  hear: (owner: LayoutOwner, listener: (set: LayoutSet) => void) => () => void,
): LayoutShow {
  const { log, toast } = deps;
  const loader: LayoutLoader<L> = createLayoutLoader<L>({
    owner,
    importModule: deps.importModule,
    layoutUrl: (name, revision, path) => layoutUrl(owner, name, revision, path),
    defaultLayout: options.defaultLayout,
    defaultStylesheet: options.defaultStylesheet,
    head: deps.head,
    read: (module, name) => options.read(module, name),
  });
  const namesInUse = () => options.namesInUse?.() ?? [];
  let queue = Promise.resolve();
  let heardChange = false;
  let isDisposed = false;
  let latest: LayoutSet | null = null;
  let lastQueued: QueuedLoad | null = null;
  let lastShown: ShownLayouts<L> | null = null;
  let missingLogged: string | null = null;

  const logMissing = (user: string, isListed: boolean) => {
    if (isListed) {
      missingLogged = null;
      return;
    }
    if (missingLogged !== user) {
      missingLogged = user;
      log(owner, `layout ${user} not found, drawing ${DEFAULT_NAME}`);
    }
  };

  const loadAndShow = async (queued: QueuedLoad) => {
    if (isDisposed) {
      return;
    }
    const result = await loader.load(queued.set, queued.names);
    if (isDisposed) {
      // The load ran past the dispose and may have linked stylesheets again.
      loader.dispose();
      return;
    }
    for (const entry of result.loaded) {
      log(owner, `layout ${entry.name} shown (revision ${entry.revision})`);
    }
    for (const { entry, error } of result.failed) {
      log(owner, `layout ${entry.name} failed: ${errorText(error)}`);
      toast(`Layout ${entry.name} failed: ${errorText(error)}`, 'error');
    }
    const { listedUser } = queued;
    const isUserLoaded = listedUser !== null && result.layouts.has(listedUser);
    const shown: ShownLayouts<L> = {
      layouts: result.layouts,
      user: isUserLoaded ? listedUser : DEFAULT_NAME,
    };
    if (lastShown === null || shownChanged(lastShown, shown)) {
      options.setLayouts(shown);
      lastShown = shown;
    }
  };

  const update = () => {
    if (latest === null || isDisposed) {
      return;
    }
    const set = latest;
    const user = options.userLayout();
    const isListed = set.layouts.some((entry) => entry.name === user);
    logMissing(user, isListed);
    const listedUser = isListed ? user : null;
    const names = [...new Set([...(isListed ? [user] : []), ...namesInUse()])];
    const isQueued =
      lastQueued !== null &&
      lastQueued.set === set &&
      lastQueued.listedUser === listedUser &&
      sameNames(lastQueued.names, names);
    if (isQueued) {
      return;
    }
    const queued: QueuedLoad = { set, names, listedUser };
    lastQueued = queued;
    queue = queue
      .then(() => loadAndShow(queued))
      .catch((error: unknown) =>
        log(owner, `layouts not shown: ${errorText(error)}`),
      );
  };

  const stopHearing = hear(owner, (set) => {
    heardChange = true;
    latest = set;
    update();
  });
  const configHeard = deps.onConfigChanged(update);
  deps.bridge
    .layouts(owner)
    .then((set) => {
      if (set !== null && !heardChange) {
        latest = set;
        update();
      }
    })
    .catch((error: unknown) =>
      log(owner, `layout not read: ${errorText(error)}`),
    );
  return {
    refresh: update,
    dispose() {
      isDisposed = true;
      stopHearing();
      configHeard.dispose();
      loader.dispose();
    },
  };
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

// True when `next` names another user layout, or holds another name set or
// another layout object at some name.
function shownChanged<L>(
  last: ShownLayouts<L>,
  next: ShownLayouts<L>,
): boolean {
  if (last.user !== next.user || last.layouts.size !== next.layouts.size) {
    return true;
  }
  for (const [name, layout] of next.layouts) {
    if (!last.layouts.has(name) || last.layouts.get(name) !== layout) {
      return true;
    }
  }
  return false;
}
