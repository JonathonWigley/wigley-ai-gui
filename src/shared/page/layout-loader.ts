import type { LayoutEntry, LayoutSet } from '../../contracts/layouts';
import type { Log } from '../../contracts/log';
import type { ToastTone } from '../../contracts/plugin';
import { errorText } from '../error-text';

export interface LayoutLoaderDeps<L> {
  importModule(url: string): Promise<unknown>;
  dataUrl(path: string, revision: number): string;
  defaultLayout: L;
  head: HTMLElement;
  // The plugin's layout validator: the layout a user's `layout.js` module
  // holds, or a throw naming the first part it gets wrong.
  read(module: unknown, name: string): L;
}

// One load's outcome: `default`, every layout with a good version among the
// names asked for, and every other layout the set lists whose good version is
// at the set's revision; the entries this load imported and read; and the
// entries whose import or read failed in this load.
export interface LayoutLoad<L> {
  layouts: ReadonlyMap<string, L>;
  loaded: LayoutEntry[];
  failed: { entry: LayoutEntry; error: unknown }[];
}

export interface LayoutLoader<L> {
  load(set: LayoutSet, names: readonly string[]): Promise<LayoutLoad<L>>;
}

const DEFAULT_NAME = 'default';

// The URLs of a user layout's files in the plugin's data folder, at its revision.
export function layoutUrls(
  entry: LayoutEntry,
  dataUrl: (path: string, revision: number) => string,
): { script: string; style: string | null } {
  const folder = `layouts/${entry.name}`;
  return {
    script: dataUrl(`${folder}/layout.js`, entry.revision),
    style: entry.hasCss
      ? dataUrl(`${folder}/layout.css`, entry.revision)
      : null,
  };
}

// A layout that loaded and read, and the entry it loaded at.
interface GoodVersion<L> {
  layout: L;
  entry: LayoutEntry;
}

// An import and read of one entry, settled.
type Attempt<L> =
  | { entry: LayoutEntry; layout: L }
  | { entry: LayoutEntry; error: unknown };

// Loads the named layouts the set lists, each cached by name and revision: a
// revision that loaded, or failed, is not imported again. A failed name keeps
// its last good version. A name left out of a load stays in its layouts while
// its good version is at the set's revision, so content that names it again
// draws with it before the next load; at another revision it drops out.
// `head` holds one stylesheet link per layout in the load's layouts whose good
// version has CSS, marked `data-layout="<name>"`; a link moves only once its
// name's script has loaded and read, so a failed reload keeps the last good
// look whole, and a layout that drops out loses its link.
export function createLayoutLoader<L>(
  deps: LayoutLoaderDeps<L>,
): LayoutLoader<L> {
  const good = new Map<string, GoodVersion<L>>();
  const failedRevisions = new Map<string, number>();
  const links = new Map<string, HTMLLinkElement>();

  const attempt = async (entry: LayoutEntry): Promise<Attempt<L>> => {
    try {
      const urls = layoutUrls(entry, deps.dataUrl);
      const module = await deps.importModule(urls.script);
      return { entry, layout: deps.read(module, entry.name) };
    } catch (error) {
      return { entry, error };
    }
  };

  return {
    async load(set, names) {
      const entries = listedEntries(set, names);
      const toImport = entries.filter(
        (entry) =>
          !entry.builtIn &&
          good.get(entry.name)?.entry.revision !== entry.revision &&
          failedRevisions.get(entry.name) !== entry.revision,
      );
      const attempts = await Promise.all(toImport.map(attempt));
      const loaded: LayoutEntry[] = [];
      const failed: LayoutLoad<L>['failed'] = [];
      for (const settled of attempts) {
        if ('error' in settled) {
          failedRevisions.set(settled.entry.name, settled.entry.revision);
          failed.push(settled);
        } else {
          good.set(settled.entry.name, settled);
          failedRevisions.delete(settled.entry.name);
          loaded.push(settled.entry);
        }
      }
      const layouts = new Map<string, L>([[DEFAULT_NAME, deps.defaultLayout]]);
      const shownVersions: GoodVersion<L>[] = [];
      for (const entry of set.layouts) {
        const version = entry.builtIn ? undefined : good.get(entry.name);
        const isAsked = entries.includes(entry);
        const isCurrent = version?.entry.revision === entry.revision;
        if (version !== undefined && (isAsked || isCurrent)) {
          layouts.set(entry.name, version.layout);
          shownVersions.push(version);
        }
      }
      syncStylesheets(shownVersions, links, deps);
      return { layouts, loaded, failed };
    },
  };
}

// The set's entry for each distinct name in `names`, skipping a name the set
// does not list.
function listedEntries(
  set: LayoutSet,
  names: readonly string[],
): LayoutEntry[] {
  return [...new Set(names)].flatMap((name) =>
    set.layouts.filter((entry) => entry.name === name),
  );
}

// Leaves `head` holding one stylesheet link per version with CSS, its href at
// that version's revision, and removes every other layout's link.
function syncStylesheets<L>(
  versions: GoodVersion<L>[],
  links: Map<string, HTMLLinkElement>,
  deps: Pick<LayoutLoaderDeps<L>, 'dataUrl' | 'head'>,
): void {
  const styled = new Map<string, string>();
  for (const { entry } of versions) {
    const { style } = layoutUrls(entry, deps.dataUrl);
    if (style !== null) {
      styled.set(entry.name, style);
    }
  }
  for (const [name, link] of links) {
    if (!styled.has(name)) {
      link.remove();
      links.delete(name);
    }
  }
  for (const [name, href] of styled) {
    let link = links.get(name);
    if (link === undefined) {
      link = deps.head.ownerDocument.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.layout = name;
      deps.head.append(link);
      links.set(name, link);
    }
    link.href = href;
  }
}

// Main's layout channel as the page hears it: `layoutChanged` messages and the
// `layout` answer.
export interface LayoutChannel {
  onLayoutChanged(listener: (set: LayoutSet) => void): void;
  readLayout(): Promise<LayoutSet>;
}

// The layouts a page draws with, by name, `default` always included, and the
// name of the user's layout: the setting's when `layouts` holds it, else
// `default`.
export interface ShownLayouts<L> {
  layouts: ReadonlyMap<string, L>;
  user: string;
}

export interface ShowLayoutsDeps<L> {
  channel: LayoutChannel;
  loader: LayoutLoader<L>;
  // The setting's layout name, read again on each set and each `refresh()`.
  userLayout(): string;
  // The names of the layouts the page's content names beside the user's, read
  // again on each set and each `refresh()`.
  namesInUse(): readonly string[];
  setLayouts(shown: ShownLayouts<L>): void;
  log: Log;
  // The source name every log line carries.
  logSource: string;
  toast(text: string, tone: ToastTone): void;
}

// `refresh` reads the setting and the names in use again, after either may
// have changed.
export interface LayoutShow {
  refresh(): void;
}

// What a load was queued for: the set, the names to load, and the setting's
// name when the set lists it, else null.
interface QueuedLoad {
  set: LayoutSet;
  names: string[];
  listedUser: string | null;
}

// Loads the user's layout and the layouts in use from main's latest set, and
// hands the page the loaded layouts whenever a load changes them. Every set
// and every `refresh()` that changes what to load queues a load; loads run
// one at a time in order. A setting naming a layout the set lacks draws
// `default` and is logged once, until the setting changes or a set lists it.
// A set heard before main answers `layout` is newer, so the answer is then
// dropped.
export function showLayouts<L>(deps: ShowLayoutsDeps<L>): LayoutShow {
  const { channel, loader, log, logSource, toast } = deps;
  let queue = Promise.resolve();
  let heardChange = false;
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
      log(logSource, `layout ${user} not found, drawing ${DEFAULT_NAME}`);
    }
  };

  const loadAndShow = async (queued: QueuedLoad) => {
    const result = await loader.load(queued.set, queued.names);
    for (const entry of result.loaded) {
      log(logSource, `layout ${entry.name} shown (revision ${entry.revision})`);
    }
    for (const { entry, error } of result.failed) {
      log(logSource, `layout ${entry.name} failed: ${errorText(error)}`);
      toast(`Layout ${entry.name} failed: ${errorText(error)}`, 'error');
    }
    const { listedUser } = queued;
    const isUserLoaded = listedUser !== null && result.layouts.has(listedUser);
    const shown: ShownLayouts<L> = {
      layouts: result.layouts,
      user: isUserLoaded ? listedUser : DEFAULT_NAME,
    };
    if (lastShown === null || shownChanged(lastShown, shown)) {
      deps.setLayouts(shown);
      lastShown = shown;
    }
  };

  const update = () => {
    if (latest === null) {
      return;
    }
    const set = latest;
    const user = deps.userLayout();
    const isListed = set.layouts.some((entry) => entry.name === user);
    logMissing(user, isListed);
    const listedUser = isListed ? user : null;
    const names = [
      ...new Set([...(isListed ? [user] : []), ...deps.namesInUse()]),
    ];
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
        log(logSource, `layouts not shown: ${errorText(error)}`),
      );
  };

  channel.onLayoutChanged((set) => {
    heardChange = true;
    latest = set;
    update();
  });
  channel
    .readLayout()
    .then((set) => {
      if (!heardChange) {
        latest = set;
        update();
      }
    })
    .catch((error: unknown) =>
      log(logSource, `layout not read: ${errorText(error)}`),
    );
  return { refresh: update };
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
